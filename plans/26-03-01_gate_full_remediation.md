---
name: Gate Full Remediation
overview: Fix gate:full failures by correcting integration test server DB name when TG_DOLT_SERVER_PORT is set and by fixing unit test or code alignment for invariants, query builder, and doc-skill-registry; then run gate:full.
fileTree: |
  __tests__/
  ├── integration/
  │   ├── test-utils.ts        (modify)
  │   └── global-setup.ts      (modify)
  ├── domain/
  │   ├── invariants.test.ts   (modify if tests wrong)
  │   └── doc-skill-registry.test.ts (modify if tests wrong)
  └── db/
  └── query.test.ts            (modify if tests wrong)
  src/
  └── domain/
  └── invariants.ts            (modify if code wrong)
risks:
  - description: Changing TG_DOLT_SERVER_DATABASE in harness could affect any consumer that relies on current derivation
    severity: low
    mitigation: Use a fixed constant only in test harness; production keeps explicit env; connection.ts already defaults to "" when unset
  - description: Unit test fixes might change behavior if we fix "wrong" tests
    severity: medium
    mitigation: Run tests first; fix only what is clearly wrong (e.g. Zod enum vs string, mock signature); prefer fixing code to match intended behavior when tests encode the spec
tests:
  - "Integration tests pass when TG_DOLT_SERVER_PORT is set (harness sets stable DB name)"
  - "Unit tests: invariants checkValidTransition and checkNoBlockerCycle pass"
  - "Unit tests: query builder and doc-skill-registry pass"
  - "gate:full passes (lint, typecheck, full test suite)"
todos:
  - id: integration-server-db-name
    content: "Use stable DB name 'dolt' in integration test harness when TG_DOLT_SERVER_PORT is set"
    agent: implementer
    changeType: modify
    docs: [testing, infra]
    skill: integration-testing
    intent: |
      gate:full fails with ER_BAD_DB_ERROR "database not found: dolt/" when integration tests run with server mode. The pool in src/db/connection.ts uses TG_DOLT_SERVER_DATABASE ?? "" at creation; the harness sets it to path.basename(doltRepoPath). Ensure the MySQL database name is never a path or a value that can contain a slash.
      In __tests__/integration/test-utils.ts (setupIntegrationTest) and __tests__/integration/global-setup.ts: set TG_DOLT_SERVER_DATABASE to a single constant (e.g. "dolt") instead of path.basename(doltRepoPath), or normalize so the value never contains a slash. Confirm with Dolt docs or behavior: with dolt sql-server --data-dir <path>, the database name the client must use (often the repo directory name). Align harness so all tests that start a server use the same stable name.
    suggestedChanges: |
      test-utils.ts around line 134: process.env.TG_DOLT_SERVER_DATABASE = "dolt"; (or a constant exported from a shared test constant file if preferred)
      global-setup.ts around line 126: same. Ensure no other code path sets TG_DOLT_SERVER_DATABASE to a path or path.basename that could be "dolt/" on some platforms.
  - id: unit-failures-invariants
    content: "Fix invariants unit tests (checkValidTransition, checkNoBlockerCycle)"
    agent: implementer
    changeType: fix
    docs: [testing, error-handling]
    skill: neverthrow-error-handling
    intent: |
      __tests__/domain/invariants.test.ts fails for checkValidTransition (e.g. todo->done, done->any, canceled->any should be invalid) and checkNoBlockerCycle (direct/transitive/self cycle should return err). Run the test file locally; determine whether src/domain/invariants.ts is wrong or the test expectations (e.g. Zod enum usage, ErrorCode). Fix the code or the tests so behavior matches the intended spec. Do not refactor beyond what is needed to make tests pass.
  - id: unit-failures-query-doc
    content: "Fix query builder and doc-skill-registry unit tests"
    agent: implementer
    changeType: fix
    docs: [testing]
    intent: |
      __tests__/db/query.test.ts and __tests__/domain/doc-skill-registry.test.ts fail. Run both test files locally. For query tests: likely mock of doltSql expects (sql, repoPath) but code may pass a third argument (connectionOptions); fix mock or call sites. For doc-skill-registry: loadRegistry/regex/slugs may not match current docs/skills content; fix test expectations or frontmatter/slugs so registry output matches. Fix code or tests as appropriate; prefer code if tests encode the correct contract.
  - id: gate-full
    content: "Run gate:full and verify full suite passes; escalate investigators if not"
    agent: implementer
    changeType: test
    blockedBy:
      [
        integration-server-db-name,
        unit-failures-invariants,
        unit-failures-query-doc,
      ]
    intent: |
      Run pnpm gate:full from repo root. If it passes, evidence "gate:full passed". If it fails, cluster failures (integration vs unit), add tg note with raw output, and either (a) fix remaining issues in this plan or (b) evidence "gate:full failed: <summary>" and note that investigator dispatch is recommended per work skill. Do not run plan-merge or commit .taskgraph/dolt until gate:full passes.
    suggestedChanges: |
      Evidence string: "gate:full passed" or "gate:full failed: <short summary>". If failed, run tg note <taskId> --msg "<paste relevant failure snippet>" so orchestrator can dispatch investigators.
