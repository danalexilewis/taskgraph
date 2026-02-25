import { Command } from "commander";
import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { readConfig, Config } from "./utils"; // Import Config
import {
  checkNoBlockerCycle,
  checkValidTransition,
} from "../domain/invariants";
import { TaskStatus, Edge } from "../domain/types";
import { ResultAsync, ok, err } from "neverthrow";
import { AppError, buildError, ErrorCode } from "../domain/errors";
import { query, now, jsonObj } from "../db/query";

export function blockCommand(program: Command) {
  program
    .command("block")
    .description("Block a task on another task")
    .argument("<taskId>", "ID of the task to be blocked")
    .requiredOption("--on <blockerTaskId>", "ID of the task that is blocking")
    .option("--reason <reason>", "Reason for the block")
    .action(async (taskId, options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        // Removed async, added type
        const currentTimestamp = now();

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

            const currentStatusResult = await q.select<{ status: TaskStatus }>(
              "task",
              { columns: ["status"], where: { task_id: taskId } },
            );
            if (currentStatusResult.isErr()) throw currentStatusResult.error;
            if (currentStatusResult.value.length === 0) {
              throw buildError(
                ErrorCode.TASK_NOT_FOUND,
                `Task with ID ${taskId} not found.`,
              );
            }
            const currentStatus = currentStatusResult.value[0].status;

            if (currentStatus !== "blocked") {
              const transitionResult = checkValidTransition(
                currentStatus,
                "blocked",
              );
              if (transitionResult.isErr()) throw transitionResult.error;

              const updateStatusResult = await q.update(
                "task",
                { status: "blocked", updated_at: currentTimestamp },
                { task_id: taskId },
              );
              if (updateStatusResult.isErr()) throw updateStatusResult.error;
            }

            const insertEventResult = await q.insert("event", {
              event_id: uuidv4(),
              task_id: taskId,
              kind: "blocked",
              body: jsonObj({
                blockerTaskId: options.on,
                reason: options.reason ?? null,
                timestamp: currentTimestamp,
              }),
              created_at: currentTimestamp,
            });
            if (insertEventResult.isErr()) throw insertEventResult.error;

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
