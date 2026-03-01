import * as path from "node:path";
import type { Command } from "commander";
import { err, ok, ResultAsync } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import { mergeAgentBranchIntoMain } from "../db/branch";
import { doltCommit } from "../db/commit";
import { type JsonValue, jsonObj, now, query } from "../db/query";
import { syncBlockedStatusForTask } from "../domain/blocked-status";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { checkValidTransition } from "../domain/invariants";
import { autoCompletePlanIfDone } from "../domain/plan-completion";
import type { TaskStatus } from "../domain/types";
import {
  getStartedEventBranch,
  getStartedEventWorktree,
  parseIdList,
  readConfig,
  resolveTaskId,
} from "./utils";
import { mergeWorktreeBranchIntoMain, removeWorktree } from "./worktree";

type DoneResult =
  | { id: string; status: "done"; plan_completed?: boolean }
  | { id: string; error: string };

export function doneCommand(program: Command) {
  program
    .command("done")
    .description("Mark a task as done")
    .argument(
      "<taskIds...>",
      "One or more task IDs (space- or comma-separated)",
    )
    .option("--evidence <text>", "Evidence of completion", "")
    .option("--checks <json>", "JSON array of acceptance checks")
    .option(
      "--force",
      "Allow marking as done even if not in 'doing' status",
      false,
    )
    .option(
      "--merge",
      "Merge worktree branch into base branch before removing worktree",
      false,
    )
    .action(async (taskIds: string[], options, cmd) => {
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
      const json = cmd.parent?.opts().json;
      const results: DoneResult[] = [];
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

        let planId: string | null = null;
        const singleResult = await q
          .select<{ status: TaskStatus; plan_id: string }>("task", {
            columns: ["status", "plan_id"],
            where: { task_id: resolved },
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
            planId = currentStatusResult[0].plan_id;

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
              { task_id: resolved },
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
              task_id: resolved,
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
              `task: done ${resolved}`,
              config.doltRepoPath,
              cmd.parent?.opts().noCommit,
            ),
          )
          .andThen(() =>
            q
              .select<{ to_task_id: string }>("edge", {
                columns: ["to_task_id"],
                where: { from_task_id: resolved, type: "blocks" },
              })
              .andThen((dependentRows) => {
                const syncs = dependentRows.map((r) =>
                  syncBlockedStatusForTask(config.doltRepoPath, r.to_task_id),
                );
                return ResultAsync.combine(syncs).map(() => undefined);
              }),
          )
          .andThen(() => {
            if (!planId) {
              return ok({
                task_id: resolved,
                status: "done" as const,
                plan_completed: false,
              });
            }
            return autoCompletePlanIfDone(planId, config.doltRepoPath).andThen(
              (planCompleted) => {
                if (planCompleted) {
                  return doltCommit(
                    `plan: auto-complete ${planId}`,
                    config.doltRepoPath,
                    cmd.parent?.opts().noCommit,
                  ).map(() => ({
                    task_id: resolved,
                    status: "done" as const,
                    plan_completed: true,
                  }));
                }
                return ok({
                  task_id: resolved,
                  status: "done" as const,
                  plan_completed: false,
                });
              },
            );
          });

        singleResult.match(
          (value) =>
            results.push({
              id: taskId,
              status: "done",
              plan_completed: value.plan_completed,
            }),
          (error: AppError) => {
            results.push({ id: taskId, error: error.message });
            anyFailed = true;
            return 0;
          },
        );

        const lastResult = results[results.length - 1];
        if (lastResult && !("error" in lastResult)) {
          const branchResult = await getStartedEventBranch(
            resolved,
            config.doltRepoPath,
          );
          const branch = branchResult.isOk() ? branchResult.value : null;
          if (branch) {
            const mergeResult = await mergeAgentBranchIntoMain(
              config.doltRepoPath,
              branch,
              config.mainBranch ?? "main",
            );
            mergeResult.match(
              () => {},
              (mergeErr: AppError) => {
                const idx = results.length - 1;
                const last = results[idx];
                if (last) {
                  results[idx] = { id: last.id, error: mergeErr.message };
                  anyFailed = true;
                }
              },
            );
          }

          const worktreeResult = await getStartedEventWorktree(
            resolved,
            config.doltRepoPath,
          );
          const worktree = worktreeResult.isOk() ? worktreeResult.value : null;
          if (worktree) {
            const gitRepoPath = path.dirname(
              path.dirname(path.dirname(worktree.worktree_path)),
            );
            let worktreeMergeFailed = false;
            if (options.merge) {
              const mergeWtResult = await mergeWorktreeBranchIntoMain(
                gitRepoPath,
                worktree.worktree_branch,
                config.mainBranch ?? "main",
              );
              mergeWtResult.match(
                () => {},
                (mergeErr: AppError) => {
                  worktreeMergeFailed = true;
                  const idx = results.length - 1;
                  const last = results[idx];
                  if (last) {
                    results[idx] = { id: last.id, error: mergeErr.message };
                    anyFailed = true;
                  }
                },
              );
            }
            if (!worktreeMergeFailed) {
              const removeResult = await removeWorktree(
                resolved,
                gitRepoPath,
                options.merge,
              );
              removeResult.match(
                () => {},
                (removeErr: AppError) => {
                  const idx = results.length - 1;
                  const last = results[idx];
                  if (last) {
                    results[idx] = { id: last.id, error: removeErr.message };
                    anyFailed = true;
                  }
                },
              );
            }
          }
        }
      }

      if (!json) {
        for (const r of results) {
          if ("error" in r) {
            console.error(`Task ${r.id}: ${r.error}`);
          } else {
            console.log(`Task ${r.id} done.`);
            if (r.plan_completed) console.log(`Plan completed!`);
          }
        }
      } else {
        console.log(JSON.stringify(results));
      }

      if (anyFailed) process.exit(1);
    });
}
