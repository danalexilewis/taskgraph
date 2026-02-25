import { ResultAsync } from "neverthrow";
import { AppError } from "../domain/errors";
import { getGraphData, GraphNode, GraphEdge } from "./graph-data";

export function formatDotGraph(nodes: GraphNode[], edges: GraphEdge[]): string {
  let dot = "digraph TaskGraph {\n";
  dot += "  rankdir=LR;\n";
  dot += "  node [shape=box];\n";

  nodes.forEach((node) => {
    dot += `  \"${node.id}\" [label=\"${node.label}\"];\n`;
  });

  edges.forEach((edge) => {
    dot += `  \"${edge.from}\" -> \"${edge.to}\" [label=\"${edge.type}\"];\n`;
  });

  dot += "}\n";
  return dot;
}

export function generateDotGraph(
  planId?: string,
  featureKey?: string,
  basePath?: string, // Added basePath parameter
): ResultAsync<string, AppError> {
  return getGraphData(planId, featureKey, basePath).map(
    (
      { nodes, edges }, // Passed basePath to getGraphData
    ) => formatDotGraph(nodes, edges),
  );
}
