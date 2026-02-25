"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importCommand = importCommand;
const utils_1 = require("./utils");
const parser_1 = require("../plan-import/parser");
const importer_1 = require("../plan-import/importer");
const commit_1 = require("../db/commit");
const uuid_1 = require("uuid");
const neverthrow_1 = require("neverthrow");
const errors_1 = require("../domain/errors");
const query_1 = require("../db/query");
function importCommand(program) {
    program
        .command("import")
        .description("Import tasks and edges from a markdown plan file")
        .argument("<filePath>", "Path to the markdown plan file (e.g., plans/feature-auth.md)")
        .requiredOption("--plan <planTitleOrId>", "Title or ID of the plan to associate tasks with")
        .action(async (filePath, options, cmd) => {
        const result = await (0, utils_1.readConfig)().asyncAndThen((config) => {
            const currentTimestamp = (0, query_1.now)();
            return (0, parser_1.parsePlanMarkdown)(filePath).asyncAndThen((parsedPlan) => {
                return neverthrow_1.ResultAsync.fromPromise((async () => {
                    const q = (0, query_1.query)(config.doltRepoPath);
                    const { planTitle, planIntent, tasks: parsedTasks } = parsedPlan;
                    let planId = null;
                    // Try to find plan by ID first
                    if (options.plan.length === 36 &&
                        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(options.plan)) {
                        const planResult = await q.select("plan", { columns: ["plan_id"], where: { plan_id: options.plan } });
                        if (planResult.isOk() && planResult.value.length > 0) {
                            planId = planResult.value[0].plan_id;
                        }
                    }
                    // If not found by ID, try to find by title
                    if (!planId) {
                        const planResult = await q.select("plan", { columns: ["plan_id"], where: { title: options.plan } });
                        if (planResult.isOk() && planResult.value.length > 0) {
                            planId = planResult.value[0].plan_id;
                        }
                    }
                    // If plan still not found, create a new one
                    if (!planId) {
                        planId = (0, uuid_1.v4)();
                        const newPlanTitle = planTitle || options.plan;
                        const newPlanIntent = planIntent || `Imported from ${filePath}`;
                        const insertResult = await q.insert("plan", {
                            plan_id: planId,
                            title: newPlanTitle,
                            intent: newPlanIntent,
                            source_path: filePath,
                            created_at: currentTimestamp,
                            updated_at: currentTimestamp,
                        });
                        if (insertResult.isErr())
                            throw insertResult.error;
                        console.log(`Created new plan '${newPlanTitle}' with ID: ${planId}`);
                        const commitResult = await (0, commit_1.doltCommit)(`plan: create ${newPlanTitle} from import`, config.doltRepoPath, cmd.parent?.opts().noCommit);
                        if (commitResult.isErr())
                            throw commitResult.error;
                    }
                    if (!planId) {
                        throw (0, errors_1.buildError)(errors_1.ErrorCode.PLAN_NOT_FOUND, "Could not find or create a plan for the import.");
                    }
                    const upsertResult = await (0, importer_1.upsertTasksAndEdges)(planId, parsedTasks, config.doltRepoPath, cmd.parent?.opts().noCommit);
                    if (upsertResult.isErr())
                        throw upsertResult.error;
                    return {
                        filePath,
                        plan_id: planId,
                        importedTasksCount: upsertResult.value.importedTasksCount,
                    };
                })(), (e) => e);
            });
        });
        result.match((data) => {
            const resultData = data;
            if (!cmd.parent?.opts().json) {
                console.log(`Successfully imported tasks and edges from ${resultData.filePath} to plan ${resultData.plan_id}.`);
            }
            else {
                console.log(JSON.stringify(resultData, null, 2));
            }
        }, (error) => {
            console.error(`Error importing plan from ${filePath}: ${error.message}`);
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
