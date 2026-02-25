import { describe, it, expect } from "vitest";
import { formatMermaidGraph } from "../../src/export/mermaid";
import { formatDotGraph } from "../../src/export/dot";
import { GraphNode, GraphEdge } from "../../src/export/graph-data";

describe("Graph Formatting (Pure Functions)", () => {
  const mockNodes: GraphNode[] = [
    { id: "task1", label: "Task 1 (todo)", status: "todo" },
    { id: "task2", label: "Task 2 (doing)", status: "doing" },
    { id: "task3", label: "Task 3 (done)", status: "done" },
  ];

  const mockEdges: GraphEdge[] = [
    { from: "task1", to: "task2", type: "blocks" },
    { from: "task2", to: "task3", type: "relates" },
  ];

  describe("formatMermaidGraph", () => {
    it("should generate a valid Mermaid graph TD string", () => {
      const mermaidGraph = formatMermaidGraph(mockNodes, mockEdges);
      expect(mermaidGraph).toContain("graph TD");
      expect(mermaidGraph).toContain('task1[\"Task 1 (todo)\"]');
      expect(mermaidGraph).toContain('task2[\"Task 2 (doing)\"]');
      expect(mermaidGraph).toContain('task3[\"Task 3 (done)\"]');
      expect(mermaidGraph).toContain("task1 --> task2"); // blocks
      expect(mermaidGraph).toContain("task2 --- task3"); // relates
    });

    it("should handle empty nodes and edges", () => {
      const mermaidGraph = formatMermaidGraph([], []);
      expect(mermaidGraph).toBe("graph TD\n");
    });
  });

  describe("formatDotGraph", () => {
    it("should generate a valid Graphviz DOT string", () => {
      const dotGraph = formatDotGraph(mockNodes, mockEdges);
      expect(dotGraph).toContain("digraph TaskGraph {");
      expect(dotGraph).toContain("rankdir=LR;");
      expect(dotGraph).toContain("node [shape=box];");
      expect(dotGraph).toContain('\"task1\" [label=\"Task 1 (todo)\"];');
      expect(dotGraph).toContain('\"task2\" [label=\"Task 2 (doing)\"];');
      expect(dotGraph).toContain('\"task3\" [label=\"Task 3 (done)\"];\n');
      expect(dotGraph).toContain('\"task1\" -> \"task2\" [label=\"blocks\"];');
      expect(dotGraph).toContain('\"task2\" -> \"task3\" [label=\"relates\"];');
    });

    it("should handle empty nodes and edges", () => {
      const dotGraph = formatDotGraph([], []);
      expect(dotGraph).toBe(
        "digraph TaskGraph {\n  rankdir=LR;\n  node [shape=box];\n}\n",
      );
    });
  });
});
