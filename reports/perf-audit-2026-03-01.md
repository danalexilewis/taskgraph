# Performance Audit — Full Codebase

**Date:** 2026-03-01  
**Scope:** Full codebase — integration test infrastructure, DB layer, CLI hot paths, schema design, Dolt lifecycle  
**Trigger:** 80 orphaned `dolt sql-server` processes discovered consuming ~3.5 GB RAM  
**Scanners run:** schema-profiler, query-auditor, hotpath-tracer, anti-pattern-scanner, dolt-specialist  
**Pre-compute notes stored on task:** `21b42be8-2ca4-4e26-bfdb-5c5b13a06691`

---

## Executive Summary

Two independent critical problems dominate the performance profile:

1. **Production CLI is 6–8 seconds slow per command** because every `tg` invocation spawns ~42 sequential `dolt` subprocess processes (32 migration probes + 10 status queries), each at 150–400 ms cold-start cost. This is because production has no persistent Dolt sql-server; all DB access goes through `execa()`.

2. **Integration tests leak one orphaned `dolt sql-server` process per test failure/crash**, accumulating to 80 processes and 3.5 GB RSS. Three compounding bugs: `SIGTERM` targets only the PID not the process group, `afterAll` teardown is not called when `beforeAll` throws, and there is no PID registry for recovery across crashed runs.

Neither issue was caught in prior performance work because monitoring during tests was scoped to application-level metrics — the OS-level process count is never asserted, and the leak only becomes visible at scale after multiple test runs.

---

## Why The Previous Audit Missed This

The prior performance audit focused on query latency, render timing, and code hotpaths within the application boundary. The test infrastructure was not in scope as a performance surface. Three structural gaps allowed the problem to hide:

1. **No resource assertions in tests.** No `beforeAll`/`afterAll` checks for process count or memory. `pgrep -c dolt` is never called. The accumulation is invisible to the test reporter.

2. **No pre-suite cleanup.** `global-setup.ts` writes a golden server PID file without first checking if a stale one exists from a crashed previous run. Per-test PIDs are never persisted anywhere.

3. **Accumulation requires repeated runs to reach crisis scale.** A single test run leaking 3–5 processes per file looks harmless. After 10–20 test runs without a manual `killall dolt`, 80+ orphans accumulate.

**The lesson:** When instrumenting performance, always record OS-level signals alongside app-level ones. Process count + memory are the cheapest invariants to assert and the first to surface infrastructure leaks.

---

## Findings — Ranked

