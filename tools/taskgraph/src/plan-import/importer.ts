import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { Task, Edge, Event } from "../domain/types";
import { ResultAsync, ok, err } from "neverthrow";
import { AppError, buildError, ErrorCode } from "../domain/errors";
import { query, now, jsonObj } from "../db/query";

interface ParsedTask {
  stableKey: string;
  title: string;
  feature?: string;
  area?: string;
  blockedBy: string[];
  acceptance: string[];
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
): ResultAsync<ImportResult, AppError> {
  const currentTimestamp = now();
  const q = query(repoPath);

  return q
    .select<
      Task[]
    >("task", { columns: ["task_id", "external_key"], where: { plan_id: planId } })
    .andThen((existingTasksResult) => {
      return ResultAsync.fromPromise(
        (async () => {
          const existingTasks = existingTasksResult as Task[];
          const externalKeyToTaskId = new Map<string, string>();
          existingTasks.forEach((task) => {
            if (task.external_key) {
              externalKeyToTaskId.set(task.external_key, task.task_id);
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
                  acceptance:
                    parsedTask.acceptance.length > 0
                      ? jsonObj({ val: JSON.stringify(parsedTask.acceptance) })
                      : null,
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
              const insertResult = await q.insert("task", {
                task_id: taskId,
                plan_id: planId,
                external_key: parsedTask.stableKey,
                title: parsedTask.title,
                feature_key: parsedTask.feature ?? null,
                area: parsedTask.area ?? null,
                acceptance:
                  parsedTask.acceptance.length > 0
                    ? jsonObj({ val: JSON.stringify(parsedTask.acceptance) })
                    : null,
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
                  externalKey: parsedTask.stableKey,
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
