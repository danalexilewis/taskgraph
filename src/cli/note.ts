import type { Command } from "commander";
import { err } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { jsonObj, now, query } from "../db/query";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { getStatusCache } from "./status-cache";
import { parseIdList, readConfig, resolveTaskId } from "./utils";

type NoteResult =
  | { id: string; status?: string }
  | { id: string; error: string };

export function noteCommand(program: Command) {
  program
    .command("note")
    .description(
      "Add a task-scoped note (visible in tg context and tg show). For path-scoped clues that survive task closure, use .breadcrumbs.json — see docs/breadcrumbs.md.",
    )
    .argument(
      "<taskIds...>",
      "One or more task IDs (space- or comma-separated)",
    )
    .option("--msg <text>", "Note message (required)")
    .option("--agent <name>", "Agent identifier")
    .action(async (taskIds: string[], options, cmd) => {
      const msg = options.msg;
      if (!msg || typeof msg !== "string") {
        console.error("Error: --msg <text> is required.");
        process.exit(1);
      }
      const ids = parseIdList(taskIds);
      if (ids.length === 0) {
        console.error("At least one task ID required.");
        process.exit(1);
      }

      const configResult = await readConfig();
      if (configResult.isErr()) {
        console.error(configResult.error.message);
        process.exit(1);
      }
      const config = configResult.value;
      const agentName = options.agent ?? "default";
      const json = cmd.parent?.opts().json;
      const results: NoteResult[] = [];
      let anyFailed = false;

      for (const taskId of ids) {
        const resolvedResult = await resolveTaskId(taskId, config.doltRepoPath);
        if (resolvedResult.isErr()) {
          results.push({ id: taskId, error: resolvedResult.error.message });
          anyFailed = true;
          continue;
        }
        const resolved = resolvedResult.value;
        const currentTimestamp = now();
        const q = query(config.doltRepoPath);

        const result = await q
          .select<{ task_id: string }>("task", {
            columns: ["task_id"],
            where: { task_id: resolved },
          })
          .andThen((rows) => {
            if (rows.length === 0) {
              return err(
                buildError(
                  ErrorCode.TASK_NOT_FOUND,
                  `Task with ID ${taskId} not found.`,
                ),
              );
            }
            return q
              .insert("event", {
                event_id: uuidv4(),
                task_id: resolved,
                kind: "note",
                body: jsonObj({
                  message: msg,
                  agent: agentName,
                  timestamp: currentTimestamp,
                }),
                created_at: currentTimestamp,
              })
              .andThen(() =>
                doltCommit(
                  `task: note ${resolved}`,
                  config.doltRepoPath,
                  cmd.parent?.opts().noCommit,
                ),
              )
              .map(() => ({ task_id: resolved }));
          });

        result.match(
          () => {
            results.push({ id: taskId, status: "ok" });
          },
          (error: AppError) => {
            results.push({ id: taskId, error: error.message });
            anyFailed = true;
          },
        );
      }

      if (!json) {
        for (const r of results) {
          if ("error" in r) {
            console.error(`Task ${r.id}: ${r.error}`);
          } else {
            console.log(`Note added to task ${r.id}.`);
          }
        }
      } else {
        console.log(JSON.stringify(results));
      }

      if (!anyFailed) getStatusCache().clear();
      if (anyFailed) process.exit(1);
    });
}