| #   | Finding                                                                                     | Severity    | Area         | Scanner(s)                      |
| --- | ------------------------------------------------------------------------------------------- | ----------- | ------------ | ------------------------------- |
| 1   | `tg status` spawns ~42 dolt subprocesses (32 migration probes + 10 queries)                 | 🔴 Critical | DB / CLI     | dolt-specialist, query-auditor  |
| 2   | Orphaned test dolt servers — `SIGTERM` on wrong scope (PID not PGID)                        | 🔴 Critical | Test infra   | hotpath-tracer, anti-pattern    |
| 3   | `beforeAll` throws after server is already up → orphan, no recovery path                    | 🔴 Critical | Test infra   | hotpath-tracer, anti-pattern    |
| 4   | Port collision: `(pid + counter) % 90` → orphan's socket accepted as "ready"                | 🔴 Critical | Test infra   | hotpath-tracer, dolt-specialist |
| 5   | No secondary indexes on `event.task_id`, `edge.to_task_id`, `task.plan_id`, `task.status`   | 🔴 Critical | Schema       | schema-profiler                 |
| 6   | `fetchStatusData` 16-18 sequential DB queries, all independent                              | 🟡 Moderate | CLI / DB     | query-auditor, hotpath-tracer   |
| 7   | `ensureMigrations` 32 subprocess probes per command, no cross-invocation cache              | 🟡 Moderate | DB           | dolt-specialist, query-auditor  |
| 8   | N+1 in `allocateHashId` during plan import — full table scan per task                       | 🟡 Moderate | Import       | query-auditor                   |
| 9   | N+1 in `syncBlockedStatusForTask` per task in import loop                                   | 🟡 Moderate | Import       | query-auditor                   |
| 10  | `agentMetricsSql` correlated subquery: O(N) per done-event = O(N²) full scan as events grow | 🟡 Moderate | CLI          | query-auditor                   |
| 11  | `poolCache` unbounded growth in tests (one mysql2 pool per unique port)                     | 🟡 Moderate | Test infra   | hotpath-tracer                  |
| 12  | `stats.test.ts` spawns 4 dolt servers (4 nested describes × 1 setup each)                   | 🟡 Moderate | Test infra   | anti-pattern                    |
| 13  | No production server mode documentation or auto-start                                       | 🟡 Moderate | DX / Infra   | dolt-specialist                 |
| 14  | `DOLT_CHECKOUT` + query = two pool ops, may land on different connections                   | 🟡 Moderate | DB           | dolt-specialist                 |
| 15  | `event` table unbounded append-only; no archival                                            | 🟢 Latent   | Schema       | schema-profiler                 |
| 16  | `task` / `project` wide tables read with SELECT \* on all queries                           | 🟢 Latent   | Schema / CLI | schema-profiler                 |
| 17  | `event.body` JSON hot paths have no virtual generated columns                               | 🟢 Latent   | Schema       | schema-profiler                 |
| 18  | Orphan agent branches on `tg done` failure — no prune mechanism                             | 🟢 Latent   | Git          | dolt-specialist                 |
| 19  | `runTgCliInProcess` mutates global `process.env`/`process.cwd` — fragile under concurrency  | 🟢 Latent   | Test infra   | anti-pattern                    |

---

## Finding Details

### Finding 1: ~42 dolt subprocess spawns per `tg status` (🔴 Critical)

**Evidence:**

- `src/cli/index.ts` — `preAction` hook calls `ensureMigrations()` on every command
- `src/db/migrate.ts` — 17 migration functions, each calling `tableExists`/`columnExists`/`viewExists` via `doltSql()`. The `QueryCache` deduplicates within a single `ensureMigrations` call but is recreated fresh per process invocation — zero reuse across `tg` commands.
- `src/db/connection.ts:149` — `doltSql()` uses `execa("dolt", [...])` — one OS process per query in the default (no-server) mode.
- `src/cli/status.ts` — `fetchStatusData` chains 17+ sequential `doltSql()` calls via `.andThen()`.

**Why it's slow:** ~32 migration probes + ~10 status queries = ~42 subprocess spawns. Dolt Go binary cold-start: 150–400 ms each. Total: **6–8 seconds of pure subprocess overhead** per `tg status` on a warmed OS. This is the dominant latency source for every CLI command.

**Fix approach:** Two independent fixes:

1. Persist migration state as a `.tg-migration-version` file — read the version hash once, compare to expected, skip all 32 subprocess probes when already current.
2. Add a `tg server start` command that launches a persistent `dolt sql-server` and writes `TG_DOLT_SERVER_PORT` to a config; all CLI commands then use the mysql2 pool (server mode), reducing each query to a <5 ms round-trip.

---

### Finding 2: `SIGTERM` targets PID not process group (🔴 Critical)

**Evidence:**

- `__tests__/integration/test-utils.ts:166` — `process.kill(context.serverPid, "SIGTERM")`
- `__tests__/integration/global-teardown.ts:19` — `process.kill(pid, "SIGTERM")`
- Both spawn with `detached: true` (test-utils.ts:74, global-setup.ts:111) — the spawned process becomes its own PGID leader.