isProject: false
---

## Analysis

gate:full currently fails in two clusters: (1) integration tests with `ER_BAD_DB_ERROR: database not found: dolt/` when `TG_DOLT_SERVER_PORT` is set — the pool's database name is derived in the harness and may end up as a path or `dolt/` in some code paths; (2) unit tests for invariants (`checkValidTransition`, `checkNoBlockerCycle`), query builder (mocks/call signature), and doc-skill-registry (registry output vs expectations). The planner-analyst confirmed that the integration fix (use a single stable DB name in the test harness) and the unit fixes are independent and can run in parallel. The optional investigator flow runs only after these fixes, when re-running gate:full.

## Dependency graph

```text
Parallel start (3 unblocked):
  ├── integration-server-db-name   (test harness: TG_DOLT_SERVER_DATABASE = "dolt")
  ├── unit-failures-invariants    (invariants.test.ts / invariants.ts)
  └── unit-failures-query-doc     (query.test.ts, doc-skill-registry.test.ts)

After all three:
  └── gate-full                   (pnpm gate:full; evidence or note failure for investigators)
```

## Proposed changes

- **integration-server-db-name**: In `test-utils.ts` and `global-setup.ts`, set `process.env.TG_DOLT_SERVER_DATABASE = "dolt"` (or a shared constant) instead of `path.basename(doltRepoPath)`. Optionally verify in Dolt docs that with `--data-dir <path>` the client database name is the repo directory name; if so, "dolt" is correct for paths ending in `.../dolt`.
- **unit-failures-invariants**: Run `bun test __tests__/domain/invariants.test.ts`; fix `invariants.ts` (transition map or cycle detection) or test expectations (Zod enums, `ErrorCode`) so invalid transitions and cycles are rejected as specified.
- **unit-failures-query-doc**: Run query and doc-skill-registry tests; align mocks (e.g. `doltSql` third argument) or registry/frontmatter so tests pass.
- **gate-full**: Single task that runs the full gate and reports result; blocks plan completion until gate passes or failure is documented for investigator dispatch.

## Open questions

- None; analyst and checklist resolved scope. If gate:full still fails after the three fixes, the work skill's hunter-killer (one investigator per cluster) is the documented follow-up.

<original_prompt>
Suggested next steps:

1. Integration + server mode: Fix how the test harness (or server connection) sets the database name when TG_DOLT_SERVER_PORT is set so it doesn't use the literal path dolt/ as the MySQL database name (e.g. use a single test DB name and pass repo path only where Dolt needs it).
2. Unit failures: Run the failing unit tests locally (invariants, query builder, doc-skill-registry) and either update the code to match the intended behavior or fix the tests.
3. Investigators: Optionally run the work skill's hunter-killer flow: one investigator per failure cluster (integration server/DB; unit invariants/query/doc-skill), then re-run gate:full and only then do plan-merge and commit .taskgraph/dolt.
   </original_prompt>
