"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.edgeCommand = edgeCommand;
const commander_1 = require("commander");
const commit_1 = require("../db/commit");
const utils_1 = require("./utils");
const types_1 = require("../domain/types");
const neverthrow_1 = require("neverthrow");
const invariants_1 = require("../domain/invariants");
const query_1 = require("../db/query");
function edgeCommand(program) {
    program
        .command("edge")
        .description("Manage task dependencies")
        .addCommand(edgeAddCommand());
}
function edgeAddCommand() {
    return new commander_1.Command("add")
        .description("Add a dependency edge between tasks")
        .argument("<fromTaskId>", "ID of the blocking task")
        .argument("<type>", "Type of edge (blocks or relates)", (value) => {
        const parsed = types_1.EdgeTypeSchema.safeParse(value);
        if (!parsed.success) {
            throw new Error(`Invalid edge type: ${value}. Must be one of: ${types_1.EdgeTypeSchema.options.join(", ")}`);
        }
        return value;
    })
        .argument("<toTaskId>", "ID of the blocked task")
        .option("--reason <reason>", "Reason for the dependency")
        .action(async (fromTaskId, type, toTaskId, options, cmd) => {
        const result = await (0, utils_1.readConfig)().asyncAndThen((config) => {
            const q = (0, query_1.query)(config.doltRepoPath);
            if (type === "blocks") {
                return neverthrow_1.ResultAsync.fromPromise((async () => {
                    const existingEdgesResult = await q.select("edge", { where: { type: "blocks" } });
                    if (existingEdgesResult.isErr()) {
                        throw existingEdgesResult.error;
                    }
                    const existingEdges = existingEdgesResult.value;
                    const cycleCheckResult = (0, invariants_1.checkNoBlockerCycle)(fromTaskId, toTaskId, existingEdges);
                    if (cycleCheckResult.isErr())
                        throw cycleCheckResult.error;
                    return (0, neverthrow_1.ok)(undefined); // Return an Ok Result to continue the chain
                })(), (e) => e).andThen(() => {
                    // Continue the original chain here after cycle check
                    return q.insert("edge", {
                        from_task_id: fromTaskId,
                        to_task_id: toTaskId,
                        type,
                        reason: options.reason ?? null,
                    }).map(() => ({
                        from_task_id: fromTaskId,
                        to_task_id: toTaskId,
                        type,
                        reason: options.reason,
                    }));
                });
            }
            return q.insert("edge", {
                from_task_id: fromTaskId,
                to_task_id: toTaskId,
                type,
                reason: options.reason ?? null,
            })
                .andThen(() => (0, commit_1.doltCommit)(`edge: add ${fromTaskId} ${type} ${toTaskId}`, config.doltRepoPath, cmd.parent?.opts().noCommit))
                .map(() => ({
                from_task_id: fromTaskId,
                to_task_id: toTaskId,
                type,
                reason: options.reason,
            }));
        });
        result.match((data) => {
            const resultData = data;
            if (!cmd.parent?.opts().json) {
                console.log(`Edge added: ${resultData.from_task_id} ${resultData.type} ${resultData.to_task_id}`);
            }
            else {
                console.log(JSON.stringify(resultData, null, 2));
            }
        }, (error) => {
            console.error(`Error adding edge: ${error.message}`);
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