**Why it's wrong:** `process.kill(pid, 'SIGTERM')` sends to the exact PID only. A detached process group leader that spawns children (Dolt's sql-server forks storage workers) has those children in the same PGID. They survive. The correct call for a detached process is `process.kill(-pid, 'SIGTERM')` (negative PID = kill entire process group). Additionally, there is no SIGKILL fallback after a timeout — any server that doesn't die on SIGTERM persists indefinitely.

**Fix approach:** Change all teardown kill calls to `process.kill(-pid, 'SIGTERM')` with a 3-second timeout fallback to `process.kill(-pid, 'SIGKILL')`.

---

### Finding 3: `beforeAll` throw after server starts → silent orphan (🔴 Critical)

**Evidence:**

- `test-utils.ts:116–144` — `setupIntegrationTest()` starts the server at line 132, then calls `ensureMigrations()` at line 135. If `ensureMigrations` throws (e.g., port conflict from an earlier orphan), the function rejects before returning `context`.
- All 29 test files follow: `if (context) await teardownIntegrationTest(context)` in `afterAll`. The `if (context)` guard silently skips teardown if setup failed.
- `beforeAll` in Bun runs without try/finally protection — a throw leaves the already-started server running with no shutdown path.

**Why it matters:** This creates a **positive feedback loop**: orphaned processes occupy ports → next run gets port conflicts → `ensureMigrations` fails → more orphans. Each failed run begets more failures.

**Fix approach:** Wrap `setupIntegrationTest` in try/finally — kill the server if any post-start step throws. Register a `process.on('exit')` emergency cleanup that kills any server started but not yet torn down. Add a global PID registry file (`tg-test-all-pids.json`) that `global-teardown` uses as a safety-net kill-all.

---

### Finding 4: Port collision → silent wrong-database scenario (🔴 Critical)

**Evidence:**

- `test-utils.ts:129–131` — `PER_TEST_PORT_BASE + (((process.pid ?? 0) + perTestPortCounter++) % PER_TEST_PORT_RANGE)` with `PER_TEST_PORT_RANGE = 90`.
- With 80 orphaned processes already holding ports 13310–13399, a newly spawned dolt fails to bind port N (silently, since `stdio: 'ignore'`) and exits immediately. The TCP readiness check in `startDoltServer` connects to the **orphan's socket** already listening on port N, returns `true`, and returns the dead process's PID as the "server PID".
- The test then queries the orphan's data directory — **a completely different database** — producing silent data isolation failures.

**Fix approach:** Pre-check port availability with a TCP connect _before_ spawning. If the port already responds, skip to the next port. Expand the port range to 256+ or use OS-assigned dynamic ports (`port: 0`). Add a registry of all test-run PIDs so a pre-run cleanup step can kill all stale ones.

---

### Finding 5: Missing secondary indexes on hot FK columns (🔴 Critical)

**Evidence:** No `CREATE INDEX` statements anywhere in `src/db/migrate.ts`. Dolt, like MySQL InnoDB, does not auto-create indexes on FK referencing columns.

**Unindexed hot columns:**

- `event.task_id` — JOINed by task in every status, stats, context, start, show command. Full table scan per task.
- `edge.to_task_id` — PK is `(from, to, type)`. "Is task blocked?" subquery filters on `to_task_id` — can't use the PK. Runs on every task in `tg status`, `tg next`, `tg start`.
- `task.plan_id` — JOINed in every multi-task query.
- `task.status` — filtered in every query that distinguishes todo/doing/done.
- `gate.task_id` — correlated subquery in task list.

**Fix approach:** A single new migration adding 5 indexes covers all critical cases:

```sql
CREATE INDEX idx_event_task_kind_created ON event(task_id, kind, created_at);
CREATE INDEX idx_edge_to_task ON edge(to_task_id, type);
CREATE INDEX idx_task_plan ON task(plan_id);
CREATE INDEX idx_task_status ON task(status);
CREATE INDEX idx_gate_task ON gate(task_id, status);
```

---

