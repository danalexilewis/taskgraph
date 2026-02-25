"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCommand = startCommand;
const uuid_1 = require("uuid");
const connection_1 = require("../db/connection");
const commit_1 = require("../db/commit");
const utils_1 = require("./utils"); // Import Config
const invariants_1 = require("../domain/invariants");
const neverthrow_1 = require("neverthrow"); // Import err
const errors_1 = require("../domain/errors");
const escape_1 = require("../db/escape");
function startCommand(program) {
    program
        .command("start")
        .description("Start a task")
        .argument("<taskId>", "ID of the task to start")
        .action(async (taskId, options, cmd) => {
        const result = await (0, utils_1.readConfig)().asyncAndThen((config) => {
            // Removed async, added type
            const escapedTaskId = (0, escape_1.sqlEscape)(taskId);
            const now = new Date().toISOString().slice(0, 19).replace("T", " ");
            return (0, invariants_1.checkRunnable)(taskId, config.doltRepoPath)
                .andThen(() => (0, connection_1.doltSql)(`SELECT status FROM task WHERE task_id = '${escapedTaskId}';`, config.doltRepoPath))
                .andThen((currentStatusResult) => {
                const currentStatusArray = currentStatusResult;
                if (currentStatusArray.length === 0) {
                    return (0, neverthrow_1.err)((0, errors_1.buildError)(errors_1.ErrorCode.TASK_NOT_FOUND, `Task with ID ${taskId} not found.`));
                }
                const currentStatus = currentStatusArray[0].status;
                return (0, invariants_1.checkValidTransition)(currentStatus, "doing");
            })
                .andThen(() => (0, connection_1.doltSql)(`UPDATE task SET status = 'doing', updated_at = '${now}' WHERE task_id = '${escapedTaskId}';`, config.doltRepoPath))
                .andThen(() => (0, connection_1.doltSql)(`INSERT INTO event (event_id, task_id, kind, body, created_at) VALUES (
              '${(0, uuid_1.v4)()}',
              '${escapedTaskId}',
              'started',
              JSON_OBJECT('timestamp', '${now}'),
              '${now}'
            );`, config.doltRepoPath))
                .andThen(() => (0, commit_1.doltCommit)(`task: start ${taskId}`, config.doltRepoPath, cmd.parent?.opts().noCommit))
                .map(() => ({ task_id: taskId, status: "doing" }));
        });
        result.match((data) => {
            const resultData = data;
            if (!cmd.parent?.opts().json) {
                console.log(`Task ${resultData.task_id} started.`);
            }
            else {
                console.log(JSON.stringify(resultData, null, 2));
            }
        }, (error) => {
            console.error(`Error starting task: ${error.message}`);
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
