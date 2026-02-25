"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGraphData = getGraphData;
const connection_1 = require("../db/connection");
const utils_1 = require("../cli/utils");
function getGraphData(planId, featureKey) {
    return (0, utils_1.readConfig)().asyncAndThen((config) => {
        let taskFilter = "";
        if (planId) {
            taskFilter += `WHERE t.plan_id = '${planId}'`;
        }
        if (featureKey) {
            taskFilter += planId
                ? ` AND t.feature_key = '${featureKey}'`
                : `WHERE t.feature_key = '${featureKey}'`;
        }
        const tasksQuery = `SELECT task_id, title, status FROM task t ${taskFilter};`;
        const edgesQuery = `SELECT from_task_id, to_task_id, type FROM edge;`;
        return (0, connection_1.doltSql)(tasksQuery, config.doltRepoPath).andThen((tasksResult) => {
            const tasks = tasksResult;
            return (0, connection_1.doltSql)(edgesQuery, config.doltRepoPath).map((edgesResult) => {
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
