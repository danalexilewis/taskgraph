import type { ResultAsync } from "neverthrow";
import { type Config, readConfig } from "../cli/utils";
import { query } from "../db/query";
import type { AppError } from "../domain/errors";
import type { Edge, Task } from "../domain/types";

export interface GraphNode {
  id: string;
  label: string;
  status: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: string;
}

export function getGraphData(
  planId?: string,
  featureKey?: string,
  basePath?: string, // Added basePath parameter
): ResultAsync<{ nodes: GraphNode[]; edges: GraphEdge[] }, AppError> {
  return readConfig(basePath).asyncAndThen((config: Config) => {
    // Passed basePath to readConfig
    const q = query(config.doltRepoPath);
    const whereClause: { plan_id?: string; feature_key?: string } = {};
    if (planId) {
      whereClause.plan_id = planId;
    }
    if (featureKey) {
      whereClause.feature_key = featureKey;
    }

    return q
      .select<Task>("task", {
        columns: ["task_id", "title", "status"],
        where: whereClause,
      })
      .andThen((tasksResult) => {
        const tasks = tasksResult as Task[];
        const edgesQuery = `SELECT from_task_id, to_task_id, type FROM \`edge\`;`;
        return q.raw<Edge>(edgesQuery).map((edgesResult) => {
          const edges = edgesResult;

          const nodes: GraphNode[] = tasks.map((task) => ({
            id: task.task_id,
            label: `${task.title} (${task.status})`,
            status: task.status,
          }));

          const graphEdges: GraphEdge[] = edges.map((edge) => ({
            from: edge.from_task_id,
            to: edge.to_task_id,
            type: edge.type,
          }));
          return { nodes, edges: graphEdges };
        });
      });
  });
}
