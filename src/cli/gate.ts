import { Command } from "commander";
import { errAsync, ResultAsync } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { jsonObj, now, query } from "../db/query";
import { syncBlockedStatusForTask } from "../domain/blocked-status";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { checkValidTransition } from "../domain/invariants";
import type { Gate, GateType } from "../domain/types";
import { GateTypeSchema } from "../domain/types";
import { type Config, readConfig, resolveTaskId, rootOpts } from "./utils";

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i;

export function gateCommand(program: Command) {
  const gate = program
    .command("gate")
    .description("Manage gates (external conditions that block tasks)");

  gate.addCommand(gateCreateCommand());
  gate.addCommand(gateResolveCommand());
  gate.addCommand(gateListCommand());
}

function gateCreateCommand(): Command {
  return new Command("create")
    .description("Create a gate and block the given task")
    .argument("<name>", "Human-readable name for the gate")
    .requiredOption(
      "--task <taskId>",
      "Task ID to block until the gate is resolved",
    )
    .option("--type <type>", "Gate type: human, ci, webhook", "human")
    .action(
      async (
        name: string,
        options: { task: string; type: string },
        cmd: Command,
      ) => {
        const typeParse = GateTypeSchema.safeParse(options.type);
        if (!typeParse.success) {
          console.error(
            `Invalid --type: ${options.type}. Must be one of: human, ci, webhook`,
          );
          if (rootOpts(cmd).json) {
            console.log(
              JSON.stringify({
                status: "error",
                code: ErrorCode.VALIDATION_FAILED,
                message: `Invalid --type: ${options.type}`,
              }),
            );
          }
          process.exit(1);
        }
        const gateType = typeParse.data as GateType;

        const result = await readConfig().asyncAndThen((config: Config) =>
          resolveTaskId(options.task, config.doltRepoPath).andThen((taskId) => {
            const q = query(config.doltRepoPath);
            const gateId = uuidv4();
            const currentTimestamp = now();

            return q
              .select<{ status: string }>("task", {
                columns: ["status"],
                where: { task_id: taskId },
              })
              .andThen((rows) => {
                if (rows.length === 0) {
                  return errAsync(
                    buildError(
                      ErrorCode.TASK_NOT_FOUND,
                      `Task ${options.task} not found.`,
                    ),
                  );
                }
                const currentStatus = rows[0].status as
                  | "todo"
                  | "doing"
                  | "blocked"
                  | "done"
                  | "canceled";

                return q
                  .insert("gate", {
                    gate_id: gateId,
                    name: name.slice(0, 255),
                    gate_type: gateType,
                    status: "pending",
                    task_id: taskId,
                    resolved_at: null,
                    created_at: currentTimestamp,
                  })
                  .andThen(() => {
                    if (
                      (currentStatus === "todo" || currentStatus === "doing") &&
                      checkValidTransition(currentStatus, "blocked").isOk()
                    ) {
                      return q
                        .update(
                          "task",
                          { status: "blocked", updated_at: currentTimestamp },
                          { task_id: taskId },
                        )
                        .andThen(() =>
                          q.insert("event", {
                            event_id: uuidv4(),
                            task_id: taskId,
                            kind: "blocked",
                            body: jsonObj({
                              gateId,
                              reason: "gate",
                              timestamp: currentTimestamp,
                            }),
                            created_at: currentTimestamp,
                          }),
                        )
                        .map(() => undefined);
                    }
                    return ResultAsync.fromSafePromise(
                      Promise.resolve(undefined),
                    );
                  })
                  .andThen(() =>
                    doltCommit(
                      `gate: create ${gateId} (${name}) for task ${taskId}`,
                      config.doltRepoPath,
                      cmd.parent?.parent?.opts()?.noCommit,
                    ),
                  )
                  .map(() => ({
                    gate_id: gateId,
                    name,
                    gate_type: gateType,
                    status: "pending",
                    task_id: taskId,
                    created_at: currentTimestamp,
                  }));
              });
          }),
        );

        result.match(
          (data) => {
            if (!rootOpts(cmd).json) {
              console.log(
                `Gate created: ${data.gate_id} (${data.name}). Task ${data.task_id} set to blocked.`,
              );
            } else {
              console.log(JSON.stringify(data, null, 2));
            }
          },
          (error: AppError) => {
            console.error(`Error creating gate: ${error.message}`);
            if (rootOpts(cmd).json) {
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
      },
    );
}

function gateResolveCommand(): Command {
  return new Command("resolve")
    .description("Mark a gate as resolved; unblock task if no other blockers")
    .argument("<gateId>", "Gate UUID to resolve")
    .action(async (gateId: string, _options: object, cmd: Command) => {
      if (!UUID_REGEX.test(gateId)) {
        console.error("Invalid gate ID: must be a UUID.");
        process.exit(1);
      }

      const result = await readConfig().asyncAndThen((config: Config) => {
        const q = query(config.doltRepoPath);
        return q
          .select<{ task_id: string; status: string }>("gate", {
            columns: ["task_id", "status"],
            where: { gate_id: gateId },
          })
          .andThen((rows) => {
            if (rows.length === 0) {
              return errAsync(
                buildError(
                  ErrorCode.VALIDATION_FAILED,
                  `Gate ${gateId} not found.`,
                ),
              );
            }
            const gate = rows[0];
            if (gate.status === "resolved") {
              return errAsync(
                buildError(
                  ErrorCode.VALIDATION_FAILED,
                  `Gate ${gateId} is already resolved.`,
                ),
              );
            }
            const currentTimestamp = now();
            return q
              .update(
                "gate",
                { status: "resolved", resolved_at: currentTimestamp },
                { gate_id: gateId },
              )
              .andThen(() =>
                q.count("gate", {
                  task_id: gate.task_id,
                  status: "pending",
                }),
              )
              .andThen((pendingCount) => {
                if (pendingCount === 0) {
                  return syncBlockedStatusForTask(
                    config.doltRepoPath,
                    gate.task_id,
                  );
                }
                return ResultAsync.fromSafePromise(Promise.resolve(undefined));
              })
              .andThen(() =>
                doltCommit(
                  `gate: resolve ${gateId}`,
                  config.doltRepoPath,
                  cmd.parent?.parent?.opts()?.noCommit,
                ),
              )
              .map(() => ({ gate_id: gateId, task_id: gate.task_id }));
          });
      });

      result.match(
        (data) => {
          if (!rootOpts(cmd).json) {
            console.log(
              `Gate ${data.gate_id} resolved. Task ${data.task_id} may be unblocked if no other blockers.`,
            );
          } else {
            console.log(JSON.stringify(data, null, 2));
          }
        },
        (error: AppError) => {
          console.error(`Error resolving gate: ${error.message}`);
          if (rootOpts(cmd).json) {
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

function gateListCommand(): Command {
  return new Command("list")
    .description("List gates, optionally only pending")
    .option("--pending", "Show only pending gates", false)
    .action(async (options: { pending?: boolean }, cmd: Command) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        const q = query(config.doltRepoPath);
        const where = options.pending
          ? ({ status: "pending" } as const)
          : undefined;
        return q.select<Gate>("gate", {
          where,
          orderBy: "`created_at` DESC",
        });
      });

      result.match(
        (rows) => {
          if (!rootOpts(cmd).json) {
            if (rows.length === 0) {
              console.log("No gates found.");
              return;
            }
            for (const g of rows) {
              const resolved = g.resolved_at ?? "-";
              console.log(
                `${g.gate_id}\t${g.name}\t${g.gate_type}\t${g.status}\t${g.task_id}\t${resolved}\t${g.created_at}`,
              );
            }
          } else {
            console.log(JSON.stringify(rows, null, 2));
          }
        },
        (error: AppError) => {
          console.error(`Error listing gates: ${error.message}`);
          if (rootOpts(cmd).json) {
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
