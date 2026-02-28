import type { Command } from "commander";
import { ResultAsync } from "neverthrow";
import { doltCommit } from "../db/commit";
import { query } from "../db/query";
import { syncBlockedStatusForTask } from "../domain/blocked-status";
import type { AppError } from "../domain/errors";
import { checkNoBlockerCycle } from "../domain/invariants";
import type { Edge, TaskStatus } from "../domain/types";
import { type Config, readConfig } from "./utils";

export function blockCommand(program: Command) {
  program
    .command("block")
    .description("Block a task on another task")
    .argument("<taskId>", "ID of the task to be blocked")
    .requiredOption("--on <blockerTaskId>", "ID of the task that is blocking")
    .option("--reason <reason>", "Reason for the block")
    .action(async (taskId, options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        const q = query(config.doltRepoPath);

        return ResultAsync.fromPromise(
          (async () => {
            const existingEdgesResult = await q.select<Edge>("edge", {
              where: { type: "blocks" },
            });
            if (existingEdgesResult.isErr()) throw existingEdgesResult.error;
            const existingEdges = existingEdgesResult.value;

            const cycleCheckResult = checkNoBlockerCycle(
              options.on,
              taskId,
              existingEdges,
            );
            if (cycleCheckResult.isErr()) throw cycleCheckResult.error;

            const edgeExistsResult = await q.count("edge", {
              from_task_id: options.on,
              to_task_id: taskId,
              type: "blocks",
            });
            if (edgeExistsResult.isErr()) throw edgeExistsResult.error;
            const edgeExists = edgeExistsResult.value;

            if (edgeExists === 0) {
              const insertResult = await q.insert("edge", {
                from_task_id: options.on,
                to_task_id: taskId,
                type: "blocks",
                reason: options.reason ?? null,
              });
              if (insertResult.isErr()) throw insertResult.error;
            } else {
              console.log(
                `Edge from ${options.on} to ${taskId} of type 'blocks' already exists. Skipping edge creation.`,
              );
            }

            const syncResult = await syncBlockedStatusForTask(
              config.doltRepoPath,
              taskId,
            );
            if (syncResult.isErr()) throw syncResult.error;

            const commitResult = await doltCommit(
              `task: block ${taskId} on ${options.on}`,
              config.doltRepoPath,
              cmd.parent?.opts().noCommit,
            );
            if (commitResult.isErr()) throw commitResult.error;

            return {
              task_id: taskId,
              blocker_task_id: options.on,
              reason: options.reason,
              status: "blocked",
            };
          })(),
          (e) => e as AppError,
        );
      });

      result.match(
        (data: unknown) => {
          const resultData = data as {
            task_id: string;
            blocker_task_id: string;
            reason: string;
            status: TaskStatus;
          };
          if (!cmd.parent?.opts().json) {
            console.log(
              `Task ${resultData.task_id} blocked by ${resultData.blocker_task_id}.`,
            );
          } else {
            console.log(JSON.stringify(resultData, null, 2));
          }
        },
        (error: AppError) => {
          console.error(`Error blocking task: ${error.message}`);
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
