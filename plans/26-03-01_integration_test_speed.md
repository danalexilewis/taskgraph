---
name: Integration Test Speed - Process Elimination
overview: Reduce integration test suite from 295s to under 40s by re-enabling parallelism, eliminating 132 Node process spawns via in-process CLI, and eliminating per-query Dolt spawns via sql-server mode.
fileTree: |
  bunfig.toml                                  (modify)
  package.json                                 (modify - add mysql2)
  src/
  ├── cli/
  │   └── index.ts                            (modify - createProgram, exitOverride)
  └── db/
      ├── connection.ts                       (modify - add doltSqlServer routing)
      ├── commit.ts                           (modify - add server-mode commit)
      └── branch.ts                           (modify - add server-mode branch ops)
  __tests__/
  └── integration/
      ├── global-setup.ts                     (modify - start sql-server)
      ├── global-teardown.ts                  (modify - kill sql-server)
      └── test-utils.ts                       (modify - runTgCliInProcess, server config)
  docs/
  └── testing.md                              (modify)
risks:
  - description: In-process CLI calls may leak CWD or env state between tests
    severity: high
    mitigation: Always chdir + try/finally restore. Fresh createProgram() per call. No singletons.
  - description: process.exit(1) in CLI handlers kills the test runner when called in-process
    severity: high
    mitigation: Use Commander exitOverride() so errors throw instead of exiting. Catch in test harness.
  - description: Dolt sql-server port conflicts under parallel test files
    severity: medium
    mitigation: Allocate unique port per test file (base port + file index). Kill on teardown.
  - description: mysql2 result shape differs from dolt CLI JSON output
    severity: medium
    mitigation: Normalize in doltSqlServer() to return same rows array shape. Unit test the mapping.
  - description: Re-enabling parallelism may resurface flakiness
    severity: medium
    mitigation: Start at concurrency 3. TG_SKIP_MIGRATE and DOLT_ROOT_PATH already in place. Measure before increasing.
tests:
  - "Verify all 86 integration tests pass with concurrency 3 (task: speed-parallelism)"
  - "Verify runTgCliInProcess returns same stdout/stderr/exitCode as runTgCli for a representative command (task: speed-in-process-cli)"
  - "Verify doltSqlServer returns same rows as doltSql for a SELECT query (task: speed-server-mode)"
  - "Verify global-teardown kills all dolt sql-server processes (task: speed-server-setup)"
  - "Full integration suite passes and completes in under 60s (task: speed-verify-final)"
