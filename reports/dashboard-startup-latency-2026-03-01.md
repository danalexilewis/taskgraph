# Dashboard Startup Latency - Research Report

**Date:** 2026-03-01
**Scope:** Why `tg dashboard` is slow to first paint; how Dolt can support a background server mode with materialized/cached status data.
**Produced by:** Research skill (orchestrator analysis) + live process inspection.

---

## Root Cause

Every `tg` CLI invocation without `TG_DOLT_SERVER_PORT` set routes through `doltSql()` in **subprocess mode**: `execa("dolt", ["sql", "-q", ...])` is called per query. This is a full process fork + Dolt binary startup + noms storage load for each of the ~12 queries in `fetchStatusData`. At ~200–500ms each, the first render of the dashboard blocks for 2–4+ seconds before the screen paints.

Evidence from `ps aux` observation: `tg status --tasks` (subprocess mode) took >235 seconds to complete and spawned 20+ concurrent `dolt sql` child processes simultaneously.

## Infrastructure Already Exists

The fix is already halfway built. In `src/db/connection.ts`:

```
if (TG_DOLT_SERVER_PORT is set)
  → use mysql2 connection pool  (1–5ms per query)
else
  → execa("dolt sql -q ...")    (200–500ms per query)
```

The integration tests already exploit this: `__tests__/integration/global-setup.ts` starts a `dolt sql-server`, writes the port to `.taskgraph/tg-dolt-server-port.txt`, sets `TG_DOLT_SERVER_PORT`, and all test queries run at pool speed. The pattern is proven. It just isn't wired up for normal CLI use.

## Key Files and Roles

| File                                        | Role                                                           |
| ------------------------------------------- | -------------------------------------------------------------- |
| `src/db/connection.ts:26`                   | `getServerPool()` — pool creation, cached by host:port         |
| `src/db/connection.ts:67`                   | `doltSqlServer()` — pool-based query execution                 |
| `src/db/connection.ts:110`                  | `doltSql()` — dispatch gate: checks `TG_DOLT_SERVER_PORT`      |
| `src/cli/dashboard.ts:19`                   | `REFRESH_MS = 2000` — 2s live refresh interval                 |
| `src/cli/status.ts:156`                     | `fetchStatusData()` — runs ~12 queries per status render       |
| `__tests__/integration/global-setup.ts:101` | `dolt sql-server` spawn + readiness check + port file pattern  |
| `.taskgraph/tg-dolt-server-port.txt`        | Port file (currently left over from test runs; contains 13307) |

## Additional Finding: Leaked Integration Test Servers

Live process inspection revealed **50+ orphaned `dolt sql-server` processes** still running from previous integration test runs, each pointed at a `/var/folders/...` temp directory. These are consuming CPU and memory and are never killed. Root cause: global teardown is not reliably running `SIGKILL` on each test server's PID.

A task ("Start and stop Dolt sql-server in global setup and teardown", `fb6bd667`) is already `doing` in the "Integration Test Speed - Process Elimination" plan. This finding confirms that plan's urgency.

Separately, `.taskgraph/tg-dolt-server-port.txt` currently contains `13307` — the golden template test server port — not a production server port. This means `doltSql()` in production is connecting to a test database's server rather than the production one, which likely causes silent failures or incorrect data when the env var is manually set.

## Dolt Feature Evaluation

### Scheduled Events (MySQL EVENT SCHEDULER)

Dolt supports MySQL-compatible `CREATE EVENT ... ON SCHEDULE EVERY N` statements, running inside `dolt sql-server`.

**Fit for dashboard cache refresh:** Poor.

- 30-second minimum event frequency (Dolt v1 hardcoded limit)
- Events only fire on `main` branch
- SQL-only logic — `fetchStatusData`'s multi-join queries can't be pre-computed into a cache table without a stored procedure equivalent of the TypeScript logic
- Requires `dolt sql-server` to be running anyway
- Best fit: maintenance tasks (GC, pruning), not hot-path reads

### Materialized Views

Dolt does **not** have native materialized views. Standard views are supported but are not pre-computed.

### Connection Pool Mode

Highly effective. When `TG_DOLT_SERVER_PORT` is set, queries go through `mysql2` connection pool and return in 1–5ms vs 200–500ms. This alone eliminates the dashboard startup latency problem — no caching needed.

## Options Analysis

| Option                                | First-paint latency | Effort      | Notes                                                                                                 |
| ------------------------------------- | ------------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| **A: `tg server start/stop` command** | 10–30ms             | Low–Medium  | Wire up existing pool; lifecycle management; auto-detect port file                                    |
| **B: Daemon with status cache file**  | 0ms (stale ≤5s)     | Medium      | Extends A; daemon polls fetchStatusData, writes tg-status-cache.json; dashboard shows cache then live |
| **C: Dolt Scheduled Events as cache** | ≤30s stale          | Medium–High | SQL-only, 30s minimum, maintenance tasks only — not recommended for dashboard                         |

## Recommendations (ranked by impact/effort)

1. **`tg server start/stop/status` command** (Phase 1 — high impact, low effort).
   - Spawns `dolt sql-server --data-dir <doltRepoPath>` as a detached background process
   - Auto-finds a free port; writes to `.taskgraph/tg-dolt-server-port.txt` and `.taskgraph/tg-server-pid.txt`
   - `readConfig()` (or the `doltSql()` path) auto-detects the port file and uses pool mode without requiring env var
   - Cuts dashboard open from 2–4s to <30ms; also speeds up all `tg` commands

2. **Fix port file namespace collision** (quick fix, can bundle with Phase 1).
   - Integration tests must write to a file that doesn't clash with production (e.g. `tg-test-server-port.txt`) — or production code must ignore test-epoch port files (check PID liveness before trusting the file)

3. **Status cache in daemon** (Phase 2 — optional, for zero-latency first paint).
   - Extend the daemon from Phase 1 with a `setInterval(5000)` that runs `fetchStatusData` and writes `.taskgraph/tg-status-cache.json`
   - Dashboard reads cache synchronously on open before any query; live queries then update at normal 2s interval
   - The "cron job" is a Node.js `setInterval` in the daemon process — no OS scheduler, no SQL Events

4. **Kill leaked integration servers** (active task `fb6bd667` in Integration Test Speed plan).
   - Global teardown must kill each spawned PID; `--force` cleanup of `/var/folders/` tmpdir stubs

---

## Summary

The slowness is purely `doltSql()` in subprocess mode. The architecture for pool-based fast queries already exists and is exercised in integration tests; it just needs a user-facing lifecycle command (`tg server start`) and auto-detection in production CLI startup. Dolt Scheduled Events and materialized views are not the right tools for this use case — they're for maintenance, not hot-path caching. A Node.js daemon with a 5s `setInterval` is the right driver for a status cache if zero-latency first paint is needed in Phase 2.
