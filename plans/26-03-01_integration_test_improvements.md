---
name: Integration Test Performance and Harness Improvements
overview: Improve integration test reliability and reduce per-test cost by ensuring global-setup (and teardown) runs for gate:full and when affected tests include integration, reducing redundant CLI spawns in slow tests, and updating docs.
fileTree: |
  scripts/
  ├── cheap-gate.sh                         (modify)
  ├── run-integration-global-setup.ts       (existing)
  └── run-integration-global-teardown.ts    (create)
  __tests__/
  └── integration/
      ├── test-utils.ts                (reference)
      ├── no-hard-deletes.test.ts      (modify – pilot)
      └── blocked-status-materialized.test.ts  (optional modify)
  docs/
  └── testing.md                      (modify)
  reports/
  └── integration-test-benchmarks-2026-03-01.md  (reference)
risks:
  - description: gate:full runs global-setup in same shell; if setup fails, gate fails fast (intended).
    severity: low
    mitigation: run-integration-global-setup.ts already exists and is used by test:integration; reuse it.
  - description: Teardown removes the template and path file; next run in same session will recreate template (intended).
    severity: low
    mitigation: Document in testing.md; setup is fast (dolt init + migrations once per run).
  - description: Replacing runTgCli with doltSql for assertions could miss CLI output bugs.
    severity: medium
    mitigation: Only replace calls that are purely "read state to assert"; keep runTgCli for any test that validates CLI stdout/behavior. Pilot in one file and document the pattern.
tests:
  - "gate:full runs integration tests with golden template (setup before, teardown after)"
  - "gate (affected) runs setup before tests when AFFECTED contains __tests__/integration"
  - "Template and path file are removed after integration test runs (teardown); no leaked temp dirs"
  - "Pilot integration file tests still pass; fewer runTgCli calls for read-only state checks"
  - "docs/testing.md describes Bun, integration tests, golden template, setup/teardown, and when they run"
todos:
  - id: gate-full-global-setup
    content: Run integration global-setup and teardown for gate (full and affected) and test:integration
    agent: implementer
    intent: |
      (1) Full gate: When cheap-gate.sh is run with --full, run global-setup before `bun test __tests__ --concurrent`, then after the test run run global-teardown so the golden template and path file are removed (no leaked temp dirs). (2) Affected gate: When not --full, AFFECTED may contain __tests__/integration (e.g. when an integration test file is changed). If AFFECTED contains __tests__/integration, run global-setup before `bun test $AFFECTED`, then run global-teardown after the test run. (3) Create scripts/run-integration-global-teardown.ts that imports and runs the default export from __tests__/integration/global-teardown.ts (same pattern as run-integration-global-setup.ts). (4) Wire test:integration in package.json to run teardown after `bun test __tests__/integration` so the template is cleaned up; preserve the test exit code (e.g. run tests, save exit code, run teardown, exit with saved code). Detecting "AFFECTED contains integration": e.g. echo "$AFFECTED" | grep -q "__tests__/integration" in bash.
    suggestedChanges: |
      cheap-gate.sh: For FULL branch: echo "=== [SETUP] integration golden template ==="; bun run scripts/run-integration-global-setup.ts; bun test __tests__ --concurrent; EXIT=$?; bun run scripts/run-integration-global-teardown.ts; exit $EXIT. For affected branch: AFFECTED=$(...); if echo "$AFFECTED" | grep -q "__tests__/integration"; then run setup; fi; run bun test (with xargs); if we ran setup, run teardown; exit with test exit code. run-integration-global-teardown.ts: import globalTeardown from "../__tests__/integration/global-teardown"; globalTeardown().then(() => process.exit(0)).catch(...). package.json test:integration: run setup, then (bun test ...; r=$?; bun run scripts/run-integration-global-teardown.ts; exit $r).
    changeType: modify
  - id: reduce-runtgcli-pilot
    content: Reduce redundant runTgCli in one slow integration file (pilot)
    agent: implementer
    intent: |
      Per reports/integration-test-benchmarks-2026-03-01.md, each runTgCli() spawns a new Node process; tests that need only to assert DB/state can use doltSql (or domain APIs) instead for those assertions, keeping runTgCli only for the CLI behavior under test. Pick one slow file as pilot (e.g. __tests__/integration/no-hard-deletes.test.ts or blocked-status-materialized.test.ts). In that file, identify tests where the only use of runTgCli is to fetch state for an assertion (e.g. plan list --json or status --json just to get IDs/status). Replace those with doltSql SELECTs or equivalent so the test still passes but with fewer CLI spawns. Do not replace runTgCli when the test is validating CLI output or exit codes. Add a short note in docs/skills/integration-testing.md: "For read-only state assertions, prefer doltSql or domain APIs to avoid extra CLI process spawns; use runTgCli for the CLI behavior under test."
    suggestedChanges: |
      Example: if a test does runTgCli(`plan list --json`) only to parse plan_id for a later doltSql, that call can be replaced by doltSql(`SELECT plan_id FROM plan WHERE ...`) if the test is not asserting CLI formatting. Same for status --json when only task status is needed.
    changeType: modify
  - id: docs-integration-tests
    content: Update docs/testing.md for Bun, gate:full, and integration setup
    agent: implementer
    blockedBy: [gate-full-global-setup]
    intent: |
      Ensure docs/testing.md accurately describes (1) Bun as the test runner (not Vitest), (2) integration tests and golden template: pnpm test:integration runs global-setup, bun test, then global-teardown; pnpm gate:full runs setup before the full suite and teardown after; when gate runs affected tests and the set includes __tests__/integration, setup runs before and teardown after, (3) how to run integration tests in isolation (pnpm test:integration, or set TG_GOLDEN_TEMPLATE and run setup/teardown manually), (4) that teardown removes the template and path file so the next run gets a fresh template. Fix any remaining Vitest-centric wording in the Tools or Unit sections to match current Bun usage. Domain testing; skill documentation-sync.
    changeType: modify
  - id: run-full-suite-integration-plan
    content: Run gate:full and record result as evidence
    agent: implementer
    blockedBy:
      [gate-full-global-setup, reduce-runtgcli-pilot, docs-integration-tests]
    intent: |
      Run pnpm gate:full (or bash scripts/cheap-gate.sh --full). Record outcome in task evidence: "gate:full passed" or "gate:full failed: <summary>". If it fails, add tg note with the failure reason so follow-up tasks can be created.
    changeType: test
