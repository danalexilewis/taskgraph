---
name: Integration Test Isolation Improvements
overview: Implement nine mitigation strategies to reduce OS-level resource exhaustion and flakiness in integration tests.
fileTree: |
  bunfig.toml                                  (modify)
  docs/testing.md                              (modify)
  scripts/
  └── run-integration-global-setup.ts          (modify)
  __tests__/
  └── integration/
      ├── global-setup.ts                      (modify)
      ├── test-utils.ts                        (modify)
      ├── plan-completion.test.ts              (modify)
      ├── status-live.test.ts                  (modify)
      └── *.test.ts                            (modify other tests to use --no-commit)
  src/
  ├── cli/
  │   └── index.ts                            (modify)
  └── db/
      ├── migrate.ts                          (modify)
      └── connection.ts                       (modify optional for batch SQL)
risks:
  - description: Batched SQL in ensureMigrations may miss migration checks
    severity: high
    mitigation: Write unit tests against a fresh repo to verify each migration runs.
  - description: TG_SKIP_MIGRATE flag could leak to production
    severity: high
    mitigation: Only set in test-utils; add warning log in CLI; document test-only usage.
  - description: Changing bunfig.toml to run integration tests sequentially may slow CI
    severity: medium
    mitigation: Measure suite duration; consider --concurrency 4 if too slow.
  - description: Cleaning ~/.dolt/eventsData/* could delete user data
    severity: medium
    mitigation: Limit cleanup to telemetry files; document manual safety check.
tests:
  - "Verify DOLT_ROOT_PATH isolation: new test run uses temp directory for eventsData and global config."
  - "Measure integration suite time before and after concurrency cap; target <90s."
  - "Ensure CLI prints warning when TG_SKIP_MIGRATE is set."
  - "Unit test for batched ensureMigrations: apply on an un-migrated repo and assert all tables/columns exist."
  - "Run plan-completion.test.ts and status-live.test.ts; assert pass rate unchanged."
todos:
  - id: isolation-clean-events
    content: "Clean Dolt telemetry and set DOLT_ROOT_PATH per test run"
    agent: implementer
    intent: |
      Modify `__tests__/integration/global-setup.ts` and `scripts/run-integration-global-setup.ts` to:
      1) Remove contents of `~/.dolt/eventsData/` before initialization.
      2) Set `DOLT_ROOT_PATH` environment variable to a new temp directory for test runs.
      Update `test-utils.ts` to propagate `DOLT_ROOT_PATH` to `runTgCli()` child processes.
    changeType: modify
  - id: isolation-cap-concurrency
    content: "Limit integration test file concurrency"
    agent: implementer
    intent: |
      Remove the `__tests__/integration/**` pattern from `bunfig.toml`'s `concurrentTestGlob` so integration files run sequentially, or invoke `bun test __tests__/integration --concurrency 4` in CI. Update `docs/testing.md` accordingly.
    changeType: modify
  - id: isolation-skip-migrate
    content: "Add TG_SKIP_MIGRATE flag to skip migrations in CLI preAction"
    agent: implementer
    intent: |
      In `test-utils.ts`, set `process.env.TG_SKIP_MIGRATE = '1'` when spawning CLI processes. In `src/cli/index.ts`’s preAction hook, wrap `ensureMigrations()` in:
      ```js
      if (!process.env.TG_SKIP_MIGRATE) {
        await ensureMigrations(...)
      }
      ```
    changeType: modify
  - id: isolation-log-skip-migrate
    content: "Log warning when migrations are skipped"
    agent: implementer
    blockedBy: [isolation-skip-migrate]
    intent: |
      In `src/cli/index.ts`, after detecting `TG_SKIP_MIGRATE`, add:
      ```js
      console.warn('[tg] Skipping migrations (TG_SKIP_MIGRATE set)');
      ```
      Document this warning in `docs/testing.md`.
    changeType: modify
  - id: isolation-batch-migrations
    content: "Batch migration checks into a single SQL query"
    agent: implementer
    blockedBy: [isolation-skip-migrate]
    intent: |
      In `src/db/migrate.ts`, consolidate the nine separate `doltSql` existence checks into one `doltSql` invocation that runs a single SQL script combining all checks via `UNION ALL`. Remove redundant calls.
    changeType: modify
  - id: isolation-cache-migrations
    content: "Add in-process cache for migration checks"
    agent: implementer
    blockedBy: [isolation-batch-migrations]
    intent: |
      In `migrate.ts`, introduce a module-level `Set<string>` to track repo paths already verified in this process. Before running checks, skip if path is in the set.
    changeType: modify
  - id: isolation-convert-plan-completion
    content: "Convert plan-completion tests to use beforeAll"
    agent: implementer
    blockedBy: [isolation-batch-migrations]
    intent: |
      In `__tests__/integration/plan-completion.test.ts`, change `beforeEach` to `beforeAll` and share the same test repo instance. Ensure test logic and isolation remain correct.
    changeType: modify
  - id: isolation-consolidate-status-live
    content: "Merge describe blocks in status-live tests"
    agent: implementer
    blockedBy: [isolation-batch-migrations]
    intent: |
      In `__tests__/integration/status-live.test.ts`, combine the three separate `describe` blocks into a single or two blocks that share the same setup and teardown logic.
    changeType: modify
  - id: isolation-no-commit-and-cleanup
    content: "Apply --no-commit flag to read-only tests & remove temp SQL file I/O"
    agent: implementer
    blockedBy: [isolation-batch-migrations]
    intent: |
      For tests that do not validate commit behavior, pass `--no-commit` to CLI calls in test-utils. In `src/db/migrate.ts`, replace writing `temp_migration.sql` files with piping SQL directly to `doltSql` via stdin.
    changeType: modify
isProject: false
---

## Analysis

These tasks implement the nine mitigations from the concurrency investigation report. They reduce I/O contention, cap parallelism, skip and cache migrations, batch SQL, and consolidate test setups. The harness improvements plan (5555005d) is already applied and overlaps only in setup scripts.

## Dependency Graph

Parallel start (2 unblocked):
├── isolation-clean-events (eventsData cleanup; set DOLT_ROOT_PATH)
└── isolation-cap-concurrency (concurrency limit)

After isolation-cap-concurrency and isolation-clean-events:
└── isolation-skip-migrate (TG_SKIP_MIGRATE flag)

After isolation-skip-migrate:
├── isolation-log-skip-migrate
└── isolation-batch-migrations

After isolation-batch-migrations:
├── isolation-cache-migrations
├── isolation-convert-plan-completion
├── isolation-consolidate-status-live
└── isolation-no-commit-and-cleanup

## Proposed Changes

- **eventsData cleanup**: In `global-setup.ts`, before running Dolt, execute `fs.rmSync(path.join(os.homedir(), '.dolt/eventsData'), { recursive: true, force: true })`.
- **set DOLT_ROOT_PATH**: In `run-integration-global-setup.ts`, set `process.env.DOLT_ROOT_PATH = tempDir + '/dolt-events'`.
- **concurrency limit**: Remove integration pattern from `bunfig.toml`; add `--concurrency 4` flag where needed.
- **skip migrations**: Wrap `ensureMigrations` in flag guard in `src/cli/index.ts`.
- **batch migrations**: Combine checks:

  ```sql
  SELECT COUNT(1) FROM dolt_tables WHERE table_name = '...'
  UNION ALL
  ...
  ```

  then run via one `dolt sql -q` call with `input`.

  ```js
  await execa("dolt", ["sql", "-q"], { cwd: repoPath, input: combinedSql });
  ```

- **cache migrations**: Add `const checked = new Set<string>()` at module top; after check for a path, add it.
- **test consolidations**: Update `plan-completion.test.ts` and `status-live.test.ts` as described.
- **--no-commit** and **temp SQL removal**: Pass `--no-commit` in `runTgCli` args; replace temp file writes in `applyMigrations` with `std{in: sql}`.

## Open Questions

- None; all architectural choices and thresholds (e.g. concurrency=4) decided here.

<original_prompt>
Create a project plan to implement the mitigation strategies from the risk assessment report at `reports/risk-assessment-2026-03-01.md`.
</original_prompt>
