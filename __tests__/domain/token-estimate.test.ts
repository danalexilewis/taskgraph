import { describe, expect, it } from "vitest";
import {
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
});
