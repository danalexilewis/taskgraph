---
name: Fix Failing Unit Tests
overview: Fix 22 failing unit tests from investigation — 19 in query.test.ts (doltSql arity) and 3 in plan-completion.test.ts (setup/assertions). Includes optional hardening and isolation tasks.
fileTree: |
  __tests__/
  ├── db/
  │   └── query.test.ts                    (modify)
  └── domain/
  └── plan-completion.test.ts              (modify)
  docs/
  └── testing.md                           (modify — optional; document plan-completion setup)
risks:
  - description: Plan-completion tests depend on integration-style setup; fixing may require moving tests or env
    severity: medium
    mitigation: Harden assertions first; then ensure TG_GOLDEN_TEMPLATE or global setup when running unit script, or move tests under integration run
  - description: Per-test repo adds runtime; optional task only
    severity: low
    mitigation: Implement only if flakiness persists after main fixes
tests:
  - "pnpm test passes (all unit tests including query builder and plan-completion)"
  - "pnpm gate and pnpm gate:full pass after changes"
todos:
  - id: fix-doltSql-mock-arity
    content: Fix doltSql mock arity in query.test.ts — expect third arg undefined
    agent: implementer
    intent: |
      In __tests__/db/query.test.ts the mock is invoked with (sql, repoPath, undefined) but assertions use toHaveBeenCalledWith(sql, repoPath).
      Change all 19 toHaveBeenCalledWith(sql, repoPath) to toHaveBeenCalledWith(sql, repoPath, undefined) to match src/db/query.ts and connection.ts.
      No change to mock signature required; assertion update only.
    changeType: fix
  - id: harden-plan-completion-assertion
    content: Harden plan-completion test (ii) — assert rows.length before rows[0].status
    agent: implementer
    intent: |
      In __tests__/domain/plan-completion.test.ts, in the "mix of done and todo -> not marked done, returns false" test,
      before expect(rows[0].status).toBe("draft") add expect(rows.length).toBeGreaterThanOrEqual(1) (or equivalent) so failures
      distinguish "no row returned" from "wrong column/key". Optional: add a clear message if rows is empty.
    changeType: fix
  - id: plan-completion-integration-setup
    content: Run plan-completion tests with integration setup guaranteed
    agent: implementer
    intent: |
      Plan-completion tests use setupIntegrationTest() which needs TG_GOLDEN_TEMPLATE or GOLDEN_TEMPLATE_PATH_FILE (from integration global setup).
      When running only pnpm test that file may be missing. Either (a) move plan-completion.test.ts under a workflow that runs
      integration global setup, or (b) document in docs/testing.md that TG_GOLDEN_TEMPLATE or a pre-created golden path file
      must exist when running pnpm test for plan-completion tests. Ensure migrations and template are available so the three
      failing plan-completion tests pass (autoCompletePlanIfDone returns true/false as expected and SELECT plan returns rows).
    changeType: modify
  - id: optional-per-test-repo
    content: (Optional) Per-test repo for plan-completion to avoid shared state
    agent: implementer
    intent: |
      Optional. Give each it() in plan-completion.test.ts its own repo (e.g. call setupIntegrationTest() per test or clone
      from template per test) so tests do not share one Dolt repo and failures are not order-dependent. Only implement if
      flakiness or order-dependence persists after fix-doltSql-mock-arity, harden-plan-completion-assertion, and
      plan-completion-integration-setup.
    changeType: refactor
  - id: optional-verify-dolt-json
    content: (Optional) Verify Dolt JSON column names in plan-completion test setup
    agent: implementer
    intent: |
      Optional. In plan-completion test setup, log or assert the shape of one raw SELECT result (e.g. SELECT status FROM plan LIMIT 1)
      to confirm keys are status (and count for GROUP BY) so that r.status, r.count, and rows[0].status are reliable. Only if
      failures point to wrong key casing (e.g. Status vs status) from Dolt -r json.
    changeType: test
  - id: run-full-suite-unit-tests
    content: Run gate:full and confirm unit and integration tests pass
    agent: implementer
    intent: |
      After fix-doltSql-mock-arity, harden-plan-completion-assertion, and plan-completion-integration-setup complete,
      run pnpm gate:full (or bash scripts/cheap-gate.sh --full). If passed, evidence "gate:full passed". If failed,
      add tg note with failure reason and do not mark done until fixed or escalate.
    blockedBy:
      [
        fix-doltSql-mock-arity,
        harden-plan-completion-assertion,
        plan-completion-integration-setup,
      ]
    changeType: test
---

## Dependency graph

```
Parallel start (3 unblocked):
  ├── fix-doltSql-mock-arity
  ├── harden-plan-completion-assertion
  └── plan-completion-integration-setup

Optional (can run in parallel with above or after):
  ├── optional-per-test-repo
  └── optional-verify-dolt-json

After fix-doltSql-mock-arity, harden-plan-completion-assertion, plan-completion-integration-setup:
  └── run-full-suite-unit-tests
```

## Context

Investigation of failing unit tests (`pnpm test`) found:

1. **Query builder (19 failures):** `doltSql` in `src/db/connection.ts` has signature `(query, repoPath, options?)`. `src/db/query.ts` passes the third argument (often `undefined`). Tests asserted only two arguments.
2. **Plan-completion (3 failures):** Tests use integration-style setup (one shared Dolt repo from `beforeAll`). Golden template path may be missing when running only `pnpm test`; shared state can make results order-dependent. One test fails with `rows[0]` undefined (SELECT plan returned no rows).

## Scope

- **Required:** Fix query.test.ts assertions (19 fixes), harden plan-completion assertion, and ensure plan-completion tests run with valid integration setup so all 22 failures are resolved.
- **Optional:** Per-test repo isolation and Dolt JSON shape verification if needed after main fixes.

<original_prompt>Create plan and load tasks included optional (from investigation of failing unit tests).</original_prompt>
