"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planCommand = planCommand;
const commander_1 = require("commander");
const uuid_1 = require("uuid");
const commit_1 = require("../db/commit");
const utils_1 = require("./utils"); // Import Config
const query_1 = require("../db/query");
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
            // Removed async, added type
            const plan_id = (0, uuid_1.v4)();
            const currentTimestamp = (0, query_1.now)();
            const q = (0, query_1.query)(config.doltRepoPath);
            return q
                .insert("plan", {
                plan_id,
                title,
                intent: options.intent,
                source_path: options.source ?? null,
                created_at: currentTimestamp,
                updated_at: currentTimestamp,
            })
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