isProject: false
---

## Analysis

The benchmarks report (reports/integration-test-benchmarks-2026-03-01.md) showed that integration tests are slow (2.5–16s per test) mainly because each `runTgCli()` spawns a new Node process and because the golden template must exist before any integration test runs. Unit tests are already fast (~2.14s for 137 tests).

**Current state:** `pnpm test:integration` already runs `scripts/run-integration-global-setup.ts` then `bun test __tests__/integration`, so the golden template is created for that script. However, `pnpm gate:full` runs `bun test __tests__` directly without global-setup; in a clean environment or when only gate:full is run, integration tests can fail with "golden template path file not found". Closing that gap is the first improvement.

**Second lever:** Reduce redundant CLI spawns in the slowest integration files. Many tests use `runTgCli` for both (a) the CLI behavior under test and (b) read-only state fetches (e.g. plan list --json to get plan_id). Replacing (b) with `doltSql` or domain APIs keeps coverage of (a) while cutting per-test time. Pilot in one file and document the pattern so future tests follow it.

**Out of scope for this plan:** Warm CLI mode (long-lived process) is deferred; profile-one-test is optional and can be done ad hoc or in a follow-up.

## Dependency graph

```
Parallel start (2 unblocked):
  ├── gate-full-global-setup   (cheap-gate: setup/teardown for full and affected-integration; teardown script; test:integration)
  └── reduce-runtgcli-pilot   (one integration file uses doltSql for read-only assertions)

After gate-full-global-setup:
  └── docs-integration-tests  (testing.md: Bun, gate:full, setup/teardown, affected integration)

After docs-integration-tests and reduce-runtgcli-pilot:
  └── run-full-suite-integration-plan  (gate:full; record evidence)
```

## Proposed changes

- **cheap-gate.sh**: When `FULL=1`, run setup, then `bun test __tests__ --concurrent`, then teardown (preserve test exit code). When not full, if AFFECTED contains `__tests__/integration` (e.g. `echo "$AFFECTED" | grep -q "__tests__/integration"`), run setup, then `bun test $AFFECTED`, then teardown. Ensures CI and local gate work when only integration tests are affected.
- **scripts/run-integration-global-teardown.ts**: New script that invokes the default export from `__tests__/integration/global-teardown.ts`; removes template dir and path file so temp dirs do not accumulate.
- **package.json test:integration**: After `bun test __tests__/integration`, run teardown; preserve test exit code so failures still fail the script.
- **Pilot file**: In no-hard-deletes.test.ts (or blocked-status-materialized.test.ts), replace only those `runTgCli` calls that are used solely to read state for assertions (e.g. plan list --json to get plan_id, status --json to check status) with `doltSql` SELECTs. Keep every `runTgCli` that is testing CLI output or exit behavior.
- **docs/testing.md**: Replace Vitest references with Bun where still present; document that gate:full and gate (when affected includes integration) run setup before and teardown after; document test:integration runs setup then test then teardown; keep "How to Run Integration Tests" and note that teardown removes the template so the next run gets a fresh one.

## Open questions

- None; analyst recommended deferring warm CLI and optional profile task.

<original_prompt>
/plan improvements based on these findings [from reports/integration-test-benchmarks-2026-03-01.md]
</original_prompt>
