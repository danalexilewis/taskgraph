"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskCommand = taskCommand;
const commander_1 = require("commander");
const uuid_1 = require("uuid");
const connection_1 = require("../db/connection");
const commit_1 = require("../db/commit");
const utils_1 = require("./utils"); // Import Config
const neverthrow_1 = require("neverthrow"); // Import errAsync
const errors_1 = require("../domain/errors");
const escape_1 = require("../db/escape");
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
            const now = new Date().toISOString().slice(0, 19).replace("T", " ");
            let acceptanceJson = "NULL";
            if (options.acceptance) {
                try {
                    const parsedAcceptance = JSON.parse(options.acceptance);
                    acceptanceJson = `JSON_OBJECT('val', '${(0, escape_1.sqlEscape)(options.acceptance)}')`; // Fixed JSON_OBJECT syntax
                }
                catch (e) {
                    return (0, neverthrow_1.errAsync)((0, errors_1.buildError)(errors_1.ErrorCode.VALIDATION_FAILED, `Invalid JSON for acceptance criteria: ${options.acceptance}`, e)); // Changed to errAsync
                }
            }
            const insertTaskSql = `
          INSERT INTO task (task_id, plan_id, feature_key, title, area, acceptance, created_at, updated_at)
          VALUES (
            '${(0, escape_1.sqlEscape)(task_id)}',
            '${(0, escape_1.sqlEscape)(options.plan)}',
            ${options.feature ? `'${(0, escape_1.sqlEscape)(options.feature)}'` : "NULL"},
            '${(0, escape_1.sqlEscape)(title)}',
            ${options.area ? `'${(0, escape_1.sqlEscape)(options.area)}'` : "NULL"},
            ${acceptanceJson},
            '${now}',
            '${now}'
          );
        `;
            return (0, connection_1.doltSql)(insertTaskSql, config.doltRepoPath)
                .andThen(() => {
                const insertEventSql = `
              INSERT INTO event (event_id, task_id, kind, body, created_at)
              VALUES (
                '${(0, uuid_1.v4)()}',
                '${(0, escape_1.sqlEscape)(task_id)}',
                'created',
                JSON_OBJECT('title', '${(0, escape_1.sqlEscape)(title)}'),
                '${now}'
              );
            `;
                return (0, connection_1.doltSql)(insertEventSql, config.doltRepoPath);
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
