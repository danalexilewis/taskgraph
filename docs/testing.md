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

## Unit Tests

Unit tests focus on individual functions and modules, particularly pure business logic that does not directly interact with the database or file system. These tests are fast and run in isolation, often with mocked dependencies.

**Configuration**: Tests run with Bun. All `.test.ts` files under `__tests__/` (excluding `__tests__/e2e/`, which is run via `pnpm test:e2e`) are discovered and run with `pnpm test`.

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

Integration tests live in `__tests__/integration/` and use a **golden template** (a pre-initialized Dolt repo with all migrations applied). Tests that call `setupIntegrationTest()` from `__tests__/integration/test-utils.ts` need either `TG_GOLDEN_TEMPLATE` set or the path file written by the global setup (`GOLDEN_TEMPLATE_PATH_FILE` in `os.tmpdir()`).

**Script order**: `pnpm test:integration` runs **global setup** (`scripts/run-integration-global-setup.ts` → `__tests__/integration/global-setup.ts`), then **`bun test __tests__/integration`**, then **global teardown** (`scripts/run-integration-global-teardown.ts`). Teardown removes the template and path file so the next run gets a fresh template.

**Concurrency**: Integration test files run sequentially by default (`concurrentTestGlob` in `bunfig.toml` excludes them). Concurrency limit for integration tests: use `--concurrency 4` in CI for faster runs (e.g. `bun test __tests__/integration --concurrency 4`). Isolation when using concurrency is safe thanks to per-file `DOLT_ROOT_PATH` and optional `TG_SKIP_MIGRATE`; each test uses its own Dolt root. If flakiness appears, keep the default sequential run.

**Gate**: `pnpm gate:full` runs setup before the full test suite and teardown after. When `pnpm gate` (or `scripts/cheap-gate.sh`) runs affected tests and the set includes `__tests__/integration`, setup runs before those tests and teardown after.

**Running in isolation**: To run integration tests on their own, use `pnpm test:integration`. To run a single integration file or ad-hoc commands, ensure the golden template is available: run `pnpm test:integration` once, or set `TG_GOLDEN_TEMPLATE` to an existing migrated Dolt repo path, or run `bun run scripts/run-integration-global-setup.ts` before the test command (and run teardown manually afterward if you want a clean slate for the next run).

**Relevant tests**: Plan-completion tests ([`__tests__/integration/plan-completion.test.ts`](__tests__/integration/plan-completion.test.ts)) and all other suites in `__tests__/integration/` that use `setupIntegrationTest()`.

### How to Run Integration Tests

```bash
pnpm test:integration
```

**Skipping migrations**: If the environment variable `TG_SKIP_MIGRATE` is set, the CLI will skip running migrations and print a warning `[tg] Skipping migrations (TG_SKIP_MIGRATE set)`. This can speed up tests when migrations are already applied.

**In-process CLI**: By default, integration tests invoke the CLI **in-process** (no `node` subprocess): `runTgCli()` in test-utils calls `createProgram()` from `src/cli/index.ts`, captures stdout/stderr via console intercept, and uses Commander's `exitOverride()` so errors throw instead of exiting. Set `TG_IN_PROCESS_CLI=0` to use the subprocess path (e.g. for debugging or E2E coverage). Tests that require true subprocess behavior (e.g. `cursor-import.test.ts`, `setup-scaffold.test.ts`) use `runTgCliSubprocess()`.

**Dolt sql-server mode**: When `TG_DOLT_SERVER_PORT` is set, the CLI routes all Dolt access (queries, commits, branch ops) through a **mysql2** connection pool to a running `dolt sql-server` instead of spawning the `dolt` CLI per operation. Global setup starts a server on the golden template; each test's `setupIntegrationTest()` starts a per-test server on a unique port and sets `TG_DOLT_SERVER_PORT`. Teardown closes the pool and kills the server process. This reduces process spawns and speeds up the suite.

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
