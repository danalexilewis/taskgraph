"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGraphData = getGraphData;
const utils_1 = require("../cli/utils");
const query_1 = require("../db/query");
function getGraphData(planId, featureKey, basePath) {
    return (0, utils_1.readConfig)(basePath).asyncAndThen((config) => {
        // Passed basePath to readConfig
        const q = (0, query_1.query)(config.doltRepoPath);
        const whereClause = {};
        if (planId) {
            whereClause.plan_id = planId;
        }
        if (featureKey) {
            whereClause.feature_key = featureKey;
        }
        return q
            .select("task", {
            columns: ["task_id", "title", "status"],
            where: whereClause,
        })
            .andThen((tasksResult) => {
            const tasks = tasksResult;
            const edgesQuery = `SELECT from_task_id, to_task_id, type FROM \`edge\`;`;
            return q.raw(edgesQuery).map((edgesResult) => {
                const edges = edgesResult;
                const nodes = tasks.map((task) => ({
                    id: task.task_id,
                    label: `${task.title} (${task.status})`,
                    status: task.status,
                }));
                const graphEdges = edges.map((edge) => ({
                    from: edge.from_task_id,
                    to: edge.to_task_id,
                    type: edge.type,
                }));
                return { nodes, edges: graphEdges };
            });
        });
    });
}
