---
triggers:
  files: ["__tests__/**"]
  change_types: ["create", "modify", "test"]
  keywords: ["test", "bun", "integration"]
---

# Testing Strategy

The Task Graph system employs a two-tiered testing strategy to ensure reliability and determinism: **Unit Tests** for isolated business logic and **End-to-End (E2E) Tests** for validating the entire CLI workflow against a real Dolt instance.

## Tools

- **Bun**: Used as the test runner for unit and integration tests; assertions use Bun's built-in `expect`.
- **Execa**: Utilized in E2E tests to execute the `tg` CLI commands as a child process.

## Test scripts

| Script | What it runs |
|--------|--------------|
| `pnpm test` | Build, then `bun test` on **unit-only** dirs: `__tests__/db`, `__tests__/domain`, `__tests__/export`, `__tests__/plan-import`. |
| `pnpm test:integration` | Build, integration global setup, `bun test __tests__/integration`, then global teardown. |
| `pnpm test:e2e` | Build, then `bun test __tests__/e2e`. |
| `pnpm test:all` | Build, then `bun test __tests__ --concurrent` (all test directories). |
| `pnpm test:coverage` | `bun test --coverage` — runs tests with coverage report (table + uncovered lines). |
| `pnpm gate` | Lint (full), typecheck (changed files only), then **affected tests** only (from `scripts/affected-tests.ts`). If the affected set includes `__tests__/integration`, runs integration setup before and teardown after. |
| `pnpm gate:full` | Lint + full typecheck (in parallel), integration setup, then **full test suite**: `__tests__/db/` and `__tests__/mcp/` in isolation (for mock boundaries), then `__tests__/cli/`, `domain/`, `e2e/`, `export/`, `integration/`, `plan-import/`, `skills/`; then integration teardown. |

### Why `pnpm test` is unit-only

The default `pnpm test` **excludes** `api`, `cli`, `integration`, `e2e`, `mcp`, `skills`, and any other test dirs so that:

- **Local runs stay fast** — no Dolt, no golden template, no subprocess CLI.
- **CI and pre-merge** use `gate` (affected) or `gate:full` (full suite) so heavier tests run only when needed (P3 and infra recommendations).

Use `pnpm test:integration` or `pnpm test:e2e` when working in those areas; use `pnpm test:all` for a full local run.

### Gate vs gate:full

- **`pnpm gate`** (or `scripts/cheap-gate.sh`): lint + typecheck on **changed** `src/**/*.ts`, then run only **affected tests** (based on changed files). No integration setup unless the affected set includes integration tests. Use during normal development for fast feedback.
- **`pnpm gate:full`** (or `scripts/cheap-gate.sh --full`): lint + **full** typecheck (entire codebase) and **full test suite** with integration setup/teardown. Use before release, in CI, or when validating the whole codebase. **gate:full does not run a build**; running it without a prior build will fail with a clear message from the build guard. **Requires a prior build:** the full suite runs the compiled CLI from `dist/`, which is gitignored; run `pnpm build` before gate:full. When running from a **task worktree**, run `pnpm build` in that worktree first so `dist/` exists there (worktrees do not share `dist/` with the main repo).

## Unit Tests

Unit tests focus on individual functions and modules, particularly pure business logic that does not directly interact with the database or file system. These tests are fast and run in isolation, often with mocked dependencies.

