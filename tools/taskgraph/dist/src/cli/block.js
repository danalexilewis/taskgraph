"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blockCommand = blockCommand;
const uuid_1 = require("uuid");
const commit_1 = require("../db/commit");
const utils_1 = require("./utils"); // Import Config
const invariants_1 = require("../domain/invariants");
const neverthrow_1 = require("neverthrow");
const errors_1 = require("../domain/errors");
const query_1 = require("../db/query");
function blockCommand(program) {
    program
        .command("block")
        .description("Block a task on another task")
        .argument("<taskId>", "ID of the task to be blocked")
        .requiredOption("--on <blockerTaskId>", "ID of the task that is blocking")
        .option("--reason <reason>", "Reason for the block")
        .action(async (taskId, options, cmd) => {
        const result = await (0, utils_1.readConfig)().asyncAndThen((config) => {
            // Removed async, added type
            const currentTimestamp = (0, query_1.now)();
            const q = (0, query_1.query)(config.doltRepoPath);
            return neverthrow_1.ResultAsync.fromPromise((async () => {
                const existingEdgesResult = await q.select("edge", {
                    where: { type: "blocks" },
                });
                if (existingEdgesResult.isErr())
                    throw existingEdgesResult.error;
                const existingEdges = existingEdgesResult.value;
                const cycleCheckResult = (0, invariants_1.checkNoBlockerCycle)(options.on, taskId, existingEdges);
                if (cycleCheckResult.isErr())
                    throw cycleCheckResult.error;
                const edgeExistsResult = await q.count("edge", {
                    from_task_id: options.on,
                    to_task_id: taskId,
                    type: "blocks",
                });
                if (edgeExistsResult.isErr())
                    throw edgeExistsResult.error;
                const edgeExists = edgeExistsResult.value;
                if (edgeExists === 0) {
                    const insertResult = await q.insert("edge", {
                        from_task_id: options.on,
                        to_task_id: taskId,
                        type: "blocks",
                        reason: options.reason ?? null,
                    });
                    if (insertResult.isErr())
                        throw insertResult.error;
                }
                else {
                    console.log(`Edge from ${options.on} to ${taskId} of type 'blocks' already exists. Skipping edge creation.`);
                }
                const currentStatusResult = await q.select("task", { columns: ["status"], where: { task_id: taskId } });
                if (currentStatusResult.isErr())
                    throw currentStatusResult.error;
                if (currentStatusResult.value.length === 0) {
                    throw (0, errors_1.buildError)(errors_1.ErrorCode.TASK_NOT_FOUND, `Task with ID ${taskId} not found.`);
                }
                const currentStatus = currentStatusResult.value[0].status;
                if (currentStatus !== "blocked") {
                    const transitionResult = (0, invariants_1.checkValidTransition)(currentStatus, "blocked");
                    if (transitionResult.isErr())
                        throw transitionResult.error;
                    const updateStatusResult = await q.update("task", { status: "blocked", updated_at: currentTimestamp }, { task_id: taskId });
                    if (updateStatusResult.isErr())
                        throw updateStatusResult.error;
                }
                const insertEventResult = await q.insert("event", {
                    event_id: (0, uuid_1.v4)(),
                    task_id: taskId,
                    kind: "blocked",
                    body: (0, query_1.jsonObj)({
                        blockerTaskId: options.on,
                        reason: options.reason ?? null,
                        timestamp: currentTimestamp,
                    }),
                    created_at: currentTimestamp,
                });
                if (insertEventResult.isErr())
                    throw insertEventResult.error;
                const commitResult = await (0, commit_1.doltCommit)(`task: block ${taskId} on ${options.on}`, config.doltRepoPath, cmd.parent?.opts().noCommit);
                if (commitResult.isErr())
                    throw commitResult.error;
                return {
                    task_id: taskId,
                    blocker_task_id: options.on,
                    reason: options.reason,
                    status: "blocked",
                };
            })(), (e) => e);
        });
        result.match((data) => {
            const resultData = data;
            if (!cmd.parent?.opts().json) {
                console.log(`Task ${resultData.task_id} blocked by ${resultData.blocker_task_id}.`);
            }
            else {
                console.log(JSON.stringify(resultData, null, 2));
            }
        }, (error) => {
            console.error(`Error blocking task: ${error.message}`);
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
