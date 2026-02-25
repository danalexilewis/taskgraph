"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planCommand = planCommand;
const commander_1 = require("commander");
const uuid_1 = require("uuid");
const connection_1 = require("../db/connection");
const commit_1 = require("../db/commit");
const utils_1 = require("./utils"); // Import Config
const escape_1 = require("../db/escape");
function planCommand(program) {
    program
        .command("plan")
        .description("Manage plans")
        .addCommand(planNewCommand());
}
function planNewCommand() {
    return new commander_1.Command("new")
        .description("Create a new plan")
        .argument("<title>", "Title of the plan")
        .option("--intent <intent>", "Intent of the plan", "")
        .option("--source <path>", "Source path (e.g., plans/feature-x.md)")
        .action(async (title, options, cmd) => {
        const result = await (0, utils_1.readConfig)().asyncAndThen((config) => {
            const plan_id = (0, uuid_1.v4)();
            const now = new Date().toISOString().slice(0, 19).replace("T", " "); // YYYY-MM-DD HH:MM:SS
            const insertPlanSql = `
          INSERT INTO plan (plan_id, title, intent, source_path, created_at, updated_at)
          VALUES (
            '${(0, escape_1.sqlEscape)(plan_id)}',
            '${(0, escape_1.sqlEscape)(title)}',
            '${(0, escape_1.sqlEscape)(options.intent)}',
            ${options.source ? `'${(0, escape_1.sqlEscape)(options.source)}'` : "NULL"},
            '${now}',
            '${now}'
          );
        `;
            return (0, connection_1.doltSql)(insertPlanSql, config.doltRepoPath)
                .andThen(() => (0, commit_1.doltCommit)(`plan: create ${title}`, config.doltRepoPath, cmd.parent?.opts().noCommit))
                .map(() => ({
                plan_id,
                title,
                intent: options.intent,
                source_path: options.source,
            }));
        });
        result.match((data) => {
            const resultData = data;
            if (!cmd.parent?.opts().json) {
                console.log(`Plan created with ID: ${resultData.plan_id}`);
            }
            else {
                console.log(JSON.stringify(resultData, null, 2));
            }
        }, (error) => {
            console.error(`Error creating plan: ${error.message}`);
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
