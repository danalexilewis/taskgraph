"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.doneCommand = doneCommand;
const uuid_1 = require("uuid");
const connection_1 = require("../db/connection");
const commit_1 = require("../db/commit");
const utils_1 = require("./utils"); // Import Config
const invariants_1 = require("../domain/invariants");
const neverthrow_1 = require("neverthrow");
const errors_1 = require("../domain/errors");
const escape_1 = require("../db/escape");
function doneCommand(program) {
    program
        .command("done")
        .description("Mark a task as done")
        .argument("<taskId>", "ID of the task to mark as done")
        .option("--evidence <text>", "Evidence of completion", "")
        .option("--checks <json>", "JSON array of acceptance checks")
        .option("--force", "Allow marking as done even if not in 'doing' status", false)
        .action(async (taskId, options, cmd) => {
        const result = await (0, utils_1.readConfig)().asyncAndThen((config) => {
            // Removed async, added type
            const escapedTaskId = (0, escape_1.sqlEscape)(taskId);
            const now = new Date().toISOString().slice(0, 19).replace("T", " ");
            return (0, connection_1.doltSql)(`SELECT status FROM task WHERE task_id = '${escapedTaskId}';`, config.doltRepoPath)
                .andThen((currentStatusResult) => {
                const currentStatusArray = currentStatusResult;
                if (currentStatusArray.length === 0) {
                    return (0, neverthrow_1.err)((0, errors_1.buildError)(errors_1.ErrorCode.TASK_NOT_FOUND, `Task with ID ${taskId} not found.`));
                }
                const currentStatus = currentStatusArray[0].status;
                if (!options.force) {
                    const transitionResult = (0, invariants_1.checkValidTransition)(currentStatus, "done");
                    if (transitionResult.isErr())
                        return (0, neverthrow_1.err)(transitionResult.error);
                }
                return (0, neverthrow_1.ok)(currentStatus);
            })
                .andThen(() => (0, connection_1.doltSql)(`UPDATE task SET status = 'done', updated_at = '${now}' WHERE task_id = '${escapedTaskId}';`, config.doltRepoPath))
                .andThen(() => {
                let parsedChecks = null;
                if (options.checks) {
                    try {
                        parsedChecks = JSON.parse(options.checks);
                    }
                    catch (e) {
                        return (0, neverthrow_1.err)((0, errors_1.buildError)(errors_1.ErrorCode.VALIDATION_FAILED, `Invalid JSON for acceptance checks: ${options.checks}`, e));
                    }
                }
                const eventBody = {
                    evidence: options.evidence,
                    checks: parsedChecks,
                    timestamp: now,
                };
                const insertEventSql = `
              INSERT INTO event (event_id, task_id, kind, body, created_at) VALUES (
                '${(0, uuid_1.v4)()}',
                '${escapedTaskId}',
                'done',
                JSON_OBJECT(
                  'evidence', '${(0, escape_1.sqlEscape)(eventBody.evidence)}',
                  'checks', ${eventBody.checks ? `'${(0, escape_1.sqlEscape)(JSON.stringify(eventBody.checks))}'` : "NULL"},
                  'timestamp', '${eventBody.timestamp}'
                ),
                '${now}'
              );
            `;
                return (0, connection_1.doltSql)(insertEventSql, config.doltRepoPath);
            })
                .andThen(() => (0, commit_1.doltCommit)(`task: done ${taskId}`, config.doltRepoPath, cmd.parent?.opts().noCommit))
                .map(() => ({
                task_id: taskId,
                status: "done",
                evidence: options.evidence,
                checks: options.checks,
            }));
        });
        result.match((data) => {
            const resultData = data;
            if (!cmd.parent?.opts().json) {
                console.log(`Task ${resultData.task_id} marked as done.`);
            }
            else {
                console.log(JSON.stringify(resultData, null, 2));
            }
        }, (error) => {
            console.error(`Error marking task ${taskId} as done: ${error.message}`);
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
