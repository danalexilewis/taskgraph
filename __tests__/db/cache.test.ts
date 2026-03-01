import { beforeEach, describe, expect, it } from "bun:test";
import { QueryCache } from "../../src/db/cache";

describe("QueryCache", () => {
  let cache: QueryCache;

  beforeEach(() => {
    cache = new QueryCache();
  });

  describe("get / set", () => {
    it("returns undefined on cache miss", () => {
      expect(cache.get("nonexistent")).toBeUndefined();
    });

    it("returns cached value on hit within TTL", () => {
      cache.set("key1", [{ id: 1 }], 5000, ["task"]);
      expect(cache.get("key1")).toEqual([{ id: 1 }]);
    });

    it("returns undefined after TTL expiry", async () => {
      cache.set("key1", [{ id: 1 }], 1, ["task"]);
      await new Promise((r) => setTimeout(r, 10));
      expect(cache.get("key1")).toBeUndefined();
    });

    it("deletes expired entry from map on get", async () => {
      cache.set("key1", "value", 1, ["task"]);
      await new Promise((r) => setTimeout(r, 10));
      cache.get("key1");
      expect(cache.size).toBe(0);
    });

    it("is a no-op when ttlMs === 0", () => {
      cache.set("key1", "value", 0, ["task"]);
      expect(cache.get("key1")).toBeUndefined();
      expect(cache.size).toBe(0);
    });
  });

  describe("invalidateTable", () => {
    it("evicts only keys tagged with the given table", () => {
      cache.set("key1", "v1", 5000, ["task"]);
      cache.set("key2", "v2", 5000, ["project"]);
      cache.set("key3", "v3", 5000, ["task", "project"]);
      cache.invalidateTable("task");
      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBe("v2");
      expect(cache.get("key3")).toBeUndefined();
    });

    it("is a no-op when no keys match the table", () => {
      cache.set("key1", "v1", 5000, ["task"]);
      cache.invalidateTable("nonexistent");
      expect(cache.size).toBe(1);
    });
  });

  describe("clear", () => {
    it("removes all entries", () => {
      cache.set("k1", "v1", 5000, ["task"]);
      cache.set("k2", "v2", 5000, ["project"]);
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });

  describe("size", () => {
    it("reflects current number of live entries", () => {
      expect(cache.size).toBe(0);
      cache.set("k1", "v1", 5000, ["task"]);
      expect(cache.size).toBe(1);
      cache.set("k2", "v2", 5000, ["project"]);
      expect(cache.size).toBe(2);
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });
});
