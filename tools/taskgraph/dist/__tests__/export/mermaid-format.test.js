"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mermaid_1 = require("../../src/export/mermaid");
const dot_1 = require("../../src/export/dot");
(0, vitest_1.describe)("Graph Formatting (Pure Functions)", () => {
    const mockNodes = [
        { id: "task1", label: "Task 1 (todo)", status: "todo" },
        { id: "task2", label: "Task 2 (doing)", status: "doing" },
        { id: "task3", label: "Task 3 (done)", status: "done" },
    ];
    const mockEdges = [
        { from: "task1", to: "task2", type: "blocks" },
        { from: "task2", to: "task3", type: "relates" },
    ];
    (0, vitest_1.describe)("formatMermaidGraph", () => {
        (0, vitest_1.it)("should generate a valid Mermaid graph TD string", () => {
            const mermaidGraph = (0, mermaid_1.formatMermaidGraph)(mockNodes, mockEdges);
            (0, vitest_1.expect)(mermaidGraph).toContain("graph TD");
            (0, vitest_1.expect)(mermaidGraph).toContain('task1[\"Task 1 (todo)\"]');
            (0, vitest_1.expect)(mermaidGraph).toContain('task2[\"Task 2 (doing)\"]');
            (0, vitest_1.expect)(mermaidGraph).toContain('task3[\"Task 3 (done)\"]');
            (0, vitest_1.expect)(mermaidGraph).toContain("task1 --> task2"); // blocks
            (0, vitest_1.expect)(mermaidGraph).toContain("task2 --- task3"); // relates
        });
        (0, vitest_1.it)("should handle empty nodes and edges", () => {
            const mermaidGraph = (0, mermaid_1.formatMermaidGraph)([], []);
            (0, vitest_1.expect)(mermaidGraph).toBe("graph TD\n");
        });
    });
    (0, vitest_1.describe)("formatDotGraph", () => {
        (0, vitest_1.it)("should generate a valid Graphviz DOT string", () => {
            const dotGraph = (0, dot_1.formatDotGraph)(mockNodes, mockEdges);
            (0, vitest_1.expect)(dotGraph).toContain("digraph TaskGraph {");
            (0, vitest_1.expect)(dotGraph).toContain("rankdir=LR;");
            (0, vitest_1.expect)(dotGraph).toContain("node [shape=box];");
            (0, vitest_1.expect)(dotGraph).toContain('\"task1\" [label=\"Task 1 (todo)\"];');
            (0, vitest_1.expect)(dotGraph).toContain('\"task2\" [label=\"Task 2 (doing)\"];');
            (0, vitest_1.expect)(dotGraph).toContain('\"task3\" [label=\"Task 3 (done)\"];\n');
            (0, vitest_1.expect)(dotGraph).toContain('\"task1\" -> \"task2\" [label=\"blocks\"];');
            (0, vitest_1.expect)(dotGraph).toContain('\"task2\" -> \"task3\" [label=\"relates\"];');
        });
        (0, vitest_1.it)("should handle empty nodes and edges", () => {
            const dotGraph = (0, dot_1.formatDotGraph)([], []);
            (0, vitest_1.expect)(dotGraph).toBe("digraph TaskGraph {\n  rankdir=LR;\n  node [shape=box];\n}\n");
        });
    });
});
