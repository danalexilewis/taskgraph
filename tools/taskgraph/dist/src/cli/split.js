"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitCommand = splitCommand;
const uuid_1 = require("uuid");
const commit_1 = require("../db/commit");
const utils_1 = require("./utils"); // Import Config
const types_1 = require("../domain/types");
const neverthrow_1 = require("neverthrow");
const errors_1 = require("../domain/errors");
const query_1 = require("../db/query");
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
            const currentTimestamp = (0, query_1.now)();
            return neverthrow_1.ResultAsync.fromPromise((async () => {
                const q = (0, query_1.query)(config.doltRepoPath);
                const originalTaskQueryResult = await q.select("task", { where: { task_id: taskId } });
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
                        created_at: currentTimestamp,
                        updated_at: currentTimestamp,
                        external_key: null,
                    };
                    newTasks.push(newTask);
                    taskMappings.push({ original: taskId, new: newTaskId });
                    const insertTaskResult = await q.insert("task", {
                        task_id: newTask.task_id,
                        plan_id: newTask.plan_id,
                        feature_key: newTask.feature_key ?? null,
                        title: newTask.title,
                        intent: newTask.intent ?? null,
                        scope_in: newTask.scope_in ?? null,
                        scope_out: newTask.scope_out ?? null,
                        acceptance: newTask.acceptance ? (0, query_1.jsonObj)({ val: JSON.stringify(newTask.acceptance) }) : null,
                        status: newTask.status,
                        owner: newTask.owner,
                        area: newTask.area ?? null,
                        risk: newTask.risk,
                        estimate_mins: newTask.estimate_mins ?? null,
                        created_at: newTask.created_at,
                        updated_at: newTask.updated_at,
                    });
                    if (insertTaskResult.isErr())
                        throw (0, errors_1.buildError)(errors_1.ErrorCode.DB_QUERY_FAILED, "Failed to insert new task", insertTaskResult.error);
                    const insertNewTaskEventResult = await q.insert("event", {
                        event_id: (0, uuid_1.v4)(),
                        task_id: newTask.task_id,
                        kind: "created",
                        body: (0, query_1.jsonObj)({ title: newTask.title, splitFrom: taskId }),
                        created_at: currentTimestamp,
                    });
                    if (insertNewTaskEventResult.isErr())
                        throw (0, errors_1.buildError)(errors_1.ErrorCode.DB_QUERY_FAILED, "Failed to insert new task event", insertNewTaskEventResult.error);
                    let fromId = taskId;
                    let toId = newTask.task_id;
                    if (options.linkDirection === "new-to-original") {
                        fromId = newTask.task_id;
                        toId = taskId;
                    }
                    const insertEdgeResult = await q.insert("edge", {
                        from_task_id: fromId,
                        to_task_id: toId,
                        type: "relates",
                        reason: "split dependency",
                    });
                    if (insertEdgeResult.isErr())
                        throw (0, errors_1.buildError)(errors_1.ErrorCode.DB_QUERY_FAILED, "Failed to insert new edge", insertEdgeResult.error);
                }
                if (!options.keepOriginal) {
                    const updateOriginalTaskResult = await q.update("task", { status: "canceled", updated_at: currentTimestamp }, { task_id: taskId });
                    if (updateOriginalTaskResult.isErr())
                        throw (0, errors_1.buildError)(errors_1.ErrorCode.DB_QUERY_FAILED, "Failed to update original task", updateOriginalTaskResult.error);
                }
                const insertSplitEventResult = await q.insert("event", {
                    event_id: (0, uuid_1.v4)(),
                    task_id: taskId,
                    kind: "split",
                    body: (0, query_1.jsonObj)({
                        newTasks: newTasks.map((t) => ({ id: t.task_id, title: t.title })),
                        taskMappings,
                    }),
                    created_at: currentTimestamp,
                });
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
