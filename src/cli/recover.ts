import type { Command } from "commander";
import { okAsync, ResultAsync } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import { jsonObj, now, query } from "../db/query";
import type { AppError } from "../domain/errors";
import { fetchStaleDoingTasks, type StaleDoingTaskRow } from "./status";
import { renderTable } from "./table";
import { getTerminalWidth } from "./terminal";
import { readConfig } from "./utils";

export interface RecoveredTask {
  task_id: string;
  hash_id: string | null;
  title: string;
  age_hours: number;
}

function toRecoveredTask(t: StaleDoingTaskRow): RecoveredTask {
  return {
    task_id: t.task_id,
    hash_id: t.hash_id,
    title: t.title,
    age_hours: t.age_hours,
  };
}

/**
 * Resets stale doing tasks (idle > thresholdHours) back to todo.
 * Records a recovery note event per task. Returns the list of recovered tasks.
 */
export function recoverStaleTasks(
  repoPath: string,
  thresholdHours: number,
): ResultAsync<RecoveredTask[], AppError> {
  const q = query(repoPath);
  return fetchStaleDoingTasks(repoPath, thresholdHours).andThen(
    (staleTasks) => {
      if (staleTasks.length === 0) {
        return okAsync<RecoveredTask[], AppError>([]);
      }

      const currentTimestamp = now();

      const ops: Array<ResultAsync<unknown, AppError>> = staleTasks.flatMap(
        (task) => [
          q.update(
            "task",
            { status: "todo", updated_at: currentTimestamp },
            { task_id: task.task_id },
          ),
          q.insert("event", {
            event_id: uuidv4(),
            task_id: task.task_id,
            kind: "note",
            body: jsonObj({
              type: "recovery",
              age_hours: task.age_hours,
              agent: "system",
              timestamp: currentTimestamp,
            }),
            actor: "agent",
            created_at: currentTimestamp,
          }),
        ],
      );

      return ResultAsync.combine(ops).map(() =>
        staleTasks.map(toRecoveredTask),
      );
    },
  );
}

export function recoverCommand(program: Command): void {
  program
    .command("recover")
    .description(
      "Reset stale doing tasks (idle > threshold hours) back to todo",
    )
    .option(
      "--threshold <hours>",
      "Hours of inactivity before a doing task is considered stale",
      "2",
    )
    .option("--dry-run", "Preview stale tasks without making changes", false)
    .action(async (options, cmd) => {
      const threshold = parseFloat(options.threshold);
      if (Number.isNaN(threshold) || threshold <= 0) {
        console.error(
          `Invalid threshold: ${options.threshold}. Must be a positive number.`,
        );
        process.exit(1);
      }

      const result = await readConfig().asyncAndThen((config) => {
        if (options.dryRun) {
          return fetchStaleDoingTasks(config.doltRepoPath, threshold).map(
            (tasks) => tasks.map(toRecoveredTask),
          );
        }
        return recoverStaleTasks(config.doltRepoPath, threshold);
      });

      const termWidth = getTerminalWidth();

      result.match(
        (tasks) => {
          if (!cmd.parent?.opts().json) {
            if (tasks.length === 0) {
              console.log("No stale tasks found.");
              return;
            }

            const rows = tasks.map((t) => [
              t.hash_id ?? t.task_id.slice(0, 8),
              t.title.length > 50 ? `${t.title.slice(0, 47)}...` : t.title,
              String(t.age_hours),
            ]);

            const table = renderTable({
              headers: ["Id", "Title", "Age (h)"],
              rows,
              maxWidth: termWidth,
              maxWidths: [10, undefined, 8],
              flexColumnIndex: 1,
            });

            console.log(table);

            if (options.dryRun) {
              console.log(
                `Dry run — ${tasks.length} task(s) would be recovered. No changes made.`,
              );
            } else {
              console.log(`Recovered ${tasks.length} task(s) back to todo.`);
            }
          } else {
            console.log(JSON.stringify(tasks, null, 2));
          }
        },
        (error) => {
          console.error(`Error: ${error.message}`);
          if (cmd.parent?.opts().json) {
            console.log(
              JSON.stringify({
                status: "error",
                code: error.code,
                message: error.message,
              }),
            );
          }
          process.exit(1);
        },
      );
    });
}
