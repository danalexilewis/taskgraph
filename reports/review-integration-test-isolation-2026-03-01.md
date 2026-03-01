# Review — Integration Test Isolation

**Date:** 2026-03-01  
**Scope:** Why integration tests fail under concurrency; isolation gaps and improvements.  
**Produced by:** Investigator sub-agent (codebase analysis, hypothesis-driven investigation).  
**Supplementary data:** Second investigator (Dolt CLI locking and global state).

---

# Integration Test Concurrency Investigation — Structured Findings

## 1. Files and Roles

| File                                      | Role                                                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `bunfig.toml`                             | Enables concurrent file execution for `__tests__/integration/**` and `__tests__/e2e/**`                                                  |
| `__tests__/integration/test-utils.ts`     | Shared helpers: `setupIntegrationTest` (mkdtemp + cpSync golden + writeConfig + ensureMigrations), `teardownIntegrationTest`, `runTgCli` |
| `__tests__/integration/global-setup.ts`   | Creates one golden template (dolt init + all migrations); writes path to temp file                                                       |
| `scripts/run-integration-global-setup.ts` | Pre-test script that invokes `global-setup.ts` in a separate process                                                                     |
| `src/db/connection.ts`                    | `doltSql()` — spawns `dolt --data-dir <repoPath> sql ...`; no module-level mutable state                                                 |
| `src/db/commit.ts`                        | `doltCommit()` — spawns `dolt add -A` then `dolt commit`; no module-level state                                                          |
| `src/db/migrate.ts`                       | `ensureMigrations()` — chains ~9 idempotent migration checks; no module-level caching                                                    |
| `src/db/branch.ts`                        | `checkoutBranch/createBranch/mergeBranch` — spawns dolt subprocesses; no shared state                                                    |
| `src/cli/index.ts`                        | CLI entrypoint; `preAction` hook runs `ensureMigrations` on EVERY command before dispatch                                                |
| `src/cli/utils.ts`                        | `readConfig(basePath?)` uses `basePath ?? process.cwd()` + `.taskgraph/config.json`                                                      |

**Integration test files examined:** 23 files in `__tests__/integration/`. Of these, 11 use `describe.serial`, 12 use plain `describe`. `status-live.test.ts` has 3 separate describe blocks (3 repos). `plan-completion.test.ts` uses `beforeEach` (creates a new repo per test case).

## 2. Root Cause Analysis

**The primary root cause is OS-level resource exhaustion from massive concurrent `dolt` process spawning, not a logical isolation gap in test data.**

Each test file's filesystem isolation is actually correct — every file gets a unique temp dir, unique config, and unique Dolt repo. There is **no cross-repo data contamination**. The failures are caused by running too many Dolt processes simultaneously on the same machine.

### Process Count Explosion

Across all 23 integration test files running concurrently:

- **`setupIntegrationTest()`** calls `ensureMigrations()`, which runs ~9 migration-check `doltSql` calls (each spawns a `dolt` process). With 25+ repos being created simultaneously (some files create multiple describe blocks), that's ~225 concurrent `dolt` processes just for setup.

- **Each `runTgCli()` call** spawns `node dist/cli/index.js` as a child process. That child runs `ensureMigrations()` (9 more `dolt` spawns) in the `preAction` hook before the actual command (which spawns 1-3 more `dolt` processes for SQL + commit). Total: ~10-12 dolt processes per CLI invocation.

- **Total `runTgCli` calls across all files**: ~125. Total CLI-driven `dolt` processes: ~1,250-1,500.

- **Direct `doltSql` calls across all files**: ~57. Add ~57 more `dolt` processes.

- **`status-live.test.ts`** creates long-lived dashboard subprocesses that hold resources for 2.5 seconds each while other tests compete.

- **`plan-completion.test.ts`** uses `beforeEach` creating 5 repos (one per test), each with full migration setup.

The net result: the machine is hit with hundreds of concurrent `dolt` (Go binary) and `node` processes. This causes:

- **File descriptor exhaustion**: Each `dolt` process opens multiple files in its noms chunk store
- **Process table saturation**: macOS default `ulimit` is ~2560 file descriptors
- **Noms manifest lock timeouts**: Within a single repo, if a `dolt` process is slow to release the manifest lock (due to CPU contention), the next sequential `dolt` call on that repo may fail with "database is read only" or "cannot update manifest"

## 3. Hypothesis Evidence (Confirm/Refute)

### H1: Dolt CLI global contention — PARTIALLY CONFIRMED