**Configuration**: Tests run with Bun. The `pnpm test` script runs only the unit-oriented directories (db, domain, export, plan-import). See [Test scripts](#test-scripts) for what each script runs.

**Location**: Unit test files are located in `__tests__/` mirroring the `src/` directory structure.

### Key Areas Covered by Unit Tests:

- **Domain Invariants** ([`__tests__/domain/invariants.test.ts`](__tests__/domain/invariants.test.ts))
  - `checkNoBlockerCycle`: Tests for cycle detection in task dependencies.
  - `checkValidTransition`: Verifies all valid and invalid task status transitions (25 combinations).
- **Domain Types** ([`__tests__/domain/types.test.ts`](__tests__/domain/types.test.ts))
  - Validation of all Zod schemas (`PlanSchema`, `TaskSchema`, `EdgeSchema`, `EventSchema`, `DecisionSchema`) with valid and invalid inputs.
- **Plan Import Parser** ([`__tests__/plan-import/parser.test.ts`](__tests__/plan-import/parser.test.ts))
  - Parsing well-formed markdown plans with tasks, features, areas, and acceptance criteria.
  - Handling edge cases like missing titles, empty files, or files without task blocks.
- **SQL Escaping Utility** ([`__tests__/db/escape.test.ts`](__tests__/db/escape.test.ts))
  - Ensuring proper escaping of single quotes in SQL strings.
- **Graph Export Generators** ([`__tests__/export/mermaid_dot.test.ts`](__tests__/export/mermaid_dot.test.ts))
  - Verification of Mermaid and Graphviz DOT string generation (with mocked database interactions).
- **Error Module** ([`__tests__/domain/errors.test.ts`](__tests__/domain/errors.test.ts))
  - Confirmation that `AppError` objects are constructed correctly with `ErrorCode` and messages.

### How to Run Unit Tests

```bash
pnpm test
```

## Integration Tests

Integration tests live in `__tests__/integration/` and use a **golden template** (a pre-initialized Dolt repo with all migrations applied) at a fixed path: **`.taskgraph/tg-golden-template`**. Global setup generates it; no env var or path file. If missing, the first `setupIntegrationTest()` creates it on demand. Run a single integration file (e.g. `bun test __tests__/integration/some.test.ts`) and the template is created when needed.

**Script order**: `pnpm test:integration` runs **global setup** (`scripts/run-integration-global-setup.ts` → `__tests__/integration/global-setup.ts`), then **`bun test __tests__/integration`**, then **global teardown** (`scripts/run-integration-global-teardown.ts`). Teardown removes the template and path file so the next run gets a fresh template.

**Concurrency**: Integration test files run sequentially by default (`concurrentTestGlob` in `bunfig.toml` excludes them). Concurrency limit for integration tests: use `--concurrency 4` in CI for faster runs (e.g. `bun test __tests__/integration --concurrency 4`). Isolation when using concurrency is safe thanks to per-file `DOLT_ROOT_PATH` and optional `TG_SKIP_MIGRATE`; each test uses its own Dolt root. If flakiness appears, keep the default sequential run.

**Gate**: `pnpm gate:full` runs setup before the full test suite and teardown after. When `pnpm gate` (or `scripts/cheap-gate.sh`) runs affected tests and the set includes `__tests__/integration`, setup runs before those tests and teardown after. Integration tests that use `describe.serial` (Bun API) must be run with Bun.

**Running in isolation**: Run `pnpm test:integration` for the full script (setup → tests → teardown). To run a single file (e.g. `bun test __tests__/integration/foo.test.ts`), no prior setup is required — the first test that uses `setupIntegrationTest()` will create the golden template at `.taskgraph/tg-golden-template` if missing. Run `bun run scripts/run-integration-global-setup.ts` manually if you want to pre-generate it; teardown removes it for a clean slate.

**Relevant tests**: Plan-completion tests ([`__tests__/integration/plan-completion.test.ts`](__tests__/integration/plan-completion.test.ts)) and all other suites in `__tests__/integration/` that use `setupIntegrationTest()`.

### How to Run Integration Tests

```bash
pnpm test:integration
```

**Process exit and piped output**: Do not use `process.exit(0)` on the CLI success path when stdout may be piped (e.g. `tg status --json`). Exiting immediately can truncate output before it is flushed. Use `process.exitCode = 0` and allow the process to exit naturally so stdout can drain. See `src/cli/index.ts` and the status-json integration tests.

**Skipping migrations**: If the environment variable `TG_SKIP_MIGRATE` is set, the CLI will skip running migrations and print a warning `[tg] Skipping migrations (TG_SKIP_MIGRATE set)`. This can speed up tests when migrations are already applied. **Test-only** — set only in test harnesses (e.g. `runTgCli` in test-utils); do not set in production or CI scripts, or migrations will not run.

**--no-commit for read-only tests**: Integration tests that only read from Dolt (e.g. `status`, `plan list`, `next`, `show`, `export`) should not create commits. The harness injects `--no-commit` when the command does not already include it: `runTgCli()` and `runTgCliSubprocess()` in `__tests__/integration/test-utils.ts` append `--no-commit` to the argv (in-process) or to the command string (subprocess) so read-only tests run without writing Dolt history. Tests that explicitly validate commit behavior should pass `--no-commit` only when testing the no-commit code path.

**Read-only commands and migrations**: For top-level commands that only read from the task graph (e.g. `status`, `next`, `show`, `export`, `dashboard`), the preAction migration check uses `noCommit: true` so no Dolt commits are created when probing schema. Migrations run SQL via `doltSql()` in `src/db/connection.ts` (argv or server); there is no temp SQL file I/O for running migrations.

**In-process CLI**: By default, integration tests invoke the CLI **in-process** (no `node` subprocess): `runTgCli()` in test-utils calls `createProgram()` from `src/cli/index.ts`, captures stdout/stderr via console intercept, and uses Commander's `exitOverride()` so errors throw instead of exiting. Set `TG_IN_PROCESS_CLI=0` to use the subprocess path (e.g. for debugging or E2E coverage). Tests that require true subprocess behavior (e.g. `cursor-import.test.ts`, `setup-scaffold.test.ts`) use `runTgCliSubprocess()`.

**Dolt sql-server mode**: When `TG_DOLT_SERVER_PORT` is set, the CLI routes all Dolt access (queries, commits, branch ops) through a **mysql2** connection pool to a running `dolt sql-server` instead of spawning the `dolt` CLI per operation. Global setup starts a server on the golden template; each test's `setupIntegrationTest()` starts a per-test server on a unique port and sets `TG_DOLT_SERVER_PORT`. Teardown closes the pool and kills the server process. This reduces process spawns and speeds up the suite.

**Golden server port**: The port for the golden template's `dolt sql-server` defaults to `13307`. Set **`TG_GOLDEN_SERVER_PORT`** (optional) to use a different port (e.g. to avoid conflicts or run multiple suites). Global setup reads this when starting the server and writing `DOLT_SERVER_PORT_FILE`.

**Debugging a single test**: Run `TG_IN_PROCESS_CLI=0 bun test __tests__/integration/<file>` to use the subprocess CLI and isolate from in-process state.

## End-to-End (E2E) Tests

E2E tests simulate real-world usage of the `tg` CLI, executing commands against a live Dolt database. They verify the integration of all components, from CLI parsing to database interactions and output formatting.

**Location**: E2E test files are located in `__tests__/e2e/`.

**Setup/Teardown**: Each E2E test suite sets up a temporary directory, initializes a Dolt repository within it using `tg init`, and then cleans up the directory after all tests are run.

### Key Scenarios Covered by E2E Tests:

- **Core Flow** ([`__tests__/e2e/core-flow.test.ts`](__tests__/e2e/core-flow.test.ts))
  - Initialization (`tg init`)
  - Plan creation (`tg plan new`)
  - Task creation (`tg task new`)
  - Edge addition (`tg edge add`)
  - Runnable task selection (`tg next`)
  - Task detail display (`tg show`)
  - Task start and completion (`tg start`, `tg done`)
  - Graph export (`tg export mermaid`)
- **Error Scenarios**
  - Attempting to start a blocked task.
  - Attempting to create a blocking cycle.
  - Running commands before initialization (`tg init`).
  - Non-existent task IDs for `show`, `start`, `done`, `block`.
- **Block/Split Scenarios**
  - Blocking a task on a newly created task.
  - Splitting a task into multiple subtasks and verifying task creation and edge wiring.

### How to Run E2E Tests

```bash
pnpm test:e2e
```

## Typecheck and OpenTUI

OpenTUI is **Bun-only** and must stay out of type scope for the Node-based gate. Our tsconfig keeps it isolated: `include: ["src/**/*.ts"]`, `exclude: ["node_modules"]`, `types: ["node"]`. See [Research: Cheap-Gate Typecheck/Lint Failures](research/cheap-gate-typecheck-lint-failures.md) for the full rationale.

## Test patterns / gotchas

- **Config cache**: `readConfig()` uses a process-scoped cache (path + mtime) so preAction and command handlers avoid double reads. `writeConfig()` invalidates the cache for that path. Tests that mutate config on disk without using `writeConfig()` (e.g. raw `writeFileSync`) or that rely on fresh reads after changing cwd should call `clearConfigCache()` from `src/cli/utils` so the next `readConfig()` sees current state.
- **cachedQuery cache keys**: Tests that assert `cache.get(key)` must use the full key shape. For `select(table, options)` the key is `select:${table}:${where}:${orderBy}:${limit}:${offset}:${groupBy}:${having}:${columns}`; with no options that is `select:${table}:{}::::[]::[]`. Using a shortened key (e.g. `select:project:{}`) will miss and the assertion will see `undefined`.
- **Integration tests and shared state**: When tests in the same file share seeded DB state and a later test depends on that state (e.g. "task has 1 unmet blocker"), ensure an earlier test has not mutated it. If a prior test changes the state (e.g. marks the blocker task `done`), reset the state at the start of the dependent test (e.g. `UPDATE task SET status = 'todo' WHERE ...`) so the assertion sees the expected data.

## Environment / gotchas

- **`.env.local` for integration tests**: Leave `DOLT_ROOT_PATH` empty unless you need to override the test Dolt root. The golden template path is fixed (`.taskgraph/tg-golden-template`); no env var. See `.env.local.example`.

## Related projects

- Fix Failing Unit Tests
- Fix Failing Tests Properly
- Integration Test Performance and Harness Improvements
- Concurrent Tests Maximize
- Migrate to Bun Test, Add Biome, Targeted Test Execution
