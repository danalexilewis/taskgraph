import { beforeEach, describe, expect, it, mock } from "bun:test";
import { okAsync } from "neverthrow";

// Prevent leftover integration env from causing real pool use when mock does not apply
delete process.env.TG_DOLT_SERVER_PORT;
delete process.env.TG_DOLT_SERVER_DATABASE;

/**
 * Mock doltSql before importing the modules under test so that Bun's module
 * registry resolves the mock for all subsequent imports in this file.
 */
const mockDoltSql = mock((_sql: string, _repoPath: string) => {
  return okAsync([{ id: 1, name: "task-row" }]);
});

mock.module("../../src/db/connection", () => ({
  doltSql: mockDoltSql,
}));

const { QueryCache } = await import("../../src/db/cache");
const { cachedQuery } = await import("../../src/db/cached-query");

const REPO = "./test_repo";

// describe.serial ensures tests run sequentially within this file to prevent
// inter-test contamination from module-level cache state.
describe("cachedQuery — cache deduplication and invalidation", () => {
  let cache: InstanceType<typeof QueryCache>;

  beforeEach(() => {
    cache = new QueryCache();
    mockDoltSql.mockClear();
    mockDoltSql.mockImplementation((_sql: string) => {
      return okAsync([{ id: 1, name: "task-row" }]);
    });
  });

  it("calls DB exactly once for duplicate SELECT (cache hit on second call)", async () => {
    const cq = cachedQuery(REPO, cache, 500);

    const r1 = await cq.select("task");
    const r2 = await cq.select("task");

    expect(mockDoltSql).toHaveBeenCalledTimes(1);
    expect(r1.unwrapOr([])).toEqual(r2.unwrapOr([]));
  });

  it("calls DB again after INSERT invalidates the table cache", async () => {
    const cq = cachedQuery(REPO, cache, 500);

    // First SELECT warms the cache
    await cq.select("task");
    // INSERT should bypass cache and invalidate the "task" table entry
    await cq.insert("task", { id: "abc", title: "new task" });
    // Second SELECT must miss the cache and go to DB
    await cq.select("task");

    expect(mockDoltSql).toHaveBeenCalledTimes(3);
  });

  it("calls DB on every SELECT when TTL = 0 (passthrough mode)", async () => {
    const cq = cachedQuery(REPO, cache, 0);

    await cq.select("task");
    await cq.select("task");

    expect(mockDoltSql).toHaveBeenCalledTimes(2);
  });

  it("invalidateTable evicts only the targeted table; other tables remain cached", async () => {
    const cq = cachedQuery(REPO, cache, 500);

    // Warm two different table caches
    await cq.select("task");
    await cq.select("project");
    expect(mockDoltSql).toHaveBeenCalledTimes(2);

    // Evict only "task"
    cache.invalidateTable("task");

    // "task" select misses cache → 1 extra DB call
    // "project" select still hits cache → 0 extra DB calls
    await cq.select("task");
    await cq.select("project");

    expect(mockDoltSql).toHaveBeenCalledTimes(3);
    const selectKey = (t: string) => `select:${t}:{}::::[]::[]`;
    expect(cache.get(selectKey("project"))).toBeDefined();
    expect(cache.get(selectKey("task"))).toBeDefined();
  });
});

describe("cachedQuery — TTL expiry passthrough", () => {
  let cache: InstanceType<typeof QueryCache>;

  beforeEach(() => {
    cache = new QueryCache();
    mockDoltSql.mockClear();
    mockDoltSql.mockImplementation((_sql: string) => {
      return okAsync([{ id: 2, name: "stale-row" }]);
    });
  });

  it("re-fetches from DB after TTL expires", async () => {
    const cq = cachedQuery(REPO, cache, 5); // 5ms TTL

    await cq.select("task");
    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 20));
    await cq.select("task");

    expect(mockDoltSql).toHaveBeenCalledTimes(2);
  });
});

describe("cachedQuery — count and raw caching", () => {
  let cache: InstanceType<typeof QueryCache>;

  beforeEach(() => {
    cache = new QueryCache();
    mockDoltSql.mockClear();
    mockDoltSql.mockImplementation((sql: string) => {
      if (sql.includes("COUNT(*)")) {
        return okAsync([{ count: 42 }]);
      }
      return okAsync([{ id: 1 }]);
    });
  });

  it("caches count() results and returns DB value from cache on second call", async () => {
    const cq = cachedQuery(REPO, cache, 500);

    const r1 = await cq.count("task");
    const r2 = await cq.count("task");

    expect(mockDoltSql).toHaveBeenCalledTimes(1);
    expect(r1.unwrapOr(0)).toBe(r2.unwrapOr(0));
  });

  it("caches raw SELECT queries and deduplicates DB calls", async () => {
    const cq = cachedQuery(REPO, cache, 500);
    const sql = "SELECT id FROM `task` WHERE `status` = 'todo'";

    await cq.raw(sql);
    await cq.raw(sql);

    expect(mockDoltSql).toHaveBeenCalledTimes(1);
  });

  it("raw non-SELECT invalidates the affected table", async () => {
    const cq = cachedQuery(REPO, cache, 500);

    // Warm cache for task
    await cq.select("task");
    // Raw DELETE should invalidate task entries
    await cq.raw("DELETE FROM `task` WHERE `id` = 'abc'");
    // select must miss and re-fetch
    await cq.select("task");

    expect(mockDoltSql).toHaveBeenCalledTimes(3);
  });
});