### Finding 6: `fetchStatusData` 16–18 sequential queries, all independent (🟡 Moderate)

**Evidence:** `src/cli/status.ts:352–533` — `completedPlansSql` → `.andThen(completedTasksSql)` → `.andThen(...)` 16 times deep. Each query is independent (none uses the output of a prior query). In server mode these are 16 sequential round-trips. In subprocess mode they are 16 sequential processes. Additionally, `nextSql` and `next7Sql` are identical queries with different LIMITs — one `LIMIT 7` + JS `.slice()` eliminates one subprocess.

**Fix approach:** Group independent queries into `ResultAsync.combine([...])` batches. Merge `completedPlansSql`, `completedTasksSql`, `canceledTasksSql` into a single `GROUP BY status` query. Merge `nextSql`/`next7Sql`.

---

### Finding 7: `ensureMigrations` 32 subprocess probes per command (🟡 Moderate)

**Evidence:** `src/db/migrate.ts` — 17 `apply*Migration` functions chain 32 `tableExists`/`columnExists`/`viewExists` calls. The `QueryCache` inside `ensureMigrations` deduplicates within the call but is recreated each time (no persistent state). On a fully-migrated DB, all 32 checks are "already done" but still fire subprocesses.

**Fix approach:** Write a `~/.taskgraph/.migration-version` sentinel file containing a hash of the expected schema. On startup, compare to actual; skip all 32 probes if hash matches. Invalidate only when a `tg init` or `tg upgrade` runs.

---

### Finding 8 & 9: N+1 in plan import (🟡 Moderate)

**Evidence:**

- `src/plan-import/importer.ts:265` — `allocateHashId(repoPath, taskId)` inside a `for` loop. Each call runs `SELECT hash_id FROM task WHERE hash_id IS NOT NULL` — a full table scan — once per new task.
- `src/plan-import/importer.ts:384` — `syncBlockedStatusForTask(repoPath, taskId)` inside a loop over all plan tasks. Each call is 2–4 subprocess queries. For a 20-task import: 40–80 subprocesses just for blocked-status sync.
- Total subprocess estimate for a 20-task import: **~200–280 sequential spawns**.

**Fix approach:** Run `allocateHashId` once before the loop with a pre-fetched set of existing hash IDs. Replace per-task `syncBlockedStatus` with a single bulk query that fetches all unmet blocker counts for all plan tasks at once.

---

### Finding 10: `agentMetricsSql` O(N²) correlated subquery (🟡 Moderate)

**Evidence:** `src/cli/status.ts:212–223` — for each `done` event row, a correlated subquery looks up the matching `started` event. Grows as O(N²) over the event table as projects accumulate.

**Fix approach:** Rewrite as a self-join on the event table filtered by `kind IN ('started', 'done')` with a lateral join or window function equivalent for Dolt.

---

## Observability Gaps — Why The Audit Missed The Process Leak

The anti-pattern scanner identified the specific mechanisms:

1. **No `pgrep dolt` / process count check** in any test setup or teardown hook
2. **No PID registry** — per-test PIDs exist only as in-memory JS variables; a crash loses them
3. **No stale-PID check** in `global-setup.ts` before writing a new PID file
4. **`bunfig.toml` 10s global timeout** can kill `beforeAll` after `spawn` but before TCP-ready, orphaning the server with no record of its PID
5. **`stats.test.ts` 4 nested describes** each with their own `setupIntegrationTest` — 4 separate dolt servers per file run

## Evolving The Performance Testing Capability

Opportunities identified across all scanners:

1. **`assertNoDoltLeak(label)` test helper** — shells out to `pgrep -c dolt` before and after each suite. Assert count never grows above expected. This is the single highest-leverage observability addition.

2. **PID registry file** (`tg-test-all-pids.json`) — `setupIntegrationTest` appends each server PID; `teardownIntegrationTest` removes it; `global-teardown` kills everything remaining. Survives test runner crashes.

