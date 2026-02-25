import { ResultAsync } from "neverthrow";
import { AppError } from "../domain/errors";
import { getGraphData, GraphNode, GraphEdge } from "./graph-data";

export function formatMermaidGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
): string {
  let mermaid = "graph TD\n";

  nodes.forEach((node) => {
    // Node IDs in Mermaid typically cannot have special characters or spaces
    const nodeId = node.id.replace(/[^a-zA-Z0-9]/g, "");
    mermaid += `  ${nodeId}[\"${node.label}\"]\n`;
  });

  edges.forEach((edge) => {
    const fromNodeId = edge.from.replace(/[^a-zA-Z0-9]/g, "");
    const toNodeId = edge.to.replace(/[^a-zA-Z0-9]/g, "");
    if (edge.type === "blocks") {
      mermaid += `  ${fromNodeId} --> ${toNodeId}\n`;
    } else if (edge.type === "relates") {
      mermaid += `  ${fromNodeId} --- ${toNodeId}\n`;
    }
  });

  return mermaid;
}

export function generateMermaidGraph(
  planId?: string,
  featureKey?: string,
  basePath?: string, // Added basePath parameter
): ResultAsync<string, AppError> {
  return getGraphData(planId, featureKey, basePath).map(
    (
      { nodes, edges }, // Passed basePath to getGraphData
    ) => formatMermaidGraph(nodes, edges),
  );
}
