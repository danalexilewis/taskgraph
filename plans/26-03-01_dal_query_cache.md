---
name: DAL Query Cache
overview: Add an in-memory K/V query result cache between the query builder and Dolt to eliminate redundant DB calls in the dashboard polling loop and migration checks.
fileTree: |
  src/db/
  ├── cache.ts                (create)
  ├── cached-query.ts         (create)
  └── query.ts                (modify - re-export cachedQuery)
  src/cli/
  ├── status.ts               (modify - use cachedQuery in dashboard loop)
  └── index.ts                (modify - wire config TTL into preAction)
  src/db/migrate.ts           (modify - use cachedQuery for tableExists/columnExists dedup)
  src/domain/config.ts        (modify - add queryCacheTtlMs field)
  __tests__/db/
  ├── cache.test.ts           (create)
  └── cached-query.test.ts    (create)
  docs/
  ├── performance.md          (modify - add Query Result Cache section)
  ├── architecture.md         (modify - update data flow with cache layer)
  └── infra.md                (modify - add TG_QUERY_CACHE_TTL_MS env var)
risks:
  - description: Stale data in dashboard live mode if TTL is too long
    severity: medium
    mitigation: Default TTL for dashboard is 1500ms so data is never more than one poll cycle stale; writes bypass cache and invalidate the affected table
  - description: Conflict with Sub-Agent Execution Perf plan on migrate.ts and status.ts
    severity: medium
    mitigation: This plan is independently executable; coordinate task ordering if both plans run concurrently; the cache adds orthogonal value to the perf plan's query rewrites
  - description: Integration test isolation - module-level cache persisting across test cases
    severity: medium
    mitigation: cachedQuery() accepts an injected QueryCache instance; tests create a fresh instance per case or call cache.clear() in beforeEach
  - description: Wrong cache invalidation - a write bypasses the table-level eviction
    severity: low
    mitigation: All write paths (insert, update, raw non-SELECT) in the wrapper call cache.invalidateTable(table); covered by integration tests
tests:
  - "QueryCache.get() returns undefined on miss, value on hit within TTL, undefined after TTL expiry (cache-core)"
  - "QueryCache.invalidateTable() evicts only keys tagged with that table name (cache-core)"
  - "QueryCache.clear() removes all entries (cache-core)"
  - "cachedQuery().select() hits DB on first call, returns cached result on second call without DB round-trip (cache-tests)"
  - "cachedQuery().insert() bypasses cache and invalidates table entries (cache-tests)"
  - "Dashboard live poll loop issues fewer DB calls than poll iterations when TTL > poll interval (cache-status, cache-tests)"
  - "migrate.ts tableExists called 4x for same table triggers only 1 DB call within one ensureMigrations() run (cache-migrate, cache-tests)"
