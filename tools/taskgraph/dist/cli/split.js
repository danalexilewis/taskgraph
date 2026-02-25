"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitCommand = splitCommand;
const uuid_1 = require("uuid");
const connection_1 = require("../db/connection");
const commit_1 = require("../db/commit");
const utils_1 = require("./utils"); // Import Config
const types_1 = require("../domain/types");
const neverthrow_1 = require("neverthrow");
const errors_1 = require("../domain/errors");
const escape_1 = require("../db/escape");
function splitCommand(program) {
    program
        .command("split")
        .description("Decompose a task into multiple subtasks")
        .argument("<taskId>", "ID of the task to split")
        .requiredOption("--into <titles>", "Pipe-separated titles of new subtasks (e.g., 'Task 1|Task 2')")
        .option("--keep-original", "Keep the original task as a parent (default: true)", true)
        .option("--link-direction <direction>", "Direction of the new edges (original-to-new or new-to-original)", "original-to-new")
        .action(async (taskId, options, cmd) => {
        const result = await (0, utils_1.readConfig)().asyncAndThen((config) => {
            // Removed async, added type
            const escapedTaskId = (0, escape_1.sqlEscape)(taskId);
            const now = new Date().toISOString().slice(0, 19).replace("T", " ");
            return neverthrow_1.ResultAsync.fromPromise((async () => {
                const originalTaskQueryResult = await (0, connection_1.doltSql)(`SELECT * FROM task WHERE task_id = '${escapedTaskId}';`, config.doltRepoPath);
                if (originalTaskQueryResult.isErr())
                    throw originalTaskQueryResult.error;
                const originalTasks = originalTaskQueryResult.value;
                if (originalTasks.length === 0) {
                    throw (0, errors_1.buildError)(errors_1.ErrorCode.TASK_NOT_FOUND, `Task with ID ${taskId} not found.`);
                }
                const originalTask = originalTasks[0];
                const newTitles = options.into
                    .split("|")
                    .map((s) => s.trim());
                const newTasks = [];
                const taskMappings = [];
                for (const title of newTitles) {
                    const newTaskId = (0, uuid_1.v4)();
                    const newTask = {
                        task_id: newTaskId,
                        plan_id: originalTask.plan_id,
                        feature_key: originalTask.feature_key,
                        title: title,
                        intent: originalTask.intent,
                        scope_in: originalTask.scope_in,
                        scope_out: originalTask.scope_out,
                        acceptance: originalTask.acceptance,
                        status: types_1.TaskStatusSchema.enum.todo, // New tasks start as todo
                        owner: originalTask.owner,
                        area: originalTask.area,
                        risk: originalTask.risk,
                        estimate_mins: null, // Estimate can be re-evaluated for subtasks
                        created_at: now,
                        updated_at: now,
                        external_key: null,
                    };
                    newTasks.push(newTask);
                    taskMappings.push({ original: taskId, new: newTaskId });
                    const insertNewTaskSql = `
                INSERT INTO task (task_id, plan_id, feature_key, title, intent, scope_in, scope_out, acceptance, status, owner, area, risk, created_at, updated_at)
                VALUES (
                  '${(0, escape_1.sqlEscape)(newTask.task_id)}',
                  '${(0, escape_1.sqlEscape)(newTask.plan_id)}',
                  ${newTask.feature_key ? `'${(0, escape_1.sqlEscape)(newTask.feature_key)}'` : "NULL"},
                  '${(0, escape_1.sqlEscape)(newTask.title)}',
                  ${newTask.intent ? `'${(0, escape_1.sqlEscape)(newTask.intent)}'` : "NULL"},
                  ${newTask.scope_in ? `'${(0, escape_1.sqlEscape)(newTask.scope_in)}'` : "NULL"},
                  ${newTask.scope_out ? `'${(0, escape_1.sqlEscape)(newTask.scope_out)}'` : "NULL"},
                  ${newTask.acceptance ? `JSON_OBJECT('val', '${(0, escape_1.sqlEscape)(JSON.stringify(newTask.acceptance))}')` : "NULL"},
                  '${newTask.status}',
                  '${newTask.owner}',
                  ${newTask.area ? `'${(0, escape_1.sqlEscape)(newTask.area)}'` : "NULL"},
                  '${newTask.risk}',
                  '${newTask.created_at}',
                  '${newTask.updated_at}'
                );
              `;
                    const insertTaskResult = await (0, connection_1.doltSql)(insertNewTaskSql, config.doltRepoPath);
                    if (insertTaskResult.isErr())
                        throw (0, errors_1.buildError)(errors_1.ErrorCode.DB_QUERY_FAILED, "Failed to insert new task", insertTaskResult.error);
                    const insertNewTaskEventSql = `
                INSERT INTO event (event_id, task_id, kind, body, created_at)
                VALUES (
                  '${(0, uuid_1.v4)()}',
                  '${(0, escape_1.sqlEscape)(newTask.task_id)}',
                  'created',
                  JSON_OBJECT('title', '${(0, escape_1.sqlEscape)(newTask.title)}', 'splitFrom', '${escapedTaskId}'),
                  '${now}'
                );
              `;
                    const insertEventResult = await (0, connection_1.doltSql)(insertNewTaskEventSql, config.doltRepoPath);
                    if (insertEventResult.isErr())
                        throw (0, errors_1.buildError)(errors_1.ErrorCode.DB_QUERY_FAILED, "Failed to insert new task event", insertEventResult.error);
                    let fromId = escapedTaskId;
                    let toId = (0, escape_1.sqlEscape)(newTask.task_id);
                    if (options.linkDirection === "new-to-original") {
                        fromId = (0, escape_1.sqlEscape)(newTask.task_id);
                        toId = escapedTaskId;
                    }
                    const insertEdgeSql = `
                INSERT INTO edge (from_task_id, to_task_id, type, reason)
                VALUES (
                  '${fromId}',
                  '${toId}',
                  'relates',
                  '${(0, escape_1.sqlEscape)("split dependency")}'
                );
              `;
                    const insertEdgeResult = await (0, connection_1.doltSql)(insertEdgeSql, config.doltRepoPath);
                    if (insertEdgeResult.isErr())
                        throw (0, errors_1.buildError)(errors_1.ErrorCode.DB_QUERY_FAILED, "Failed to insert new edge", insertEdgeResult.error);
                }
                if (!options.keepOriginal) {
                    const updateOriginalTaskSql = `
                UPDATE task
                SET status = 'canceled',
                    updated_at = '${now}'
                WHERE task_id = '${escapedTaskId}';
              `;
                    const updateTaskResult = await (0, connection_1.doltSql)(updateOriginalTaskSql, config.doltRepoPath);
                    if (updateTaskResult.isErr())
                        throw (0, errors_1.buildError)(errors_1.ErrorCode.DB_QUERY_FAILED, "Failed to update original task", updateTaskResult.error);
                }
                const insertSplitEventSql = `
              INSERT INTO event (event_id, task_id, kind, body, created_at)
              VALUES (
                '${(0, uuid_1.v4)()}',
                '${escapedTaskId}',
                'split',
                JSON_OBJECT('newTasks', '${(0, escape_1.sqlEscape)(JSON.stringify(newTasks.map((t) => ({ id: t.task_id, title: t.title }))))}', 'taskMappings', '${(0, escape_1.sqlEscape)(JSON.stringify(taskMappings))}'),
                '${now}'
              );
            `;
                const insertSplitEventResult = await (0, connection_1.doltSql)(insertSplitEventSql, config.doltRepoPath);
                if (insertSplitEventResult.isErr())
                    throw (0, errors_1.buildError)(errors_1.ErrorCode.DB_QUERY_FAILED, "Failed to insert split event", insertSplitEventResult.error);
                const commitResult = await (0, commit_1.doltCommit)(`task: split ${taskId} into ${newTitles.join(", ")}`, config.doltRepoPath, cmd.parent?.opts().noCommit);
                if (commitResult.isErr())
                    throw commitResult.error;
                return {
                    original_task_id: taskId,
                    new_tasks: newTasks.map((t) => ({
                        task_id: t.task_id,
                        title: t.title,
                    })),
                    status: options.keepOriginal ? originalTask.status : "canceled",
                };
            })(), (e) => e);
        });
        result.match((data) => {
            const resultData = data;
            if (!cmd.parent?.opts().json) {
                console.log(`Task ${resultData.original_task_id} split into new tasks.`);
                resultData.new_tasks.forEach((task) => console.log(`  - ${task.title} (ID: ${task.task_id})`));
            }
            else {
                console.log(JSON.stringify(resultData, null, 2));
            }
        }, (error) => {
            console.error(`Error splitting task: ${error.message}`);
            if (cmd.parent?.opts().json) {
                console.log(JSON.stringify({
                    status: "error",
                    code: error.code,
                    message: error.message,
                    cause: error.cause,
                }));
            }
            process.exit(1);
        });
    });
}
