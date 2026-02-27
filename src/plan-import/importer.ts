import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { Task, Edge, Event } from "../domain/types";
import { ResultAsync, ok, err } from "neverthrow";
import { AppError, buildError, ErrorCode } from "../domain/errors";
import { query, now, jsonObj } from "../db/query";
import { sqlEscape } from "../db/escape";

interface ParsedTask {
  stableKey: string;
  title: string;
  feature?: string;
  area?: string;
  blockedBy: string[];
  acceptance: string[];
  status?: "todo" | "done";
  agent?: string;
  docs?: string[];
  skills?: string[];
  changeType?:
    | "create"
    | "modify"
    | "refactor"
    | "fix"
    | "investigate"
    | "test"
    | "document";
  intent?: string;
  suggestedChanges?: string;
}

interface ImportResult {
  importedTasksCount: number;
  createdPlansCount: number;
}

export function upsertTasksAndEdges(
  planId: string,
  parsedTasks: ParsedTask[],
  repoPath: string,
  noCommit: boolean = false,
  externalKeyPrefix?: string,
): ResultAsync<ImportResult, AppError> {
  const currentTimestamp = now();
  const q = query(repoPath);

  return q
    .select<Task>("task", {
      columns: ["task_id", "external_key"],
      where: { plan_id: planId },
    })
    .andThen((existingTasksResult) => {
      return ResultAsync.fromPromise(
        (async () => {
          const existingTasks = existingTasksResult as Task[];
          const externalKeyToTaskId = new Map<string, string>();
          existingTasks.forEach((task) => {
            if (task.external_key) {
              const normalizedKey =
                externalKeyPrefix &&
                task.external_key.startsWith(externalKeyPrefix + "-")
                  ? task.external_key.slice(externalKeyPrefix.length + 1)
                  : task.external_key;
              externalKeyToTaskId.set(normalizedKey, task.task_id);
            }
          });

          let importedTasksCount = 0;

          for (const parsedTask of parsedTasks) {
            let taskId = externalKeyToTaskId.get(parsedTask.stableKey);

            if (taskId) {
              // Update existing task
              const updateResult = await q.update(
                "task",
                {
                  title: parsedTask.title,
                  feature_key: parsedTask.feature ?? null,
                  area: parsedTask.area ?? null,
                  agent: parsedTask.agent ?? null,
                  change_type: parsedTask.changeType ?? null,
                  intent: parsedTask.intent ?? null,
                  suggested_changes: parsedTask.suggestedChanges ?? null,
                  acceptance:
                    parsedTask.acceptance.length > 0
                      ? jsonObj({ val: JSON.stringify(parsedTask.acceptance) })
                      : null,
                  ...(parsedTask.status !== undefined && {
                    status: parsedTask.status,
                  }),
                  updated_at: currentTimestamp,
                },
                { task_id: taskId },
              );
              if (updateResult.isErr()) {
                console.error("Error updating task:", updateResult.error);
                throw updateResult.error;
              }
            } else {
              // Insert new task
              taskId = uuidv4();
              importedTasksCount++;
              const taskStatus = parsedTask.status ?? "todo";
              const externalKey = externalKeyPrefix
                ? `${externalKeyPrefix}-${parsedTask.stableKey}`
                : parsedTask.stableKey;
              const insertResult = await q.insert("task", {
                task_id: taskId,
                plan_id: planId,
                external_key: externalKey,
                title: parsedTask.title,
                feature_key: parsedTask.feature ?? null,
                area: parsedTask.area ?? null,
                agent: parsedTask.agent ?? null,
                change_type: parsedTask.changeType ?? null,
                intent: parsedTask.intent ?? null,
                suggested_changes: parsedTask.suggestedChanges ?? null,
                acceptance:
                  parsedTask.acceptance.length > 0
                    ? jsonObj({ val: JSON.stringify(parsedTask.acceptance) })
                    : null,
                status: taskStatus,
                created_at: currentTimestamp,
                updated_at: currentTimestamp,
              });
              if (insertResult.isErr()) {
                console.error("Error inserting new task:", insertResult.error);
                throw insertResult.error;
              }

              const insertEventResult = await q.insert("event", {
                event_id: uuidv4(),
                task_id: taskId,
                kind: "created",
                body: jsonObj({
                  title: parsedTask.title,
                  externalKey: externalKey,
                }),
                created_at: currentTimestamp,
              });
              if (insertEventResult.isErr()) {
                console.error(
                  "Error inserting new task event:",
                  insertEventResult.error,
                );
                throw insertEventResult.error;
              }
            }

            // Register for edge resolution (blocker keys may reference tasks just inserted)
            externalKeyToTaskId.set(parsedTask.stableKey, taskId);

            // Sync task_doc and task_skill junction tables
            // Junction sync: delete existing task_doc rows for this task before re-inserting; whitelisted in doltSql guard (not core data).
            const delDocResult = await q.raw(
              `DELETE FROM \`task_doc\` WHERE task_id = '${sqlEscape(taskId)}'`,
            );
            if (delDocResult.isErr()) throw delDocResult.error;
            // Junction sync: delete existing task_skill rows for this task before re-inserting; whitelisted in doltSql guard (not core data).
            const delSkillResult = await q.raw(
              `DELETE FROM \`task_skill\` WHERE task_id = '${sqlEscape(taskId)}'`,
            );
            if (delSkillResult.isErr()) throw delSkillResult.error;
            for (const doc of parsedTask.docs ?? []) {
              const ins = await q.insert("task_doc", {
                task_id: taskId,
                doc,
              });
              if (ins.isErr()) throw ins.error;
            }
            for (const skill of parsedTask.skills ?? []) {
              const ins = await q.insert("task_skill", {
                task_id: taskId,
                skill,
              });
              if (ins.isErr()) throw ins.error;
            }

            // Handle edges
            for (const blockerKey of parsedTask.blockedBy) {
              const blockerTaskId = externalKeyToTaskId.get(blockerKey);
              if (!blockerTaskId) {
                console.warn(
                  `Blocker task with stable key '${blockerKey}' not found. Skipping edge creation for task '${parsedTask.stableKey}'.`,
                );
                continue;
              }

              const edgeExistsResult = await q.count("edge", {
                from_task_id: blockerTaskId,
                to_task_id: taskId,
                type: "blocks",
              });
              if (edgeExistsResult.isErr()) throw edgeExistsResult.error;
              const edgeExists = edgeExistsResult.value;

              if (edgeExists === 0) {
                const insertEdgeResult = await q.insert("edge", {
                  from_task_id: blockerTaskId,
                  to_task_id: taskId,
                  type: "blocks",
                  reason: "Blocked by plan import",
                });
                if (insertEdgeResult.isErr()) {
                  console.error(
                    "Error inserting new edge:",
                    insertEdgeResult.error,
                  );
                  throw insertEdgeResult.error;
                }
              }
            }
          }

          const commitResult = await doltCommit(
            "plan-import: upsert tasks and edges",
            repoPath,
            noCommit,
          );
          if (commitResult.isErr()) throw commitResult.error;

          return {
            importedTasksCount,
            createdPlansCount: 0, // This logic is in the cli/import.ts, not here.
          };
        })(),
        (e) => e as AppError, // Error handler for the promise
      );
    });
}
