"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDotGraph = formatDotGraph;
exports.generateDotGraph = generateDotGraph;
const graph_data_1 = require("./graph-data");
function formatDotGraph(nodes, edges) {
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
function generateDotGraph(planId, featureKey, basePath) {
    return (0, graph_data_1.getGraphData)(planId, featureKey, basePath).map(({ nodes, edges }) => formatDotGraph(nodes, edges));
}
