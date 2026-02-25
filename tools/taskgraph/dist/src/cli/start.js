"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCommand = startCommand;
const uuid_1 = require("uuid");
const commit_1 = require("../db/commit");
const utils_1 = require("./utils"); // Import Config
const invariants_1 = require("../domain/invariants");
const neverthrow_1 = require("neverthrow"); // Import err
const errors_1 = require("../domain/errors");
const query_1 = require("../db/query");
function startCommand(program) {
    program
        .command("start")
        .description("Start a task")
        .argument("<taskId>", "ID of the task to start")
        .action(async (taskId, options, cmd) => {
        const result = await (0, utils_1.readConfig)().asyncAndThen((config) => {
            // Removed async, added type
            const currentTimestamp = (0, query_1.now)();
            const q = (0, query_1.query)(config.doltRepoPath);
            return (0, invariants_1.checkRunnable)(taskId, config.doltRepoPath)
                .andThen(() => q.select("task", {
                columns: ["status"],
                where: { task_id: taskId },
            }))
                .andThen((currentStatusResult) => {
                if (currentStatusResult.length === 0) {
                    return (0, neverthrow_1.err)((0, errors_1.buildError)(errors_1.ErrorCode.TASK_NOT_FOUND, `Task with ID ${taskId} not found.`));
                }
                const currentStatus = currentStatusResult[0].status;
                return (0, invariants_1.checkValidTransition)(currentStatus, "doing");
            })
                .andThen(() => q.update("task", { status: "doing", updated_at: currentTimestamp }, { task_id: taskId }))
                .andThen(() => q.insert("event", {
                event_id: (0, uuid_1.v4)(),
                task_id: taskId,
                kind: "started",
                body: (0, query_1.jsonObj)({ timestamp: currentTimestamp }),
                created_at: currentTimestamp,
            }))
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