todos:
  - id: cache-core
    content: "Implement QueryCache class in src/db/cache.ts with get/set/invalidateTable/clear"
    agent: implementer
    changeType: create
    intent: |
      Create `src/db/cache.ts` exporting a `QueryCache` class backed by a `Map<string, CacheEntry>`.

      Interface:
      ```ts
      interface CacheEntry { value: unknown; expiresAt: number; tables: string[] }

      class QueryCache {
        get<T>(key: string): T | undefined
        set(key: string, value: unknown, ttlMs: number, tables: string[]): void
        invalidateTable(tableName: string): void
        clear(): void
        get size(): number
      }
      ```

      - `key` is the raw SQL string (no hashing needed — Map keys are strings, query sets are small).
      - `expiresAt = Date.now() + ttlMs`. `get()` returns undefined if `Date.now() >= expiresAt` and deletes the entry.
      - `tables` is an array of table names the query reads from (e.g. `["task", "project"]`). Used by `invalidateTable()` to evict all entries touching that table.
      - `clear()` empties the map.
      - TTL of 0 means "never cache" — `set()` is a no-op when ttlMs === 0.

      Write unit tests in `__tests__/db/cache.test.ts` covering: miss, hit, expiry, invalidateTable (partial eviction), clear, ttl=0 no-op.

      No external dependencies — use only built-in TS/Node primitives.
    docs:
      - architecture

  - id: cache-config
    content: "Add queryCacheTtlMs to config schema and TG_QUERY_CACHE_TTL_MS env var"
    agent: implementer
    changeType: modify
    intent: |
      Find where `readConfig()` lives (likely `src/domain/config.ts` or `src/db/connection.ts` area) and add:

      1. Add `queryCacheTtlMs?: number` to the config type (default: 0).
      2. Read `TG_QUERY_CACHE_TTL_MS` env var (parseInt, default 0) as an override.
      3. Env var takes precedence over config file value.
      4. Log a debug line when cache is active (TTL > 0): `[cache] query cache enabled ttl=${ttlMs}ms`.

      Follow the existing pattern for `TG_DOLT_SERVER_PORT` (env var read in readConfig or at connection site).

      No tests required for the config read itself — covered by existing config tests if any, or integration smoke in cache-tests.
    docs:
      - infra

  - id: cache-wrapper
    content: "Implement cachedQuery() in src/db/cached-query.ts wrapping the query() interface"
    agent: implementer
    blockedBy: [cache-core]
    changeType: create
    intent: |
      Create `src/db/cached-query.ts` exporting `cachedQuery(repoPath: string, cache: QueryCache, ttlMs: number)`.

      It must return the SAME interface as `query()` from `src/db/query.ts`: `{ insert, update, select, count, raw }`.

      Rules:
      - **Reads** (select, count, raw queries starting with SELECT/WITH/EXPLAIN): check cache first. On miss, call the underlying `query()` method, store result in cache with `ttlMs` and the relevant table names, return result.
      - **Writes** (insert, update, raw queries that are INSERT/UPDATE/DELETE/REPLACE/CALL): bypass cache entirely, call underlying `query()`, then call `cache.invalidateTable(tableName)` for the affected table.
      - Table name extraction: for `select()` and `insert()` the table is passed explicitly as a parameter — pass it to `cache.set/invalidateTable`. For `raw()`, extract the first table from the SQL with a simple regex (e.g., `FROM\s+(\w+)` for reads, `INTO\s+(\w+)` for writes). This does not need to be perfect — worst case, a cache key does not get invalidated and expires naturally via TTL.
      - When `ttlMs === 0`, `cachedQuery()` is a transparent passthrough — no cache checks, no extra overhead.
      - All return types must remain `ResultAsync<T, AppError>` (neverthrow). Never throw; errors from the underlying call are passed through unchanged. Do NOT cache errors.

      Re-export from `src/db/query.ts` so callers can import from one place:
      ```ts
      export { cachedQuery } from "./cached-query";
      ```

      Write unit tests in `__tests__/db/cached-query.test.ts`:
      - Mock the underlying `query()` to count calls.
      - Verify: second identical SELECT with ttlMs > 0 → 1 DB call total.
      - Verify: INSERT → cache.invalidateTable called, next SELECT is a miss.
      - Verify: ttlMs = 0 → DB called every time.
    docs:
      - architecture

  - id: cache-status
    content: "Integrate cachedQuery into status.ts dashboard live poll loop"
    agent: implementer
    blockedBy: [cache-wrapper, cache-config]
    changeType: modify
    intent: |
      In `src/cli/status.ts`, in the dashboard live mode polling loop (`--dashboard` flag):

      1. Create a single `QueryCache` instance before the loop starts.
      2. Use `cachedQuery(repoPath, cache, ttlMs)` instead of `query()` for all `fetchStatusData`, `fetchProjectsTableData`, `fetchTasksTableData`, `fetchInitiativesTableData`, `fetchStaleDoingTasks` calls.
      3. TTL value: use `config.queryCacheTtlMs` if set and > 0; otherwise default to 1500ms in dashboard mode (hard-coded floor — dashboard always benefits from a short cache even if the global TTL is 0).
      4. The cache is scoped to the process lifetime of the dashboard command. Each poll iteration queries the cache; data is at most 1500ms stale. The cache naturally evicts entries each iteration.
      5. For non-dashboard (one-shot `tg status`): do NOT use the cache (TTL = 0 or just use `query()` directly). The one-shot path doesn't benefit.
      6. No change to output shape, column layout, or any rendering logic.
    docs:
      - cli-tables

  - id: cache-migrate
    content: "Integrate cachedQuery into migrate.ts to deduplicate tableExists/columnExists calls"
    agent: implementer
    blockedBy: [cache-wrapper]
    changeType: modify
    intent: |
      In `src/db/migrate.ts`, the `ensureMigrations()` function calls `tableExists()` and `columnExists()` repeatedly for the same table names across 17 migration steps. Within a single `ensureMigrations()` run, these are pure reads with stable answers.

      Changes:
      1. Accept an optional `QueryCache` parameter in `ensureMigrations()` (or create one internally with a process-lifetime TTL, e.g., 60_000ms).
      2. Pass the cache into `tableExists()` and `columnExists()` calls so that, e.g., `tableExists("project")` called 4× only hits the DB once per process.
      3. Cache the tableExists/columnExists results with a long TTL (e.g., 60_000ms) since schema doesn't change mid-process.
      4. After a migration write (CREATE TABLE, ALTER TABLE) the cache entry for that table is automatically invalidated via `cache.invalidateTable(tableName)`.

      NOTE: If the Sub-Agent Execution Perf plan has already implemented a `_taskgraph_migrations` version table fast-path, the number of `tableExists` calls may already be reduced to 1 (the sentinel table check). In that case, this task becomes a lower-value but still harmless optimization — apply it anyway for consistency.

      Verify existing migration tests still pass.
    docs:
      - schema

  - id: cache-tests
    content: "Write integration tests verifying cache hit counts and write invalidation"
    agent: implementer
    blockedBy: [cache-status, cache-migrate]
    changeType: create
    intent: |
      Add integration tests in `__tests__/db/cached-query.test.ts` (or as new describe blocks in existing DB test files):

      1. **Duplicate SELECT deduplication**: Create a `QueryCache`, call `cachedQuery().select("task", ...)` twice with the same args. Spy on the underlying DB call (mock or count via a wrapper). Assert DB was called exactly once.
      2. **Write invalidation**: Call `cachedQuery().select()` → cache hit → call `cachedQuery().insert()` on the same table → call `cachedQuery().select()` again → assert DB was called twice total (once before, once after invalidation).
      3. **TTL expiry**: Call select, wait for TTL expiry (use fake timers / short TTL + real sleep), call select again → assert DB called twice.
      4. **TTL = 0 passthrough**: With ttlMs = 0, assert DB is called every time (no caching).
      5. **Dashboard poll simulation**: Run `fetchStatusData` logic (or a simplified version) twice using the same `QueryCache`. Assert DB call count is < 2× the number of queries in the first run.

      Use `describe.serial` and ensure `cache.clear()` is called in `beforeEach` to prevent inter-test contamination.

      Follow the testing patterns in `docs/testing.md` — use the shared Dolt test server from `global-setup.ts` for integration assertions.
    docs:
      - testing

  - id: cache-docs
    content: "Update performance.md, architecture.md, and infra.md with cache layer documentation"
    agent: documenter
    blockedBy: [cache-config]
    changeType: modify
    intent: |
      Three docs to update:

      1. **docs/performance.md** — Add a "Query Result Cache" section after the existing server-mode section:
         - What it is (in-memory K/V, TTL-based, table-level invalidation)
         - When it helps (dashboard polling, migration checks, future server-mode sessions)
         - How to enable (`TG_QUERY_CACHE_TTL_MS`, or `queryCacheTtlMs` in config.json)
         - Default: 0 (disabled) in CLI mode; 1500ms auto-applied in dashboard mode
         - Note on Dolt: Dolt has no built-in query result caching (MySQL 8 removed the query cache); application-layer caching is the only option

      2. **docs/architecture.md** — Update the data flow section/diagram to show the new layer:
         ```
         CLI command → [QueryCache (in-process)] → cachedQuery() → query() → doltSql() / mysql2 pool → Dolt
         ```
         Note cache is transparent (passthrough when TTL = 0).

      3. **docs/infra.md** — Add `TG_QUERY_CACHE_TTL_MS` to the environment variables table:
         - Description: "Query result cache TTL in milliseconds. 0 = disabled (default). Dashboard mode uses 1500ms floor regardless."
         - Type: number, optional
    docs:
      - performance
      - architecture
      - infra
