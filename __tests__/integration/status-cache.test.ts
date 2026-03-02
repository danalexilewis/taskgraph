import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { QueryCache } from "../../src/db/cache";
import {
  resetSchemaFlagsCache,
  resetStatusCache,
  statusCacheTtlMs,
} from "../../src/cli/status-cache";
import { fetchStatusData } from "../../src/cli/status";
import type { IntegrationTestContext } from "./test-utils";
import {
  setupIntegrationTest,
  teardownIntegrationTest,
} from "./test-utils";

// ─── Group 1: Cache hit ───────────────────────────────────────────────────────

describe.serial(
  "fetchStatusData cache hit — cache is populated after first fetch",
  () => {
    let context: IntegrationTestContext | undefined;

    beforeAll(async () => {
      context = await setupIntegrationTest();
    }, 60_000);

    afterAll(async () => {
      if (context) await teardownIntegrationTest(context);
    }, 60_000);

    beforeEach(() => {
      resetStatusCache();
      resetSchemaFlagsCache();
    });

    it("cache.size > 0 after first fetchStatusData call", async () => {
      if (!context) throw new Error("Context not initialized");
      const config = { doltRepoPath: context.doltRepoPath };
      const cache = new QueryCache();

      await fetchStatusData(config, {}, cache)
        .match(
          () => {},
          (e) => {
            throw new Error(String(e));
          },
        );

      expect(cache.size).toBeGreaterThan(0);
    });

    it("second fetchStatusData call does not grow the cache (served from memory)", async () => {
      if (!context) throw new Error("Context not initialized");
      const config = { doltRepoPath: context.doltRepoPath };
      const cache = new QueryCache();

      const result1 = await fetchStatusData(config, {}, cache).match(
        (d) => d,
        (e) => {
          throw new Error(String(e));
        },
      );
      const sizeAfterFirst = cache.size;
      expect(sizeAfterFirst).toBeGreaterThan(0);

      const result2 = await fetchStatusData(config, {}, cache).match(
        (d) => d,
        (e) => {
          throw new Error(String(e));
        },
      );

      // Cache size unchanged — all reads served from the in-memory store.
      expect(cache.size).toBe(sizeAfterFirst);
      // Both calls return structurally identical data.
      expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
    });
  },
);

// ─── Group 2: Invalidation ────────────────────────────────────────────────────

describe.serial(
  "fetchStatusData cache invalidation — clear() drains the cache and next fetch repopulates it",
  () => {
    let context: IntegrationTestContext | undefined;

    beforeAll(async () => {
      context = await setupIntegrationTest();
    }, 60_000);

    afterAll(async () => {
      if (context) await teardownIntegrationTest(context);
    }, 60_000);

    beforeEach(() => {
      resetStatusCache();
      resetSchemaFlagsCache();
    });

    it("cache.size is 0 after clear() and grows again after next fetch", async () => {
      if (!context) throw new Error("Context not initialized");
      const config = { doltRepoPath: context.doltRepoPath };
      const cache = new QueryCache();

      // First fetch: populates the cache.
      await fetchStatusData(config, {}, cache)
        .match(
          () => {},
          (e) => {
            throw new Error(String(e));
          },
        );
      expect(cache.size).toBeGreaterThan(0);

      // Simulate what write commands do (tg start, tg done, etc.).
      cache.clear();
      expect(cache.size).toBe(0);

      // Next fetch repopulates from DB.
      await fetchStatusData(config, {}, cache)
        .match(
          () => {},
          (e) => {
            throw new Error(String(e));
          },
        );
      expect(cache.size).toBeGreaterThan(0);
    });
  },
);

// ─── Group 3: TG_DISABLE_CACHE flag ──────────────────────────────────────────
// Unit-style: no DB required.
//
// statusCacheTtlMs is a module-level constant evaluated at import time.
// When TG_DISABLE_CACHE=1, it resolves to 0, which makes cachedQuery()
// return a plain passthrough query object (no caching).
// QueryCache.set() is also a documented no-op when ttlMs=0.

describe("TG_DISABLE_CACHE: QueryCache is inert when ttlMs is 0", () => {
  beforeEach(() => {
    resetStatusCache();
    resetSchemaFlagsCache();
  });

  it("QueryCache.set() is a no-op when ttlMs=0", () => {
    const cache = new QueryCache();
    cache.set("key-task", [{ id: 1 }], 0, ["task"]);
    cache.set("key-plan", [{ id: 2 }], 0, ["plan"]);
    expect(cache.size).toBe(0);
  });

  it("QueryCache.get() returns undefined for any key when ttlMs=0 was used for all writes", () => {
    const cache = new QueryCache();
    cache.set("select:task:{}", [{ status: "todo" }], 0, ["task"]);
    expect(cache.get("select:task:{}")).toBeUndefined();
  });

  it("statusCacheTtlMs is 0 when TG_DISABLE_CACHE is '1' at module load", () => {
    // statusCacheTtlMs is evaluated once when the module is imported.
    // This assertion is only meaningful if the test process was started with
    // TG_DISABLE_CACHE=1 in the environment; otherwise it verifies the default (>0).
    if (process.env.TG_DISABLE_CACHE === "1") {
      expect(statusCacheTtlMs).toBe(0);
    } else {
      // Default: 2500 ms (or whatever TG_STATUS_CACHE_TTL_MS is set to).
      expect(statusCacheTtlMs).toBeGreaterThan(0);
    }
  });
});
