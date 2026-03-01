# Integration test benchmarks and harness report

**Date:** 2026-03-01  
**Scope:** Why integration tests are slow (~2.5–16s per test); benchmarks, harness, and infrastructure.

---

## 1. Benchmark summary

| Suite           | Command                                                                         | Result                                                         |
| --------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Unit**        | `bun test __tests__/db __tests__/domain __tests__/export __tests__/plan-import` | **~2.14s** for 137 tests (fast)                                |
| **Integration** | `bun test __tests__/integration`                                                | **Does not complete in &lt;180s**; many tests **2.5–16s each** |

So the 8000ms you’re seeing is almost certainly a **single integration test**, not the whole suite. Unit tests are already very fast.

---

## 2. Slowest integration tests (observed)

From a single interrupted run (golden template created manually; `bun test __tests__/integration`):

| Duration (ms) | Test / file                                                                      |
| ------------- | -------------------------------------------------------------------------------- |
| 16,407        | no-hard-deletes: tg cancel on done task fails                                    |
| 13,095        | no-hard-deletes: tg cancel &lt;taskId&gt; sets task status to canceled           |
| 10,580        | no-hard-deletes: tg status --all includes canceled/abandoned                     |
| 10,389        | no-hard-deletes: tg status excludes canceled/abandoned by default                |
| 9,930         | gates: create gate blocking task, verify blocked, resolve gate, verify unblocked |
| 9,620         | blocked-status-materialized: tg edge add blocks makes to_task status=blocked     |
| 9,574         | blocked-status-materialized: tg cancel on blocker unblocks dependent             |
| 8,249         | hash-id-resolve: resolves short hash_id in tg start and tg done                  |
| 7,850         | crossplan: crossplan edges without --dry-run writes edges to Dolt                |
| 7,252         | blocked-status-materialized: tg done on blocker moves dependent to todo          |

**Slowest files (by sum of test durations):**

1. **no-hard-deletes.test.ts** — multiple tests 6.5–16.4s (status, cancel, re-import).
2. **blocked-status-materialized.test.ts** — multiple tests ~7–9.6s.
3. **status-live.test.ts** — many tests ~2.5–2.8s.
4. **crossplan.test.ts** — several ~5–7.8s.
5. **hash-id-resolve.test.ts** — ~2.9–8.2s.
6. **gates.test.ts** — one long test ~9.9s.
7. **cursor-import.test.ts**, **template-apply.test.ts** — ~6s each.

---

## 3. Why integration tests are slow

### 3.1 Per-file setup: copy + migrate

- **`setupIntegrationTest()`** (in `beforeAll` of each integration file) does:
  - `fs.mkdtempSync(...)` + `fs.cpSync(templatePath, tempDir, { recursive: true })` — full copy of the golden template (includes `.taskgraph/dolt`).
  - `writeConfig(...)` and `ensureMigrations(doltRepoPath)`.
- So **every integration test file** pays for a full template copy and a migrate check. No shared temp dir across files (by design, for isolation).
- Golden template is created once per run (via `global-setup.ts`), but **Bun does not run Vitest-style globalSetup**. The `test:integration` script is just `bun test __tests__/integration` with no preload. So either:
  - The path file is created elsewhere (e.g. CI or a wrapper), or
  - You run the global-setup export once before `bun test __tests__/integration` so the golden template (and path file) exist.

### 3.2 CLI invocation = new Node process every time

- **`runTgCli(command, cwd)`** runs: `node ${cliPath} ${command}` via `execa(..., { shell: true })`.
- Each call is a **new Node process** (cold start + loading `dist/cli/index.js` + Dolt usage). Multiple `runTgCli` calls in one test (e.g. import, plan list, status, cancel) each add ~1–3s+.
- So a test with 3–5 CLI calls can easily reach **~6–15s** even without heavy Dolt work.

### 3.3 Dolt process overhead