3. **`global-setup` stale-PID cleanup** — before writing a new PID file, kill any existing PID from the previous run.

4. **Process count in CI artifacts** — record `ps aux | grep dolt | wc -l` before and after the test suite in CI. Surface as a metric over time.

5. **Shared server + per-test database** — a single `dolt sql-server` for all integration tests with `CREATE DATABASE test_<uuid>` per test, `DROP DATABASE` in teardown. Eliminates 26 of 27 per-test server processes. Reduces test suite startup from 27× dolt server spawns to 1.

6. **`tg server start/stop` command** — manage a persistent production Dolt server. Write `TG_DOLT_SERVER_PORT` to `.taskgraph/config.json`. All CLI commands switch to server mode automatically.

---

## Remediation Tasks

### Group 1: Test Infrastructure — Critical (unblock safe test runs)

1. **Fix process group kill in test teardown** — `process.kill(-pid, 'SIGTERM')` + 3s SIGKILL fallback in `teardownIntegrationTest` and `globalTeardown` `agent: implementer`
2. **Add try/finally in `setupIntegrationTest`** — kill server if `ensureMigrations` throws; add `process.on('exit')` emergency cleanup `agent: implementer`
3. **Add PID registry file + global-teardown safety-net kill-all** — `setupIntegrationTest` appends to registry; `global-teardown` reads and kills all remaining `agent: implementer`
4. **Add `assertNoDoltLeak` pre/post check** — `pgrep -c dolt` before setup and after teardown; warn/fail if count grows `agent: implementer`
5. **Fix port allocation** — expand range to 200+ or use OS-assigned ports; pre-check port before spawn `agent: implementer`
6. **Bump `beforeAll` timeout for slow suites** — `stats.test.ts`, `worktree.test.ts`, `plan-worktree.test.ts` `agent: implementer`

### Group 2: Schema — High leverage, enables all other DB fixes

7. **Add secondary index migration** — 5 indexes: `event(task_id, kind, created_at)`, `edge(to_task_id, type)`, `task(plan_id)`, `task(status)`, `gate(task_id, status)` `agent: implementer`

### Group 3: CLI Performance

8. **Persist migration state** — `.tg-migration-version` sentinel file; skip 32 subprocess probes on fully-migrated DB `agent: implementer`
9. **Parallelize `fetchStatusData`** — replace nested `.andThen()` waterfall with `ResultAsync.combine` for independent queries `agent: implementer`
10. **Merge redundant queries** — `nextSql`+`next7Sql` → single query; `completedPlans/Tasks/Canceled` → single GROUP BY `agent: implementer`
11. **Add `tg server start/stop` command** — persistent dolt server lifecycle management; auto-configure `TG_DOLT_SERVER_PORT` `agent: implementer`

### Group 4: Import Performance

12. **Fix `allocateHashId` N+1** — pre-fetch existing IDs before import loop `agent: implementer`
13. **Bulk `syncBlockedStatus` after import** — replace per-task loop with batch query `agent: implementer`

### Group 5: Latent

14. **Fix `agentMetricsSql` correlated subquery** — rewrite as self-join `agent: implementer`
15. **Add virtual generated columns for `event.body` hot paths** — `body_agent`, `body_tokens_in`, `body_tokens_out` `agent: implementer`
16. **Project `SELECT *` to needed columns** — status.ts, next.ts callers `agent: implementer`
17. **Add `tg worktree prune` command** — clean up orphan agent branches `agent: implementer`

---

## Next Steps

1. **Kill remaining orphaned processes** — already done (80 processes killed, 3.5 GB freed).
2. **Review and approve this plan** — confirm Group 1 (test infra) and Group 2 (indexes) as the first wave.
3. **Run `/work`** to execute remediation tasks once plan is imported.
4. **Add `assertNoDoltLeak`** as a permanent fixture of the test suite before re-enabling full parallel integration test runs.