isProject: false
---

## Analysis

### Why a cache, why now

`tg status --dashboard` polls `fetchStatusData` every 2 seconds, firing 14+ sequential queries per tick. In CLI mode each query is a process spawn (13–42ms each); even in server mode (mysql2 pool) they add up. A 1500ms TTL cache means the dashboard can run indefinitely without hammering Dolt, while data is never more than one polling interval stale.

`ensureMigrations()` in `src/cli/index.ts` runs before every command as a `preAction` hook, firing 25 queries even on a fully-migrated DB. Within a single process, `tableExists("project")` is called 4×, `tableExists("task_doc")` 3×, `tableExists("task_domain")` 2×. A short-lived cache eliminates these redundant reads.

**Dolt does not provide query result caching**: MySQL 8 removed `query_cache_type` entirely and Dolt targets MySQL 8 compatibility. There is no Dolt-side knob to enable result caching. Application-layer caching is the only path.

### Architecture decision: wrap `query()`, not `doltSql()`

The query builder (`src/db/query.ts`) is the established interface boundary — all CLI code calls `q.select()`, `q.raw()`, etc. rather than `doltSql()` directly. Wrapping at this level:

- Preserves the `ResultAsync<T, AppError>` return type throughout
- Avoids touching the lower-level execa/mysql2 fork
- Gives us table-name context for invalidation without regex-only heuristics

