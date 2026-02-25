import { Command } from "commander";
import { readConfig, Config } from "./utils"; // Import Config
import { ResultAsync, ok, err } from "neverthrow";
import { AppError, buildError, ErrorCode } from "../domain/errors";
import { Task, Edge, Event, TaskStatus } from "../domain/types";
import { query } from "../db/query";

export function showCommand(program: Command) {
  program
    .command("show")
    .description("Prints task details, blockers, dependents, and recent events")
    .argument("<taskId>", "ID of the task to show")
    .action(async (taskId, options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        const q = query(config.doltRepoPath);

        return ResultAsync.fromPromise(
          (async () => {
            const taskDetailQueryResult = await q.raw<
              Task & { plan_title: string }
            >(`SELECT t.*, p.title as plan_title
              FROM \`task\` t
              JOIN \`plan\` p ON t.plan_id = p.plan_id
              WHERE t.task_id = '${taskId}';`);
            if (taskDetailQueryResult.isErr())
              throw taskDetailQueryResult.error;
            const taskDetailsArray = taskDetailQueryResult.value;
            if (taskDetailsArray.length === 0) {
              throw buildError(
                ErrorCode.TASK_NOT_FOUND,
                `Task with ID ${taskId} not found.`,
              );
            }
            const taskDetails = taskDetailsArray[0];

            interface BlockerDetails extends Edge {
              title: string;
              status: Task["status"];
            }
            interface DependentDetails extends Edge {
              title: string;
              status: Task["status"];
            }

            const blockersResult = await q.raw<BlockerDetails>(`
              SELECT e.from_task_id, t.title, t.status, e.reason
              FROM \`edge\` e
              JOIN \`task\` t ON e.from_task_id = t.task_id
              WHERE e.to_task_id = '${taskId}' AND e.type = 'blocks';
            `);
            const blockers = blockersResult.isOk() ? blockersResult.value : [];

            const dependentsResult = await q.raw<DependentDetails>(`
              SELECT e.to_task_id, t.title, t.status, e.reason
              FROM \`edge\` e
              JOIN \`task\` t ON e.to_task_id = t.task_id
              WHERE e.from_task_id = '${taskId}' AND e.type = 'blocks';
            `);
            const dependents = dependentsResult.isOk()
              ? dependentsResult.value
              : [];

            const eventsResult = await q.raw<Event>(`
              SELECT kind, body, created_at, actor
              FROM \`event\`
              WHERE task_id = '${taskId}'
              ORDER BY created_at DESC
              LIMIT 5;
            `);
            const events = eventsResult.isOk() ? eventsResult.value : [];

            return { taskDetails, blockers, dependents, events };
          })(),
          (e) => e as AppError, // Error handler for the promise
        );
      });

      result.match(
        (data: unknown) => {
          const resultData = data as {
            taskDetails: Task & { plan_title: string };
            blockers: ({ title: string; status: TaskStatus } & Edge)[];
            dependents: ({ title: string; status: TaskStatus } & Edge)[];
            events: Event[];
          };
          if (!cmd.parent?.opts().json) {
            const task = resultData.taskDetails;
            console.log(`Task Details (ID: ${task.task_id}):`);
            console.log(`  Title: ${task.title}`);
            console.log(`  Plan: ${task.plan_title} (ID: ${task.plan_id})`);
            console.log(`  Status: ${task.status}`);
            console.log(`  Owner: ${task.owner}`);
            console.log(`  Area: ${task.area ?? "N/A"}`);
            console.log(`  Risk: ${task.risk}`);
            console.log(`  Estimate: ${task.estimate_mins ?? "N/A"} minutes`);
            console.log(`  Intent: ${task.intent ?? "N/A"}`);
            console.log(`  Scope In: ${task.scope_in ?? "N/A"}`);
            console.log(`  Scope Out: ${task.scope_out ?? "N/A"}`);
            console.log(
              `  Acceptance: ${task.acceptance ? JSON.stringify(task.acceptance) : "N/A"}`,
            );
            console.log(`  Created At: ${task.created_at}`);
            console.log(`  Updated At: ${task.updated_at}`);

            if (resultData.blockers.length > 0) {
              console.log("\nBlockers:");
              resultData.blockers.forEach((b) => {
                console.log(
                  `  - Task ID: ${b.from_task_id}, Title: ${b.title}, Status: ${b.status}, Reason: ${b.reason ?? "N/A"}`,
                );
              });
            }

            if (resultData.dependents.length > 0) {
              console.log("\nDependents:");
              resultData.dependents.forEach((d) => {
                console.log(
                  `  - Task ID: ${d.to_task_id}, Title: ${d.title}, Status: ${d.status}, Reason: ${d.reason ?? "N/A"}`,
                );
              });
            }

            if (resultData.events.length > 0) {
              console.log("\nRecent Events:");
              resultData.events.forEach((e) => {
                console.log(
                  `  - Kind: ${e.kind}, Actor: ${e.actor}, Created: ${e.created_at}, Body: ${JSON.stringify(e.body)}`,
                );
              });
            }
          } else {
            console.log(JSON.stringify(resultData, null, 2));
          }
        },
        (error: AppError) => {
          console.error(`Error showing task: ${error.message}`);
          if (cmd.parent?.opts().json) {
            console.log(
              JSON.stringify({
                status: "error",
                code: error.code,
                message: error.message,
                cause: error.cause,
              }),
            );
          }
          process.exit(1);
        },
      );
    });
}