todos:
  - id: speed-parallelism
    content: "Re-enable controlled parallelism for integration tests"
    agent: implementer
    intent: |
      Add `**/__tests__/integration/**` back to `concurrentTestGlob` in `bunfig.toml`.
      Run `pnpm test:integration` and verify all 86 tests pass.
      If flakiness appears, reduce to `--concurrency 3` in the test:integration script.
      Update docs/testing.md to document the concurrency setting and DOLT_ROOT_PATH isolation that makes it safe.
    changeType: modify
  - id: speed-create-program
    content: "Refactor CLI to export createProgram() with exitOverride support"
    agent: implementer
    intent: |
      In `src/cli/index.ts`:
      1. Extract all Commander program construction into `export function createProgram(): Command`.
      2. Guard the `program.parse(process.argv)` call so it only runs when the file is the main entrypoint (e.g. `if (require.main === module)` or `if (!process.env.TG_IN_PROCESS)`).
      3. The preAction hook (ensureMigrations) stays inside createProgram().
      4. Do NOT change any command handler logic. Only restructure the program creation.
      5. Verify `pnpm build && pnpm tg status` still works (CLI entrypoint not broken).
      6. Verify `pnpm test:integration` still passes (existing subprocess path unaffected).
    suggestedChanges: |
      export function createProgram(): Command {
        const program = new Command();
        // ... all existing setup, commands, hooks ...
        return program;
      }
      // Only parse when run directly
      if (process.argv[1]?.endsWith('cli/index.js') || process.argv[1]?.endsWith('cli/index.ts')) {
        createProgram().parse(process.argv);
      }
    changeType: modify
  - id: speed-in-process-cli
    content: "Implement runTgCliInProcess in test-utils and migrate tests"
    agent: implementer
    blockedBy: [speed-create-program]
    intent: |
      In `__tests__/integration/test-utils.ts`:
      1. Add `runTgCliInProcess(command, cwd, expectError?)` that:
         - Saves process.cwd(), calls process.chdir(cwd)
         - Sets process.env.TG_SKIP_MIGRATE = '1' and process.env.DOLT_ROOT_PATH
         - Intercepts console.log/console.error to capture stdout/stderr
         - Creates a fresh program via createProgram()
         - Calls program.exitOverride() then program.parseAsync(['node', 'tg', ...args])
         - Catches CommanderError for expected failures
         - Restores CWD and console in a finally block
         - Returns { stdout, stderr, exitCode }
      2. Replace the default `runTgCli` implementation to use `runTgCliInProcess` when `process.env.TG_IN_PROCESS_CLI !== '0'` (opt-out, default on).
      3. Keep the existing subprocess `runTgCli` available as `runTgCliSubprocess` for the few tests that need true E2E coverage (cursor-import.test.ts, setup-scaffold.test.ts).
      4. Fix the --no-commit bug: the computed finalCommand is never used in the execa call. Use it.
      5. Run all integration tests. Fix any failures caused by the switch (likely: stdout format differences, exit code handling).
    changeType: modify
  - id: speed-server-mode
    content: "Add Dolt sql-server mode to connection, commit, and branch layers"
    agent: implementer
    intent: |
      1. Add `mysql2` as a dependency: `pnpm add mysql2`.
      2. In `src/db/connection.ts`, add `doltSqlServer(query, pool): ResultAsync<any[], AppError>` that:
         - Runs the protected-tables check (same as doltSql)
         - Executes query via mysql2 pool.execute()
         - Normalizes result rows to match doltSql output shape (array of row objects)
         - Returns ResultAsync
      3. Modify `doltSql()` to check `process.env.TG_DOLT_SERVER_PORT`. If set, route to doltSqlServer using a lazily-created mysql2 pool. Otherwise use the existing execa path.
      4. In `src/db/commit.ts`, add server-mode path: use `CALL dolt_add('-A')` and `CALL dolt_commit('-m', msg, '--allow-empty')` via the pool when server mode is active.
      5. In `src/db/branch.ts`, add server-mode paths for checkoutBranch (`CALL dolt_checkout`), createBranch (`CALL dolt_branch`), mergeBranch (`CALL dolt_merge`), deleteBranch (`CALL dolt_branch('-D', name)`).
      6. The pool should be created once per (host, port) combination and cached module-level.
      7. Do NOT change any caller code. The routing is transparent via env var.
    suggestedChanges: |
      // connection.ts pool cache
      const pools = new Map<string, mysql.Pool>();
      function getPool(port: number): mysql.Pool {
        const key = `localhost:${port}`;
        if (!pools.has(key)) {
          pools.set(key, mysql.createPool({ host: '127.0.0.1', port, user: 'root', database: 'dolt' }));
        }
        return pools.get(key)!;
      }
    changeType: modify
  - id: speed-server-setup
    content: "Start and stop Dolt sql-server in global setup and teardown"
    agent: implementer
    blockedBy: [speed-server-mode]
    intent: |
      In `__tests__/integration/global-setup.ts`:
      1. After creating the golden template, start `dolt sql-server` on the golden template's dolt repo path on a fixed port (e.g. 13307).
      2. Write the port to a file (e.g. DOLT_SERVER_PORT_FILE alongside existing path files).
      3. Set process.env.TG_DOLT_SERVER_PORT = port.
      4. Wait for the server to be ready (poll with a TCP connect or a simple mysql2 query).

      In `__tests__/integration/test-utils.ts`:
      1. In setupIntegrationTest, after copying the template, start a dolt sql-server for the test's unique doltRepoPath on a unique port (base port + incrementing counter).
      2. Set process.env.TG_DOLT_SERVER_PORT to the test's port so doltSql routes through the server.
      3. In teardownIntegrationTest, kill the per-test dolt sql-server process and close the mysql2 pool.

      In `__tests__/integration/global-teardown.ts`:
      1. Kill any remaining dolt sql-server processes by PID or pkill.
      2. Close global mysql2 pools if any.
    changeType: modify
  - id: speed-verify-final
    content: "Run full integration suite and record timing"
    agent: implementer
    blockedBy: [speed-parallelism, speed-in-process-cli, speed-server-setup]
    intent: |
      Run `pnpm build && pnpm test:integration` and record:
      - Total wall-clock time
      - Number of tests passed/failed
      - Any flakiness (run 3 times if first run passes)
      Target: all 86 tests pass, total time under 60s.
      Record evidence in tg done. If failures occur, add tg note with details.
    changeType: test
  - id: speed-update-docs
    content: "Update testing docs for in-process CLI and server mode"
    agent: implementer
    blockedBy: [speed-in-process-cli, speed-server-setup]
    intent: |
      Update `docs/testing.md` to document:
      1. In-process CLI mode: tests call CLI handlers directly; opt-out with TG_IN_PROCESS_CLI=0.
      2. Dolt sql-server mode: tests use mysql2 pool; TG_DOLT_SERVER_PORT routes queries.
      3. Controlled parallelism: integration tests run concurrently with DOLT_ROOT_PATH isolation.
      4. How to debug a single test (can use subprocess mode for isolation).
    changeType: modify
