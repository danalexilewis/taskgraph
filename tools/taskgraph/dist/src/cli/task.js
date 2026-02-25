"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskCommand = taskCommand;
const commander_1 = require("commander");
const uuid_1 = require("uuid");
const commit_1 = require("../db/commit");
const utils_1 = require("./utils"); // Import Config
const neverthrow_1 = require("neverthrow"); // Import errAsync
const errors_1 = require("../domain/errors");
const query_1 = require("../db/query");
function taskCommand(program) {
    program
        .command("task")
        .description("Manage tasks")
        .addCommand(taskNewCommand());
}
function taskNewCommand() {
    return new commander_1.Command("new")
        .description("Create a new task")
        .argument("<title>", "Title of the task")
        .requiredOption("--plan <planId>", "ID of the parent plan") // Changed to requiredOption
        .option("--feature <featureKey>", "Feature key for portfolio analysis")
        .option("--area <area>", "Area of the task (e.g., frontend, backend)")
        .option("--acceptance <json>", "JSON array of acceptance checks")
        .action(async (title, options, cmd) => {
        const result = await (0, utils_1.readConfig)().asyncAndThen((config) => {
            // Removed async, added type
            const task_id = (0, uuid_1.v4)();
            const currentTimestamp = (0, query_1.now)();
            const q = (0, query_1.query)(config.doltRepoPath);
            let acceptanceJson = null;
            if (options.acceptance) {
                try {
                    const parsedAcceptance = JSON.parse(options.acceptance);
                    acceptanceJson = (0, query_1.jsonObj)({ val: options.acceptance });
                }
                catch (e) {
                    return (0, neverthrow_1.errAsync)((0, errors_1.buildError)(errors_1.ErrorCode.VALIDATION_FAILED, `Invalid JSON for acceptance criteria: ${options.acceptance}`, e));
                }
            }
            return q
                .insert("task", {
                task_id,
                plan_id: options.plan,
                feature_key: options.feature ?? null,
                title,
                area: options.area ?? null,
                acceptance: acceptanceJson,
                created_at: currentTimestamp,
                updated_at: currentTimestamp,
            })
                .andThen(() => {
                return q.insert("event", {
                    event_id: (0, uuid_1.v4)(),
                    task_id,
                    kind: "created",
                    body: (0, query_1.jsonObj)({ title }),
                    created_at: currentTimestamp,
                });
            })
                .andThen(() => (0, commit_1.doltCommit)(`task: create ${task_id} - ${title}`, config.doltRepoPath, cmd.parent?.opts().noCommit))
                .map(() => ({
                task_id,
                plan_id: options.plan,
                title,
                feature_key: options.feature,
                area: options.area,
            }));
        });
        result.match((data) => {
            // Type unknown
            const resultData = data; // Cast to Task
            if (!cmd.parent?.opts().json) {
                console.log(`Task created with ID: ${resultData.task_id} for Plan ID: ${resultData.plan_id}`);
            }
            else {
                console.log(JSON.stringify(resultData, null, 2));
            }
        }, (error) => {
            // Type AppError
            console.error(`Error creating task: ${error.message}`);
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
