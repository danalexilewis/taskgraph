import { describe, expect, it } from "vitest";
import {
  generateHashId,
  generateUniqueHashId,
  isHashId,
} from "../../src/domain/hash-id";

describe("hash-id", () => {
  describe("generateHashId", () => {
    it("derives deterministic hash from valid UUID", () => {
      const uuid = "1c993f01-400a-40c1-9320-afae802a9a55";
      const result = generateHashId(uuid);
      expect(result).toMatch(/^tg-[0-9a-f]{6}$/);
      expect(result).toHaveLength(9);
      // Same input yields same output
      const again = generateHashId(uuid);
      expect(again).toBe(result);
    });

    it("produces unique hashes for different UUIDs", () => {
      const uuids = [
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        "c3d4e5f6-a7b8-9012-cdef-123456789012",
        "d4e5f6a7-b8c9-0123-def0-234567890123",
        "e5f6a7b8-c9d0-1234-ef01-345678901234",
      ];
      const hashes = uuids.map((u) => generateHashId(u));
      expect(new Set(hashes).size).toBe(hashes.length);
    });

    it("throws on invalid UUID", () => {
      expect(() => generateHashId("not-a-uuid")).toThrow("Invalid UUID format");
    });
  });

  describe("generateUniqueHashId", () => {
    it("returns base hash when no collision", () => {
      const uuid = "1c993f01-400a-40c1-9320-afae802a9a55";
      const result = generateUniqueHashId(uuid, new Set());
      expect(result).toMatch(/^tg-[0-9a-f]{6}$/);
      expect(result).toBe(generateHashId(uuid));
    });

    it("appends extra char on collision", () => {
      const uuid = "1c993f01-400a-40c1-9320-afae802a9a55";
      const base = generateHashId(uuid);
      const result = generateUniqueHashId(uuid, new Set([base]));
      expect(result).toMatch(/^tg-[0-9a-f]{7}$/);
      expect(result).not.toBe(base);
    });

    it("throws on invalid UUID", () => {
      expect(() => generateUniqueHashId("not-a-uuid", new Set())).toThrow(
        "Invalid UUID format",
      );
    });
  });

  describe("isHashId", () => {
    it("returns true for tg-XXXXXX format", () => {
      expect(isHashId("tg-abc123")).toBe(true);
      expect(isHashId("tg-000000")).toBe(true);
      expect(isHashId("tg-ABCDEF")).toBe(true);
    });

    it("returns false for non-matching strings", () => {
      expect(isHashId("1c993f01-400a-40c1-9320-afae802a9a55")).toBe(false);
      expect(isHashId("tg-abc12")).toBe(false); // 5 chars
      expect(isHashId("tg-abc12345")).toBe(false); // 8 chars (too long)
      expect(isHashId("tg-abc12g")).toBe(false); // g is invalid hex
    });

    it("returns true for 7-char hash_ids (collision fallback)", () => {
      expect(isHashId("tg-abc1234")).toBe(true);
    });
  });
});