isProject: false
---

## Analysis

The research report (`reports/integration-test-speed-research-2026-03-01.md`) identified that 295s of integration test time is dominated by process spawning: 132 `runTgCli` calls each spawn a full Node process (~1-3s each), and each of those spawns 1-15 Dolt CLI processes internally. The three highest-impact improvements are:

1. **Controlled parallelism** (low effort, ~4x wall-clock reduction) — re-enable `concurrentTestGlob` now that `DOLT_ROOT_PATH` and `TG_SKIP_MIGRATE` are in place.

2. **In-process CLI** (medium effort, eliminates 132 Node cold starts) — export `createProgram()` from `src/cli/index.ts`, call it directly from test-utils instead of spawning `node`. Requires `exitOverride()` to prevent `process.exit()` from killing the test runner, and CWD management via `chdir`.

3. **Dolt sql-server mode** (medium effort, eliminates per-query Dolt spawns) — start `dolt sql-server` per test repo, use `mysql2` pool. Transparent routing via env var in `connection.ts`. Dolt stored procedures (`CALL dolt_add`, `CALL dolt_commit`, `CALL dolt_checkout`) replace `execa` in `commit.ts` and `branch.ts`.

**Rejected alternatives:**

- Warm CLI (Option 2 in research): superseded by in-process calls which are simpler.
- State recycling (Option 4): deferred; benefits are marginal vs the three main improvements and adds complexity around test isolation.

**Bug found by analyst:** `runTgCli` computes a `finalCommand` with `--no-commit` appended but never uses it in the `execa` call. Fixed in the in-process CLI task.

## Dependency graph

```
Parallel start (2 unblocked):
  ├── speed-parallelism          (re-enable concurrentTestGlob)
  └── speed-create-program       (export createProgram() from CLI)

After speed-create-program:
  └── speed-in-process-cli       (runTgCliInProcess in test-utils)

Independent (can start in parallel with speed-create-program):
  └── speed-server-mode          (mysql2 + doltSqlServer in connection/commit/branch)

After speed-server-mode:
  └── speed-server-setup         (global-setup/teardown + per-test server lifecycle)

After speed-in-process-cli + speed-server-setup:
  ├── speed-update-docs          (testing.md)
  └── speed-verify-final         (run suite, record timing)
```

## Proposed changes

### `src/cli/index.ts` — createProgram extraction

```ts
export function createProgram(): Command {
  const program = new Command();
  program.name("tg").version("...").description("...");
  // all .command() registrations
  // preAction hook with ensureMigrations
  return program;
}

// Main entrypoint guard
const isMain =
  process.argv[1]?.endsWith("cli/index.js") ||
  process.argv[1]?.endsWith("cli/index.ts");
if (isMain) {
  createProgram().parse(process.argv);
}
```

### `__tests__/integration/test-utils.ts` — runTgCliInProcess

```ts
import { createProgram } from "../../src/cli/index";

export async function runTgCliInProcess(
  command: string,
  cwd: string,
  expectError = false,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const origCwd = process.cwd();
  const logs: string[] = [];
  const errs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errs.push(args.join(" "));

  try {
    process.chdir(cwd);
    const program = createProgram();
    program.exitOverride();
    await program.parseAsync(["node", "tg", ...command.split(/\s+/)]);
    return { stdout: logs.join("\n"), stderr: errs.join("\n"), exitCode: 0 };
  } catch (e: any) {
    const code = e.exitCode ?? 1;
    if (!expectError) throw e;
    return { stdout: logs.join("\n"), stderr: errs.join("\n"), exitCode: code };
  } finally {
    console.log = origLog;
    console.error = origErr;
    process.chdir(origCwd);
  }
}
```

### `src/db/connection.ts` — server-mode routing

```ts
import mysql from "mysql2/promise";

const pools = new Map<string, mysql.Pool>();

function getPool(port: number): mysql.Pool {
  const key = `127.0.0.1:${port}`;
  if (!pools.has(key)) {
    pools.set(
      key,
      mysql.createPool({
        host: "127.0.0.1",
        port,
        user: "root",
        waitForConnections: true,
        connectionLimit: 5,
      }),
    );
  }
  return pools.get(key)!;
}

export function doltSql(query, repoPath, options?) {
  const serverPort = process.env.TG_DOLT_SERVER_PORT;
  if (serverPort) return doltSqlServer(query, parseInt(serverPort));
  // ... existing execa path
}
```

## Open questions

None. All architectural decisions resolved in the plan.

<original_prompt>
Speed up integration tests from 295s to under 40s. Research findings at reports/integration-test-speed-research-2026-03-01.md.
</original_prompt>