`doltSql` in `connection.ts` (line 41-51) correctly uses `--data-dir repoPath` and `cwd: repoPath`, isolating each invocation to its own repo. However, Dolt CLI reads `~/.dolt/config_global.json` on startup. With hundreds of concurrent `dolt` processes, this global config file sees heavy concurrent reads. This is unlikely to cause writes but adds I/O contention.

**The real global contention is at the OS level** — process table, file descriptors, CPU scheduling — not Dolt-specific global state.

**Supplementary finding (second investigator):** `~/.dolt/eventsData/` contains **237,419 files**. Every `dolt` CLI invocation reads/writes to this directory. Listing it alone takes ~8 seconds. This is a major I/O bottleneck for concurrent dolt processes. `DOLT_ROOT_PATH` is not set anywhere in the codebase, so all dolt processes share `~/.dolt/` as their global root.

### H2: process.env mutation — REFUTED (benign)

`test-utils.ts` line 15-16:

```
const DOLT_PATH = process.env.DOLT_PATH || "dolt";
if (!process.env.DOLT_PATH) process.env.DOLT_PATH = DOLT_PATH;
```

This is idempotent — sets `DOLT_PATH` once to "dolt" if unset. All test files read this same value. No test-specific env mutation was found. The `runTgCli` function spreads `process.env` into child processes (line 59), which is safe since no test mutates test-specific env vars.

### H3: In-process doltSql race — REFUTED (no shared state)

`doltSql` in `connection.ts` has **zero module-level mutable state**. The `doltPath` helper (line 10) reads `process.env.DOLT_PATH` each time but that's immutable after test-utils sets it. The `PROTECTED_TABLES` array and `destructivePattern` regex are constants. Each call spawns an independent `dolt` subprocess with explicit `--data-dir` and `cwd`. Multiple concurrent `doltSql` calls from different test files operate on different repos — no in-process race.

### H4: ensureMigrations concurrency — REFUTED (no shared state, but very expensive)

`ensureMigrations` in `migrate.ts` (line 369-383) has **no module-level caching or globals**. It chains 9 migration functions, each parameterized by `repoPath`. Concurrent calls with different `repoPath` values are independent.

**However**, this is the single biggest contributor to process spawning. Each of the 9 migrations runs 1-3 `doltSql` queries (column/table existence checks). For already-migrated repos (the common case), these are read-only SELECTs that early-return, but they still each spawn a `dolt` process. And this runs twice per test — once in `setupIntegrationTest()` and once in every `runTgCli` via the CLI `preAction` hook.

### H5: Golden template copy race — REFUTED

`fs.cpSync(templatePath, tempDir, { recursive: true })` (test-utils.ts line 34) does a pure filesystem copy. Multiple concurrent reads from the same source directory are safe on all POSIX systems. No Dolt process runs against the golden template during tests — it's created in global setup (a separate process) and only read during tests.

### H6: describe.serial scope — CONFIRMED (key misunderstanding)

`describe.serial` in Bun **only serializes tests within that describe block within that file**. It does NOT prevent file-level concurrency. `bunfig.toml` sets `concurrentTestGlob = ["**/__tests__/integration/**"]`, so all 23 integration test files run concurrently regardless of whether individual describe blocks are serial.

The comments in the codebase (e.g. `// Serial: flaky under concurrency (DB-dependent; Dolt "read only" / commit conflicts when parallel)`) reflect a misunderstanding: the team believes `describe.serial` prevents the observed failures, but the failures come from inter-file concurrency, not intra-file concurrency.

### H7: Dolt commit contention (cross-repo) — PARTIALLY CONFIRMED (indirect)

Tests that don't use `--no-commit` trigger `dolt add -A` + `dolt commit` (in `commit.ts` lines 20-49) on their respective repos. These are on separate repos, so there's no direct commit conflict. **However**, `dolt commit` is one of the most resource-intensive Dolt operations (writes to noms manifest, updates chunk store). Running 10+ concurrent `dolt commit` operations on different repos saturates disk I/O and can cause timeouts on any individual commit.

**The `--no-commit` flag dramatically reduces resource usage** — roughly halving the `dolt` process count per CLI call. Tests using `--no-commit` are significantly less likely to hit resource-related failures.

## 4. Isolation Gaps

