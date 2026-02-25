import { Command } from "commander";
import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { readConfig, Config } from "./utils"; // Import Config
import { checkRunnable, checkValidTransition } from "../domain/invariants";
import { TaskStatus } from "../domain/types";
import { ResultAsync, ok, err } from "neverthrow"; // Import err
import { AppError, buildError, ErrorCode } from "../domain/errors";
import { query, now, jsonObj } from "../db/query";

export function startCommand(program: Command) {
  program
    .command("start")
    .description("Start a task")
    .argument("<taskId>", "ID of the task to start")
    .action(async (taskId, options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        // Removed async, added type
        const currentTimestamp = now();

        const q = query(config.doltRepoPath);

        return checkRunnable(taskId, config.doltRepoPath)
          .andThen(() =>
            q.select<{ status: TaskStatus }>("task", {
              columns: ["status"],
              where: { task_id: taskId },
            }),
          )
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
            return checkValidTransition(currentStatus, "doing");
          })
          .andThen(() =>
            q.update(
              "task",
              { status: "doing", updated_at: currentTimestamp },
              { task_id: taskId },
            ),
          )
          .andThen(() =>
            q.insert("event", {
              event_id: uuidv4(),
              task_id: taskId,
              kind: "started",
              body: jsonObj({ timestamp: currentTimestamp }),
              created_at: currentTimestamp,
            }),
          )
          .andThen(() =>
            doltCommit(
              `task: start ${taskId}`,
              config.doltRepoPath,
              cmd.parent?.opts().noCommit,
            ),
          )
          .map(() => ({ task_id: taskId, status: "doing" }));
      });

      result.match(
        (data: unknown) => {
          const resultData = data as { task_id: string; status: TaskStatus };
          if (!cmd.parent?.opts().json) {
            console.log(`Task ${resultData.task_id} started.`);
          } else {
            console.log(JSON.stringify(resultData, null, 2));
          }
        },
        (error: AppError) => {
          console.error(`Error starting task: ${error.message}`);
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
