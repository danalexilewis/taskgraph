# Investigation: Gate Full Failure Clusters (2026-03-01)

**Scope:** Root-cause investigation of gate:full failures after the Gate Full Remediation plan: (1) integration tests failing with `ER_BAD_DB_ERROR: database not found: dolt/` despite harness setting `TG_DOLT_SERVER_DATABASE = "dolt"`; (2) unit tests (invariants, query builder, cachedQuery, doc-skill-registry) failing in the full suite but passing in isolation.

---

## Investigation summary

- **Context used:** End-of-chat summary from /work on Plan "Gate Full Remediation" (three implementation tasks done; gate-full task done with failure evidence). Lint/typecheck passed; 47 tests failed in four clusters. docs/testing.md, docs/agent-field-guide.md, and docs/architecture.md scanned for Dolt server mode and pool behavior.
- **Areas investigated:** (A) Integration DB name and pool lifecycle in `src/db/connection.ts`, test-utils.ts, global-setup.ts; (B) Unit test failures and Bun mock/load order in query.test.ts, cached-query.test.ts, invariants.test.ts, doc-skill-registry.test.ts, plus cheap-gate.sh and env.
- **Key findings:**
  - **Pool cache key** in `connection.ts` is `(host, port)` only; **database is not part of the key**. So the first pool created in a process (e.g. with `database: ""` if `TG_DOLT_SERVER_DATABASE` was not set yet) is reused for that host:port for the process lifetime. Setting `TG_DOLT_SERVER_DATABASE = "dolt"` later does not change the existing pool.
  - **"dolt/"** is never set by application code (only `"dolt"` or `""`). The error string likely comes from the Dolt/MySQL server when the client has no default database (empty string), and the server formats its default or current DB as `"dolt/"` in the error message.
  - **First use before harness:** If anything calls `getServerPool()` (or `doltSql` with port set) before `setupIntegrationTest()` sets `TG_DOLT_SERVER_DATABASE`, the pool is created with `database: ""` and cached; later env set in the same process does not affect that pool.
  - **Unit tests (B):** Bun’s `mock.module()` only affects **subsequent** imports. In `bun test __tests__`, integration tests (and other files) can load `connection` first; then when `query.test.ts` or `cached-query.test.ts` runs, `connection` is already cached and the mock never applies. Real `doltSql` runs, so assertions on `mockDoltSql` fail. Leftover `TG_DOLT_SERVER_PORT` from integration tests in the same worker can also cause unit tests to hit the real pool.
  - **doc-skill-registry.test.ts** uses Vitest while gate runs with Bun; cwd and filesystem layout can differ, affecting registry output and slug expectations.

---

## Tasks (from reviewer suggested follow-up)

1. **Include database in pool key** — In `src/db/connection.ts`, add database to `getPoolKey(host, port, database)` so pools with different `TG_DOLT_SERVER_DATABASE` values do not share the same cached pool.
2. **Refuse empty database when port is set** — In `getServerPool()`, if `TG_DOLT_SERVER_PORT` is set and `TG_DOLT_SERVER_DATABASE` is missing or empty, return `null` (or fail fast) so no pool is created with `database: ""`; CLI falls back to execa path.
3. **Confirm Dolt error format** — Reproduce the integration failure and capture the full MySQL/Dolt error/stack to confirm that "dolt/" is produced by the server when the client uses no default database.
4. **Isolate unit tests that mock connection** — Run `query.test.ts` and `cached-query.test.ts` in a separate process or ensure they run before any test that loads `connection`, so `mock.module(".../connection")` takes effect.
5. **Reset Dolt env in unit tests** — In `query.test.ts` and `cached-query.test.ts`, in `beforeEach` or at top, `delete process.env.TG_DOLT_SERVER_PORT` (and optionally `TG_DOLT_SERVER_DATABASE`) so leftover integration env does not affect unit tests if the mock does not apply.
6. **Unify runner for doc-skill-registry** — Convert `doc-skill-registry.test.ts` to Bun or run it with Vitest in gate:full with consistent cwd and repo layout.

---

## Next steps

- **Option A:** Turn these into a Cursor plan (e.g. "Gate Full Root Cause Fixes") with tasks 1–2 and 4–5 as implementation tasks, 3 as optional investigate, 6 as test-infra. Then run `/work` to execute.
- **Option B:** Implement tasks 1 and 2 first (pool key + refuse empty database), re-run gate:full, and see if integration "dolt/" failures disappear; then address unit isolation (4–5) and doc-skill-registry (6) if needed.
- **Option C:** Run the work skill’s hunter-killer flow (one investigator per cluster) to apply fixes and re-run gate:full, using this report as context for the investigators.