| Gap                                         | Severity     | Description                                                                                                                                                                                        |
| ------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No file-level concurrency limit**         | **Critical** | `bunfig.toml` runs all 23 integration files concurrently with no cap.                                                                                                                              |
| **`~/.dolt/eventsData/` bloat**             | **Critical** | 237,419 files in global telemetry dir; every dolt process contends on it.                                                                                                                          |
| **ensureMigrations runs on every CLI call** | **High**     | The `preAction` hook in `src/cli/index.ts` (line 44-69) calls `ensureMigrations` for every command. With golden template pre-migrated, these are ~9 no-op checks that each spawn a `dolt` process. |
| **No migration state caching**              | **Medium**   | `ensureMigrations` has no in-process memory of repos already checked. Each invocation re-spawns 9 `dolt` processes.                                                                                |
| **plan-completion.test.ts uses beforeEach** | **Medium**   | Creates 5 separate Dolt repos (one per test) instead of reusing one.                                                                                                                               |
| **status-live.test.ts creates 3 repos**     | **Medium**   | Three separate describe blocks each call `setupIntegrationTest()`.                                                                                                                                 |
| **Many tests skip --no-commit**             | **Medium**   | Tests in `blocked-status-materialized.test.ts` (10 runTgCli calls, only 1 with --no-commit), `dolt-branch.test.ts`, `crossplan.test.ts` etc. run full commits, doubling process overhead.          |
| **No `DOLT_ROOT_PATH` isolation**           | **Medium**   | All test dolt processes share `~/.dolt/` global root; no per-run isolation of telemetry and global config.                                                                                         |

## 5. Recommended Fixes (ranked by impact)

1. **Clean `~/.dolt/eventsData/` and set `DOLT_ROOT_PATH` per test run** — Clear the 237K-file directory. For test runs, set `DOLT_ROOT_PATH` to a disposable temp directory so events accumulate there instead of the shared `~/.dolt/`. Or set `DOLT_DISABLE_EVENT_FLUSH=true` if supported.

2. **Limit file-level concurrency** — Change `bunfig.toml` to cap concurrent integration test files. Bun doesn't have a direct `maxConcurrency` for `concurrentTestGlob`, so the alternative is **removing integration tests from `concurrentTestGlob`** (run them sequentially) or using `bun test __tests__/integration --concurrency 4`. This alone would likely eliminate all flakiness.

3. **Skip ensureMigrations in CLI when golden template is pre-migrated** — Add an env var or config flag (e.g. `TG_SKIP_MIGRATE=1`) that the test harness passes to `runTgCli`. The `preAction` hook in `index.ts` would skip `ensureMigrations` when this flag is set. This eliminates ~9 dolt spawns per CLI call (the biggest multiplier).

4. **Cache migration checks in-process** — Add a module-level `Set<string>` to `ensureMigrations()` that tracks repo paths already verified in this process. For the test runner process (which calls `ensureMigrations` via `setupIntegrationTest`), subsequent direct `doltSql` calls don't re-check. For CLI child processes, the cache doesn't help (separate process), but it helps the setup phase.

5. **Batch SQL in ensureMigrations** — Instead of 9 separate `dolt sql` invocations, combine all existence checks into a single SQL query (e.g. `SELECT ... UNION ALL SELECT ...`). One `dolt` spawn instead of nine.

6. **Convert `plan-completion.test.ts` from `beforeEach` to `beforeAll`** — Use one shared repo with unique plan/task IDs per test (they already use `uuidv4()`). Saves 4 repo setups.

7. **Consolidate `status-live.test.ts` describe blocks** — Merge the 3 describe blocks into 1 (or 2) that share a single repo. The tests don't conflict with each other's data.

8. **Use `--no-commit` more aggressively** — Tests that only verify query results (not commit behavior) should use `--no-commit` to skip `dolt add -A` + `dolt commit`.

9. **Remove temp file pattern in `applyMigrations`** — `migrate.ts:392-412` writes `temp_migration.sql` then reads it back. Replace with `execa({ input: statement })` directly (already supported). Eliminates unnecessary file I/O.

## 6. Summary

The filesystem and data isolation is **correct** — each test file truly gets its own Dolt repo with no data leakage. The failures are caused by **OS-level resource exhaustion** from running ~23 test files concurrently, each spawning dozens of `dolt` processes (estimated 1,000+ total), compounded by a 237K-file `~/.dolt/eventsData/` directory that every process contends on. The `describe.serial` annotations provide intra-file serialization but do nothing against inter-file concurrency. Fix #1 (clean eventsData + DOLT_ROOT_PATH), Fix #2 (limit file concurrency), and Fix #3 (skip migrations for pre-migrated repos) would together eliminate the vast majority of flakiness.
