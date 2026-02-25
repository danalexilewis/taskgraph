"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertTasksAndEdges = upsertTasksAndEdges;
const uuid_1 = require("uuid");
const connection_1 = require("../db/connection");
const commit_1 = require("../db/commit");
const neverthrow_1 = require("neverthrow");
const escape_1 = require("../db/escape");
function upsertTasksAndEdges(planId, parsedTasks, repoPath, noCommit = false) {
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    return (0, connection_1.doltSql)(`SELECT task_id, external_key FROM task WHERE plan_id = '${(0, escape_1.sqlEscape)(planId)}';`, repoPath).andThen((existingTasksResult) => {
        // Removed async from here
        return neverthrow_1.ResultAsync.fromPromise((async () => {
            const existingTasks = existingTasksResult;
            const externalKeyToTaskId = new Map();
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
                    const updateTaskSql = `
                UPDATE task
                SET
                  title = '${(0, escape_1.sqlEscape)(parsedTask.title)}',
                  feature_key = ${parsedTask.feature ? `'${(0, escape_1.sqlEscape)(parsedTask.feature)}'` : "NULL"},
                  area = ${parsedTask.area ? `'${(0, escape_1.sqlEscape)(parsedTask.area)}'` : "NULL"},
                  acceptance = ${parsedTask.acceptance.length > 0 ? `JSON_OBJECT('val', '${(0, escape_1.sqlEscape)(JSON.stringify(parsedTask.acceptance))}')` : "NULL"},
                  updated_at = '${now}'
                WHERE task_id = '${(0, escape_1.sqlEscape)(taskId)}';
              `;
                    const updateResult = await (0, connection_1.doltSql)(updateTaskSql, repoPath);
                    if (updateResult.isErr()) {
                        console.error("Error updating task:", updateResult.error);
                        throw updateResult.error;
                    }
                }
                else {
                    // Insert new task
                    taskId = (0, uuid_1.v4)();
                    importedTasksCount++;
                    const insertTaskSql = `
                INSERT INTO task (task_id, plan_id, external_key, title, feature_key, area, acceptance, created_at, updated_at)
                VALUES (
                  '${(0, escape_1.sqlEscape)(taskId)}',
                  '${(0, escape_1.sqlEscape)(planId)}',
                  '${(0, escape_1.sqlEscape)(parsedTask.stableKey)}',
                  '${(0, escape_1.sqlEscape)(parsedTask.title)}',
                  ${parsedTask.feature ? `'${(0, escape_1.sqlEscape)(parsedTask.feature)}'` : "NULL"},
                  ${parsedTask.area ? `'${(0, escape_1.sqlEscape)(parsedTask.area)}'` : "NULL"},
                  ${parsedTask.acceptance.length > 0 ? `JSON_OBJECT('val', '${(0, escape_1.sqlEscape)(JSON.stringify(parsedTask.acceptance))}')` : "NULL"},
                  '${now}',
                  '${now}'
                );
              `;
                    const insertResult = await (0, connection_1.doltSql)(insertTaskSql, repoPath);
                    if (insertResult.isErr()) {
                        console.error("Error inserting new task:", insertResult.error);
                        throw insertResult.error;
                    }
                    const insertEventSql = `
                INSERT INTO event (event_id, task_id, kind, body, created_at)
                VALUES (
                  '${(0, uuid_1.v4)()}',
                  '${(0, escape_1.sqlEscape)(taskId)}',
                  'created',
                  JSON_OBJECT('title', '${(0, escape_1.sqlEscape)(parsedTask.title)}', 'externalKey', '${(0, escape_1.sqlEscape)(parsedTask.stableKey)}'),
                  '${now}'
                );
              `;
                    const insertEventResult = await (0, connection_1.doltSql)(insertEventSql, repoPath);
                    if (insertEventResult.isErr()) {
                        console.error("Error inserting new task event:", insertEventResult.error);
                        throw insertEventResult.error;
                    }
                }
                // Handle edges
                for (const blockerKey of parsedTask.blockedBy) {
                    const blockerTaskId = externalKeyToTaskId.get(blockerKey);
                    if (!blockerTaskId) {
                        console.warn(`Blocker task with stable key '${blockerKey}' not found. Skipping edge creation for task '${parsedTask.stableKey}'.`);
                        continue;
                    }
                    const checkEdgeSql = `SELECT COUNT(*) FROM edge WHERE from_task_id = '${(0, escape_1.sqlEscape)(blockerTaskId)}' AND to_task_id = '${(0, escape_1.sqlEscape)(taskId)}' AND type = 'blocks';`;
                    const edgeExistsResult = await (0, connection_1.doltSql)(checkEdgeSql, repoPath);
                    if (edgeExistsResult.isErr()) {
                        console.error("Error checking for existing edge", edgeExistsResult.error);
                        throw edgeExistsResult.error;
                    }
                    if (edgeExistsResult.value[0]["COUNT(*)"] === 0) {
                        const insertEdgeSql = `
                INSERT INTO edge (from_task_id, to_task_id, type, reason)
                VALUES (
                  '${(0, escape_1.sqlEscape)(blockerTaskId)}',
                  '${(0, escape_1.sqlEscape)(taskId)}',
                  'blocks',
                  '${(0, escape_1.sqlEscape)("Blocked by plan import")}'
                );
              `;
                        const insertEdgeResult = await (0, connection_1.doltSql)(insertEdgeSql, repoPath);
                        if (insertEdgeResult.isErr()) {
                            console.error("Error inserting new edge:", insertEdgeResult.error);
                            throw insertEdgeResult.error;
                        }
                    }
                }
            }
            const commitResult = await (0, commit_1.doltCommit)("plan-import: upsert tasks and edges", repoPath, noCommit);
            if (commitResult.isErr())
                throw commitResult.error;
            return {
                importedTasksCount,
                createdPlansCount: 0, // This logic is in the cli/import.ts, not here.
            };
        })(), (e) => e);
    });
}
