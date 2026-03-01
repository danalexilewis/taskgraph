# Integration Test Speed Research

**Date:** 2026-03-01
**Current baseline:** 86 tests, 23 files, 295s sequential, 0 failures

---

## Where the Time Goes

| Component                                                   | Count | Est. overhead each                 | Total est. |
| ----------------------------------------------------------- | ----- | ---------------------------------- | ---------- |
| `runTgCli` calls (each spawns `node dist/cli/index.js`)     | 132   | ~1-3s (Node cold start + CLI load) | ~130-400s  |
| Direct `doltSql` calls from test code                       | 59    | ~100-500ms (Dolt CLI startup)      | ~6-30s     |
| Direct `execa(dolt)` calls from test code                   | 11    | ~100-500ms                         | ~1-5s      |
| `setupIntegrationTest` per file (cpSync + ensureMigrations) | 23    | ~1-2s                              | ~23-46s    |

**The dominant cost is process spawning.** 132 `runTgCli` calls alone account for most of the 295s. Each `runTgCli`:

1. Spawns `node` (cold start: ~500ms-1s)
2. Loads the full CLI (requires, Commander setup: ~200-500ms)
3. Runs `doltSql` internally (1-3 dolt processes per command: ~300-1500ms)

Total: ~1-3s per `runTgCli` call, and we do 132 of them.

---

## Options (ranked by impact/effort)

### Option 1: Dolt SQL Server Mode (High impact, Medium effort)

**What it is:** Start `dolt sql-server` once at global setup. Replace all `doltSql()` calls (which spawn `dolt` CLI per query) with a persistent `mysql2` connection pool.

**Impact:** Eliminates ~200+ Dolt CLI process spawns. Each query goes from ~100-500ms (process spawn) to ~1-10ms (TCP query over persistent connection). Based on DoltHub's own benchmarks, this gave them a **90% speedup** in their test suite.

**How it works:**

```
global-setup:
  1. dolt sql-server --port 3307 --data-dir <golden-template>
  2. Export connection config

per-test:
  1. Copy golden template (same as now)
  2. Start dolt sql-server on unique port (or use branch-per-test on shared server)
  3. Use mysql2 pool instead of execa('dolt', ['sql', ...])

global-teardown:
  1. Kill all dolt sql-server processes
```

**Node.js integration:** Dolt is MySQL-wire-compatible. Use `mysql2` (standard npm package):

```js
import mysql from "mysql2/promise";
const pool = mysql.createPool({ host: "localhost", port: 3307, user: "root" });
const [rows] = await pool.execute("SELECT * FROM task WHERE status = ?", [
  "todo",
]);
```

**Gaps it fills:** Eliminates the biggest single cost — per-query process spawning in `doltSql()`.

**Adoption cost:** Medium. Requires:

- New dependency: `mysql2`
- New `doltSqlServer()` function alongside existing `doltSql()`
- Global setup starts server; teardown kills it
- `connection.ts` gets a server-mode path

**Estimated speedup:** 50-70% reduction in doltSql time. Won't help `runTgCli` (those spawn the full CLI).

---

### Option 2: Warm CLI / Long-lived Node Process (Very high impact, High effort)

**What it is:** Instead of spawning `node dist/cli/index.js` 132 times, start one long-lived Node process that accepts commands over IPC/stdin and responds with results.

**Impact:** Eliminates 132 Node cold starts (~130-400s). The single biggest time sink.

**How it works:**

```
test-utils:
  const cliProcess = spawn('node', ['dist/cli/index.js', '--server-mode']);
  // Send commands via stdin, receive JSON responses via stdout

  async function runTgCli(command, cwd) {
    cliProcess.stdin.write(JSON.stringify({ command, cwd }));
    return await readNextResponse(cliProcess.stdout);
  }
```

**Gaps it fills:** Directly addresses the #1 cost — 132 Node process cold starts.

**Adoption cost:** High. Requires:

- New `--server-mode` flag in CLI that reads commands from stdin
- Significant refactor of CLI entrypoint
- Per-test CWD/config isolation becomes trickier (must set via command, not env)
- More complex error handling (process crash recovery)

**Estimated speedup:** 60-80% overall. Combined with Option 1, could hit 90%+.

---

### Option 3: In-Process CLI Calls (Very high impact, Medium effort)

**What it is:** Instead of spawning `node dist/cli/index.js` via `execa`, import the CLI's command handlers directly and call them in-process. The test runner is already a Node/Bun process.

**Impact:** Same as Option 2 (eliminates 132 Node cold starts) but simpler.

**How it works:**

```js
// test-utils.ts
import { createProgram } from '../../src/cli/index';

async function runTgCliInProcess(command: string, cwd: string) {
  const origCwd = process.cwd();
  process.chdir(cwd);
  try {
    const program = createProgram();
    await program.parseAsync(['node', 'tg', ...command.split(' ')]);
    // capture stdout via intercept
  } finally {
    process.chdir(origCwd);
  }
}
```

**Gaps it fills:** Same as Option 2. No process spawn at all — function call overhead only.

**Adoption cost:** Medium. Requires:

- Export `createProgram()` from `src/cli/index.ts`
- Capture stdout/stderr (use `captureOutput` pattern or Commander's `exitOverride`)
- Handle CWD isolation (chdir + restore, or pass basePath)
- Ensure no global state leaks between calls (reset singletons)

**Caution:** Tests that validate "the CLI binary works end-to-end" would lose that coverage. Keep a few smoke tests using the real `execa` path.

**Estimated speedup:** 60-80% overall.

---

### Option 4: Dolt `CALL dolt_reset('--hard')` State Recycling (Medium impact, Low effort)

**What it is:** From DoltHub's own blog post: instead of copying the golden template for each test file (23 cpSync calls), use a single Dolt repo and reset it between tests with `CALL dolt_reset('--hard'); CALL dolt_clean('--all')`.

**Impact:** Eliminates 23 `fs.cpSync` calls and 23 `ensureMigrations` calls.

**How it works:**

```
global-setup:
  1. Create one golden template with migrations (same as now)
  2. Start dolt sql-server on it

per-test-file:
  1. CALL dolt_reset('--hard')   -- rewind modified tables
  2. CALL dolt_clean('--all')    -- drop new tables
  3. Run tests
```

**Gaps it fills:** Eliminates per-file setup overhead (~1-2s each, ~23-46s total).

**Adoption cost:** Low. Requires sql-server mode (Option 1). Two SQL calls per file instead of cpSync + ensureMigrations.

**Caution:** Tests within a file must be serialized (already are with `describe.serial`). Cross-file isolation requires either separate server instances or branch-per-file.

**Estimated speedup:** 10-15% standalone. 20-30% combined with server mode.

---

### Option 5: Controlled Parallelism (Medium impact, Low effort)

**What it is:** Re-enable concurrent test file execution but with a cap (e.g., 4 files at a time) now that `DOLT_ROOT_PATH` isolation and `TG_SKIP_MIGRATE` are in place.

**Impact:** If 4 files run in parallel, theoretical 4x speedup on wall-clock time. 295s / 4 = ~74s.

**How it works:**

```toml
# bunfig.toml — re-add with concurrency cap
concurrentTestGlob = ["**/__tests__/integration/**"]
```

```bash
# Or use CLI flag
bun test __tests__/integration --concurrency 4
```

**Gaps it fills:** Gets back the parallelism we had to disable due to resource exhaustion. With DOLT_ROOT_PATH isolation and TG_SKIP_MIGRATE, the process count per file is much lower.

**Adoption cost:** Low. One config change + verify stability.

**Estimated speedup:** 3-4x wall-clock reduction (from 295s to ~75-100s).

**Caution:** Start at `--concurrency 3`, measure, increase. Monitor for file descriptor exhaustion.

---

### Option 6: Replace More `runTgCli` with Direct Domain Calls (Low-Medium impact, Low effort)

**What it is:** Continue the pattern started in the pilot (no-hard-deletes.test.ts): replace `runTgCli` calls that only read state for assertions with `doltSql` or domain function calls.

**Impact:** Each replaced call saves ~1-3s. The 132 calls include many that are just "check the status is X" or "get the plan ID".

**Estimated replaceable:** ~40-60 of 132 calls are read-only state checks.

**Adoption cost:** Low. Incremental, per-file changes. No infrastructure changes needed.

**Estimated speedup:** 15-25% (save ~40-60 process spawns).

---

## Recommendations (by impact/effort ratio)

| Priority | Option                                      | Impact    | Effort         | Estimated time after      |
| -------- | ------------------------------------------- | --------- | -------------- | ------------------------- |
| **1**    | **Option 5: Controlled parallelism**        | High      | Low            | ~75-100s                  |
| **2**    | **Option 3: In-process CLI calls**          | Very high | Medium         | ~30-60s                   |
| **3**    | **Option 1: Dolt SQL Server mode**          | High      | Medium         | ~20-40s                   |
| **4**    | **Option 6: Replace runTgCli with doltSql** | Medium    | Low            | Incremental               |
| **5**    | **Option 4: State recycling**               | Medium    | Low (needs #1) | Incremental               |
| **6**    | **Option 2: Warm CLI**                      | Very high | High           | Skip (Option 3 is better) |

### Recommended execution path

1. **Option 5 first** — re-enable `--concurrency 3-4`. One config change, immediate 3-4x wall-clock improvement. Gets us from 295s to ~75-100s.

2. **Option 3 next** — in-process CLI calls. Eliminates 132 Node cold starts. This is the highest-value single change. Combined with parallelism, could get to ~20-40s.

3. **Option 1 after** — Dolt sql-server mode. Eliminates per-query Dolt process spawns. Combined with #1 and #2, target: **<30s** for the full integration suite.

4. **Options 4 and 6** are incremental improvements to apply alongside or after the above.

5. **Skip Option 2** — the warm CLI approach is superseded by Option 3 (in-process calls) which is simpler and faster.

### Target

| Milestone      | Strategy                            | Estimated time |
| -------------- | ----------------------------------- | -------------- |
| Current        | Sequential, all process spawns      | 295s           |
| After Option 5 | Parallel 4x                         | ~75s           |
| After Option 3 | In-process CLI + parallel           | ~25-40s        |
| After Option 1 | Server mode + in-process + parallel | **<20s**       |
