"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatMermaidGraph = formatMermaidGraph;
exports.generateMermaidGraph = generateMermaidGraph;
const graph_data_1 = require("./graph-data");
function formatMermaidGraph(nodes, edges) {
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
        }
        else if (edge.type === "relates") {
            mermaid += `  ${fromNodeId} --- ${toNodeId}\n`;
        }
    });
    return mermaid;
}
function generateMermaidGraph(planId, featureKey, basePath) {
    return (0, graph_data_1.getGraphData)(planId, featureKey, basePath).map(({ nodes, edges }) => formatMermaidGraph(nodes, edges));
}
