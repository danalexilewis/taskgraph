"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextCommand = nextCommand;
const connection_1 = require("../db/connection");
const utils_1 = require("./utils");
const neverthrow_1 = require("neverthrow"); // Added errAsync
const errors_1 = require("../domain/errors");
const escape_1 = require("../db/escape");
function nextCommand(program) {
    program
        .command("next")
        .description("Select runnable tasks")
        .option("--plan <planId>", "Optional filter by plan ID or title")
        .option("--limit <limit>", "Limit the number of tasks returned", "10")
        .action(async (options, cmd) => {
        const result = await (0, utils_1.readConfig)().asyncAndThen((config) => {
            const limit = parseInt(options.limit, 10);
            if (isNaN(limit) || limit <= 0) {
                return (0, neverthrow_1.errAsync)((0, errors_1.buildError)(errors_1.ErrorCode.VALIDATION_FAILED, `Invalid limit: ${options.limit}. Must be a positive integer.`)); // Changed to errAsync
            }
            let planFilter = "";
            if (options.plan) {
                const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(options.plan);
                if (isUUID) {
                    planFilter = `AND p.plan_id = '${(0, escape_1.sqlEscape)(options.plan)}'`;
                }
                else {
                    planFilter = `AND p.title = '${(0, escape_1.sqlEscape)(options.plan)}'`;
                }
            }
            const nextTasksQuery = `
          SELECT t.task_id, t.title, p.title as plan_title, t.risk, t.estimate_mins,
            (SELECT COUNT(*) FROM edge e 
             JOIN task bt ON e.from_task_id = bt.task_id 
             WHERE e.to_task_id = t.task_id AND e.type = 'blocks' 
             AND bt.status NOT IN ('done','canceled')) as unmet_blockers
          FROM task t
          JOIN plan p ON t.plan_id = p.plan_id
          WHERE t.status = 'todo'
          ${planFilter}
          HAVING unmet_blockers = 0
          ORDER BY p.priority DESC, t.risk ASC, 
            CASE WHEN t.estimate_mins IS NULL THEN 1 ELSE 0 END,
            t.estimate_mins ASC, t.created_at ASC
          LIMIT ${limit}
        `;
            return (0, connection_1.doltSql)(nextTasksQuery, config.doltRepoPath);
        });
        result.match((tasks) => {
            const tasksArray = tasks;
            if (!cmd.parent?.opts().json) {
                if (tasksArray.length > 0) {
                    console.log("Runnable Tasks:");
                    tasksArray.forEach((task) => {
                        console.log(`  ID: ${task.task_id}, Title: ${task.title}, Plan: ${task.plan_title}, Risk: ${task.risk}, Estimate: ${task.estimate_mins ?? "N/A"}`);
                    });
                }
                else {
                    console.log("No runnable tasks found.");
                }
            }
            else {
                console.log(JSON.stringify(tasksArray, null, 2));
            }
        }, (error) => {
            console.error(`Error fetching next tasks: ${error.message}`);
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
