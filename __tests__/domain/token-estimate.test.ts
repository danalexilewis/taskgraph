import { describe, expect, it } from "vitest";
import {
  type ContextOutput,
  compactContext,
  estimateJsonTokens,
  estimateTokens,
} from "../../src/domain/token-estimate";

describe("token-estimate", () => {
  describe("estimateTokens", () => {
    it("estimates ~chars/4 for known strings", () => {
      const str = "hello"; // 5 chars -> ~1 token
      expect(estimateTokens(str)).toBe(1);

      const longer = "abcdefgh"; // 8 chars -> 2 tokens
      expect(estimateTokens(longer)).toBe(2);

      const exact = "abcd"; // 4 chars -> 1 token
      expect(estimateTokens(exact)).toBe(1);
    });

    it("returns 0 for empty string", () => {
      expect(estimateTokens("")).toBe(0);
    });

    it("handles unicode and whitespace", () => {
      const withSpaces = "foo bar"; // 7 chars -> 1 (floor of 7/4)
      expect(estimateTokens(withSpaces)).toBeGreaterThanOrEqual(1);
    });
  });

  describe("estimateJsonTokens", () => {
    it("estimates nested objects via stringified length", () => {
      const nested = { a: 1, b: { c: 2, d: { e: 3 } } };
      const tokens = estimateJsonTokens(nested);
      expect(tokens).toBeGreaterThan(0);
      // Stringified: {"a":1,"b":{"c":2,"d":{"e":3}}}
      expect(tokens).toBe(Math.floor(JSON.stringify(nested).length / 4));
    });

    it("handles null", () => {
      expect(estimateJsonTokens(null)).toBe(0);
    });

    it("handles empty object", () => {
      const obj = {};
      expect(estimateJsonTokens(obj)).toBe(
        Math.floor(JSON.stringify(obj).length / 4),
      );
    });

    it("handles very large objects", () => {
      const large: Record<string, string> = {};
      for (let i = 0; i < 1000; i++) {
        large[`key${i}`] = "x".repeat(50);
      }
      const tokens = estimateJsonTokens(large);
      expect(tokens).toBeGreaterThan(1000);
      expect(tokens).toBe(Math.floor(JSON.stringify(large).length / 4));
    });
  });

  describe("compactContext", () => {
    const longEvidence = "e".repeat(300);
    const longFileTree = "f".repeat(1200);

    const baseCtx = (overrides?: Partial<ContextOutput>): ContextOutput => ({
      task_id: "tid",
      title: "Task",
      agent: null,
      plan_name: "Test Plan",
      plan_overview: "An overview",
      docs: [],
      skills: [],
      change_type: null,
      suggested_changes: null,
      file_tree: longFileTree,
      risks: null,
      doc_paths: [],
      skill_docs: [],
      immediate_blockers: [
        {
          task_id: "b1",
          title: "Blocker 1",
          status: "done",
          evidence: longEvidence,
        },
        { task_id: "b2", title: "Blocker 2", status: "todo", evidence: null },
      ],
      ...overrides,
    });

    it("returns context unchanged when under budget", () => {
      const ctx = baseCtx();
      const budget = estimateJsonTokens(ctx) + 1000;
      const out = compactContext(ctx, budget);
      expect(out).toEqual(ctx);
      expect(out.immediate_blockers).toHaveLength(2);
      expect(out.immediate_blockers[0].evidence).toBe(longEvidence);
    });

    it("stage 1: trims blocker evidence to 100 chars when over budget", () => {
      const ctx = baseCtx({ file_tree: null });
      const budget = estimateJsonTokens(ctx) - estimateTokens(longEvidence) + 1;
      const out = compactContext(ctx, budget);
      const trimmedEvidence = out.immediate_blockers[0].evidence;
      expect(trimmedEvidence?.length).toBeLessThanOrEqual(102); // 100 + "…"
      expect(trimmedEvidence).toMatch(/…$/);
    });

    it("stage 2: truncates file_tree to 500 chars when still over budget", () => {
      const ctx = baseCtx({ immediate_blockers: [] });
      // Budget smaller than ctx but large enough for stage2 output
      const stage2Size = estimateJsonTokens({
        ...ctx,
        file_tree: longFileTree.slice(0, 501),
      });
      const budget = stage2Size + 10;
      const out = compactContext(ctx, budget);
      expect(out.file_tree?.length).toBeLessThanOrEqual(502); // 500 + "…"
    });

    it("stage 3: drops file_tree entirely when still over budget", () => {
      const ctx = baseCtx({
        immediate_blockers: [],
        suggested_changes: "x".repeat(500),
      });
      const out = compactContext(ctx, 50);
      expect(out.file_tree).toBeNull();
      expect(estimateJsonTokens(out)).toBeLessThan(estimateJsonTokens(ctx));
    });
  });
});
