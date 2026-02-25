"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blockCommand = blockCommand;
const uuid_1 = require("uuid");
const connection_1 = require("../db/connection");
const commit_1 = require("../db/commit");
const utils_1 = require("./utils"); // Import Config
const invariants_1 = require("../domain/invariants");
const neverthrow_1 = require("neverthrow");
const errors_1 = require("../domain/errors");
const escape_1 = require("../db/escape");
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
            const escapedTaskId = (0, escape_1.sqlEscape)(taskId);
            const escapedBlockerTaskId = (0, escape_1.sqlEscape)(options.on);
            const escapedReason = options.reason ? (0, escape_1.sqlEscape)(options.reason) : null;
            const now = new Date().toISOString().slice(0, 19).replace("T", " ");
            return neverthrow_1.ResultAsync.fromPromise((async () => {
                const existingEdgesResult = await (0, connection_1.doltSql)(`SELECT from_task_id, to_task_id, type FROM edge WHERE type = 'blocks';`, config.doltRepoPath);
                if (existingEdgesResult.isErr())
                    throw existingEdgesResult.error;
                const existingEdges = existingEdgesResult.value;
                const cycleCheckResult = (0, invariants_1.checkNoBlockerCycle)(options.on, taskId, existingEdges);
                if (cycleCheckResult.isErr())
                    throw cycleCheckResult.error;
                const edgeExistsResult = await (0, connection_1.doltSql)(`SELECT COUNT(*) FROM edge WHERE from_task_id = '${escapedBlockerTaskId}' AND to_task_id = '${escapedTaskId}' AND type = 'blocks';`, config.doltRepoPath);
                if (edgeExistsResult.isErr())
                    throw edgeExistsResult.error;
                const edgeExists = edgeExistsResult.value[0]["COUNT(*)"] === 0;
                if (edgeExists) {
                    const insertResult = await (0, connection_1.doltSql)(`INSERT INTO edge (from_task_id, to_task_id, type, reason)
                VALUES (
                  '${escapedBlockerTaskId}',
                  '${escapedTaskId}',
                  'blocks',
                  ${escapedReason ? `'${escapedReason}'` : "NULL"}
                );`, config.doltRepoPath);
                    if (insertResult.isErr())
                        throw insertResult.error;
                }
                else {
                    console.log(`Edge from ${options.on} to ${taskId} of type 'blocks' already exists. Skipping edge creation.`);
                }
                const currentStatusResult = await (0, connection_1.doltSql)(`SELECT status FROM task WHERE task_id = '${escapedTaskId}';`, config.doltRepoPath);
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
                    const updateStatusResult = await (0, connection_1.doltSql)(`UPDATE task SET status = 'blocked', updated_at = '${now}' WHERE task_id = '${escapedTaskId}';`, config.doltRepoPath);
                    if (updateStatusResult.isErr())
                        throw updateStatusResult.error;
                }
                const insertEventResult = await (0, connection_1.doltSql)(`INSERT INTO event (event_id, task_id, kind, body, created_at) VALUES (
              '${(0, uuid_1.v4)()}',
              '${escapedTaskId}',
              'blocked',
              JSON_OBJECT(
                'blockerTaskId', '${escapedBlockerTaskId}',
                'reason', ${escapedReason ? `'${escapedReason}'` : "NULL"},
                'timestamp', '${now}'
              ),
              '${now}'
            );`, config.doltRepoPath);
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