- DB work goes through `doltSql(...)`, which spawns the **dolt** CLI. Each spawn has process startup and Dolt overhead. In-process DB would be faster, but the design correctly uses the real CLI for integration coverage.

### 3.4 Serial describe blocks

- Several integration files use **`describe.serial(...)`** so that tests in that file run sequentially and don’t clash on shared Dolt state (see `.cursor/memory.md`: “Serial: flaky under concurrency”).
- That doesn’t make a single test slower, but it means **within that file** tests can’t run in parallel, and the file’s total time is the sum of test times.

### 3.5 No single-process “warm” CLI

- There is no long-lived CLI process that tests send commands to (e.g. over stdin/socket). Every assertion that uses the real CLI pays full process cost.

---

## 4. State of the harness and infrastructure

| Aspect              | State                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Runner**          | Bun test (`bun test __tests__/integration`). Timeout in `bunfig.toml`: 30s per test.                                                                                                                      |
| **Golden template** | Built by `__tests__/integration/global-setup.ts` (dolt init + 8 migrations). Path written to `os.tmpdir()/tg-golden-template-path.txt` and/or `TG_GOLDEN_TEMPLATE`. Not run by Bun by default.            |
| **Per-file setup**  | `setupIntegrationTest()` in test-utils: mkdtemp, cp template, writeConfig, ensureMigrations. Same pattern across integration files.                                                                       |
| **CLI execution**   | `runTgCli` → `execa` with `node dist/cli/index.js` + command; new process per call.                                                                                                                       |
| **Concurrency**     | `bunfig.toml` has `concurrentTestGlob = ["**/__tests__/integration/**", "**/__tests__/e2e/**"]` so **files** run concurrently; inside a file, `describe.serial` makes tests sequential.                   |
| **Gate**            | `scripts/cheap-gate.sh` runs **affected** tests by default (`affected-tests.ts`); `--full` runs `bun test __tests__ --concurrent`. Integration tests only run when changes affect them (or on full gate). |

---

## 5. Recommendations (read-only; no edits)

1. **Confirm global setup for Bun**  
   Ensure the golden template (and path file) are created before `bun test __tests__/integration`, e.g. via a small script or `bun test --preload ./__tests__/integration/global-setup.ts` if Bun supports preload for one-time setup, or by running the default export of `global-setup.ts` once before the test command in `package.json` or CI.

2. **Reduce CLI invocations per test**  
   Where possible, combine assertions into fewer `runTgCli` calls or use direct `doltSql`/domain APIs for read-only checks so only the behavior under test uses the CLI.

3. **Reuse one temp dir per file**  
   Already done: one `beforeAll(setupIntegrationTest)` per describe. The cost is the copy + migrate; that’s the main per-file cost and is required for isolation.

4. **Consider a “warm” CLI mode for tests**  
   Optional: a long-running CLI process that accepts commands (e.g. over stdin) so tests can avoid repeated Node cold starts. Larger change; only worth it if you need to cut integration time significantly.

5. **Profile a single slow test**  
   Run one slow test in isolation (e.g. one `it` from `no-hard-deletes.test.ts`) with timers around `runTgCli` vs `doltSql` vs other work to confirm that CLI spawns dominate.

6. **Keep unit tests as the fast feedback path**  
   Unit suite is already &lt;3s; keep using it and affected-test selection so most changes don’t pay full integration cost.

---

## 6. Summary

- **Unit tests:** ~2.14s for 137 tests — already fast.
- **Integration tests:** Slow because (1) each test that uses the CLI spawns a new Node process per `runTgCli`, (2) each file does a full template copy + migrate in `beforeAll`, and (3) Dolt work is process-based. Single tests in the **2.5–16s** range are expected with the current harness.
- **8000ms** for “a test” is consistent with a single integration test that runs a few CLI commands and some Dolt operations.
- Harness is in good shape (golden template, isolated temp dirs, serial where needed); the main lever for speed without changing behavior is reducing per-test CLI invocations and/or adding a warm CLI mode for tests.
