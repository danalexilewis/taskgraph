import { Command } from "commander";
import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { readConfig, Config } from "./utils"; // Import Config
import { checkValidTransition } from "../domain/invariants";
import { TaskStatus } from "../domain/types";
import { ResultAsync, ok, err } from "neverthrow";
import { AppError, buildError, ErrorCode } from "../domain/errors";
import { query, now, jsonObj, JsonValue } from "../db/query";

export function doneCommand(program: Command) {
  program
    .command("done")
    .description("Mark a task as done")
    .argument("<taskId>", "ID of the task to mark as done")
    .option("--evidence <text>", "Evidence of completion", "")
    .option("--checks <json>", "JSON array of acceptance checks")
    .option(
      "--force",
      "Allow marking as done even if not in 'doing' status",
      false,
    )
    .action(async (taskId, options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        // Removed async, added type
        const currentTimestamp = now();

        const q = query(config.doltRepoPath);

        return q
          .select<{ status: TaskStatus }>("task", {
            columns: ["status"],
            where: { task_id: taskId },
          })
          .andThen((currentStatusResult) => {
            if (currentStatusResult.length === 0) {
              return err(
                buildError(
                  ErrorCode.TASK_NOT_FOUND,
                  `Task with ID ${taskId} not found.`,
                ),
              );
            }
            const currentStatus = currentStatusResult[0].status;

            if (!options.force) {
              const transitionResult = checkValidTransition(
                currentStatus,
                "done",
              );
              if (transitionResult.isErr()) return err(transitionResult.error);
            }
            return ok(currentStatus);
          })
          .andThen(() =>
            q.update(
              "task",
              { status: "done", updated_at: currentTimestamp },
              { task_id: taskId },
            ),
          )
          .andThen(() => {
            let parsedChecks: JsonValue | null = null;
            if (options.checks) {
              try {
                parsedChecks = JSON.parse(options.checks) as JsonValue;
              } catch (e: unknown) {
                return err(
                  buildError(
                    ErrorCode.VALIDATION_FAILED,
                    `Invalid JSON for acceptance checks: ${options.checks}`,
                    e as Error,
                  ),
                );
              }
            }
            const eventBody = {
              evidence: options.evidence,
              checks: parsedChecks,
              timestamp: currentTimestamp,
            };

            return q.insert("event", {
              event_id: uuidv4(),
              task_id: taskId,
              kind: "done",
              body: jsonObj({
                evidence: eventBody.evidence,
                checks: eventBody.checks,
                timestamp: eventBody.timestamp,
              }),
              created_at: currentTimestamp,
            });
          })
          .andThen(() =>
            doltCommit(
              `task: done ${taskId}`,
              config.doltRepoPath,
              cmd.parent?.opts().noCommit,
            ),
          )
          .map(() => ({
            task_id: taskId,
            status: "done",
            evidence: options.evidence,
            checks: options.checks,
          }));
      });

      result.match(
        (data: unknown) => {
          const resultData = data as {
            task_id: string;
            status: TaskStatus;
            evidence: string;
            checks: string;
          };
          if (!cmd.parent?.opts().json) {
            console.log(`Task ${resultData.task_id} marked as done.`);
          } else {
            console.log(JSON.stringify(resultData, null, 2));
          }
        },
        (error: AppError) => {
          console.error(
            `Error marking task ${taskId} as done: ${error.message}`,
          );
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
