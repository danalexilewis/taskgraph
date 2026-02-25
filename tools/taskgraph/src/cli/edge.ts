import { Command } from "commander";
import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { readConfig, Config } from "./utils";
import { EdgeTypeSchema, Edge } from "../domain/types";
import { ResultAsync, ok, err } from "neverthrow";
import { AppError, buildError, ErrorCode } from "../domain/errors";
import { checkNoBlockerCycle } from "../domain/invariants";
import { query } from "../db/query";

export function edgeCommand(program: Command) {
  program
    .command("edge")
    .description("Manage task dependencies")
    .addCommand(edgeAddCommand());
}

function edgeAddCommand(): Command {
  return new Command("add")
    .description("Add a dependency edge between tasks")
    .argument("<fromTaskId>", "ID of the blocking task")
    .argument("<type>", "Type of edge (blocks or relates)", (value) => {
      const parsed = EdgeTypeSchema.safeParse(value);
      if (!parsed.success) {
        throw new Error(
          `Invalid edge type: ${value}. Must be one of: ${EdgeTypeSchema.options.join(", ")}`,
        );
      }
      return value;
    })
    .argument("<toTaskId>", "ID of the blocked task")
    .option("--reason <reason>", "Reason for the dependency")
    .action(async (fromTaskId, type, toTaskId, options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        const q = query(config.doltRepoPath);
        if (type === "blocks") {
          return ResultAsync.fromPromise(
            (async () => {
              const existingEdgesResult = await q.select<Edge>("edge", {
                where: { type: "blocks" },
              });
              if (existingEdgesResult.isErr()) {
                throw existingEdgesResult.error;
              }
              const existingEdges = existingEdgesResult.value;

              const cycleCheckResult = checkNoBlockerCycle(
                fromTaskId,
                toTaskId,
                existingEdges,
              );
              if (cycleCheckResult.isErr()) throw cycleCheckResult.error;
              return ok(undefined); // Return an Ok Result to continue the chain
            })(),
            (e) => e as AppError,
          ).andThen(() => {
            // Continue the original chain here after cycle check
            return q
              .insert("edge", {
                from_task_id: fromTaskId,
                to_task_id: toTaskId,
                type,
                reason: options.reason ?? null,
              })
              .map(() => ({
                from_task_id: fromTaskId,
                to_task_id: toTaskId,
                type,
                reason: options.reason,
              }));
          });
        }

        return q
          .insert("edge", {
            from_task_id: fromTaskId,
            to_task_id: toTaskId,
            type,
            reason: options.reason ?? null,
          })
          .andThen(() =>
            doltCommit(
              `edge: add ${fromTaskId} ${type} ${toTaskId}`,
              config.doltRepoPath,
              cmd.parent?.opts().noCommit,
            ),
          )
          .map(() => ({
            from_task_id: fromTaskId,
            to_task_id: toTaskId,
            type,
            reason: options.reason,
          }));
      });

      result.match(
        (data: unknown) => {
          const resultData = data as {
            from_task_id: string;
            to_task_id: string;
            type: string;
            reason: string;
          };
          if (!cmd.parent?.opts().json) {
            console.log(
              `Edge added: ${resultData.from_task_id} ${resultData.type} ${resultData.to_task_id}`,
            );
          } else {
            console.log(JSON.stringify(resultData, null, 2));
          }
        },
        (error: AppError) => {
          console.error(`Error adding edge: ${error.message}`);
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