### Zero-overhead passthrough

When `ttlMs === 0`, `cachedQuery()` calls directly to `query()` with no Map lookups, no key construction, no overhead. CLI commands that don't benefit from caching (one-shot `tg done`, `tg start`, etc.) pay nothing.

### Scoped instances, not a global singleton

`cachedQuery()` accepts an injected `QueryCache` instance. This makes testing straightforward (fresh instance per test), avoids cross-command pollution in server mode, and lets the dashboard create its own long-lived cache while `tg status` (one-shot) uses the zero-TTL passthrough.

### Coordination with Sub-Agent Execution Performance plan

`plans/26-03-01_sub_agent_execution_perf.md` exists and covers overlapping files (`migrate.ts`, `status.ts`, `context.ts`, `done.ts`, `invariants.ts`). Key interactions:

- **`done-merge-fetch`** (perf plan): merges the duplicate `getStartedEventBranch`/`getStartedEventWorktree` selects. This eliminates one within-command duplicate that the cache would also have eliminated — no conflict, just redundant coverage.
- **`context-parallel`** (perf plan): parallelizes the 5 sequential queries in `tg context`. Orthogonal to caching — parallelism and caching are complementary.
- **`tg-serve`** (perf plan): persistent server process that keeps the mysql2 pool alive across commands. This dramatically increases the value of a process-lifetime cache. The cache plan works without `tg-serve` (still helps within dashboard mode), but is most powerful once `tg-serve` is available.

**Recommendation**: if both plans are active, run the perf plan's `fix-pool-checkout` and `migrate-version` tasks before or in parallel with this plan's `cache-migrate` task to avoid editing `migrate.ts` at the same time.

## Dependency graph

```
Parallel start (2 unblocked):
  ├── cache-core     (QueryCache class + unit tests)
  └── cache-config   (env var + config schema)

After cache-core:
  └── cache-wrapper  (cachedQuery() function + unit tests)

After cache-wrapper + cache-config (parallel):
  ├── cache-status   (status.ts dashboard integration)
  └── cache-migrate  (migrate.ts tableExists dedup)

After cache-status + cache-migrate:
  └── cache-tests    (integration tests)

After cache-config (independent, can run any time after):
  └── cache-docs     (performance.md, architecture.md, infra.md)
```

## Open questions

1. **Should `cachedQuery()` be the default export from `src/db/query.ts`**, replacing the non-cached `query()` for all callers? Or should callers opt in explicitly? Recommendation: keep `query()` as the default export; callers that want caching import `cachedQuery` explicitly. This avoids accidentally caching write-heavy commands.

2. **Branch-scoped cache keys in server/worktree mode**: if `tg start` switches the Dolt working branch and subsequent queries read from a different branch, cached keys from the previous branch will return wrong data. Mitigation: include the current branch name in the cache key prefix. The perf plan's `tg-serve` task will need to address this too — consider aligning.

3. **Should the migration tableExists cache persist across the fast-path sentinel check?** Once the perf plan lands `_taskgraph_migrations` version table, `ensureMigrations()` will be a single-query fast-path on migrated DBs. The per-table cache in `cache-migrate` becomes a minor win — still valid, but lower priority.

<original_prompt>
I think we need a caching strategy. the reports/26-02-28_status_active_next_table_columns.md which I cannot see in my file tree for some reason.

can you put together a plan for this — does Dolt have some out the box things for us. otherwise I was thinking we could do a k/v in memory store between the DAL and DB. I think this is what React Query does. Though I dont want to use it here as that is a react hooks thing. But the idea of having a standardised in memory kv store cache wrapper around db requests is ideal.
</original_prompt>
