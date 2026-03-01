---
name: Gate Full Root Cause Fixes
overview: Implement investigation-report fixes so gate full passes (pool key includes database, refuse empty DB when port set, reset Dolt env in unit tests, isolate mock tests, unify doc-skill-registry to Bun, then run gate full).
fileTree: |
  src/db/
  └── connection.ts           (modify: getPoolKey, getServerPool, doltSql, closeServerPool)
  __tests__/
  ├── integration/
  │   └── test-utils.ts       (modify: teardown pass database to closeServerPool)
  ├── db/
  │   ├── query.test.ts       (modify: reset env)
  │   └── cached-query.test.ts (modify: reset env)
  └── domain/
  └── doc-skill-registry.test.ts (modify: Vitest to Bun)
  scripts/
  └── cheap-gate.sh           (modify if needed for mock isolation)
risks:
  - description: closeServerPool signature change could break test-utils if database not passed correctly
    severity: low
    mitigation: Only caller is test-utils; pass process.env.TG_DOLT_SERVER_DATABASE ?? "dolt" at teardown
  - description: doltSql fallback when pool is null may change behavior for consumers that expect an error when port set but pool unavailable
    severity: low
    mitigation: Fallback to execa is the desired behavior when database is empty; existing "pool not available" was only when pool creation failed, not when we refuse to create
tests:
  - "Integration tests pass when TG_DOLT_SERVER_PORT is set (pool key and empty-DB behavior)"
  - "Unit tests query.test.ts and cached-query.test.ts pass in full suite (env reset and/or isolation)"
  - "doc-skill-registry tests pass under Bun"
  - "gate:full passes"
todos:
  - id: pool-key-and-empty-db
    content: "Add database to pool key and refuse empty database; doltSql fallback to execa when pool null"
    agent: implementer
    changeType: modify
    docs: [infra, schema]
    skill: refactoring-safely
    intent: |
      Investigation report: pool cache key is (host, port) only so a pool created with database "" is reused. Fix: (1) getPoolKey(host, port, database) and use it in getServerPool() and closeServerPool(). (2) In getServerPool(), if TG_DOLT_SERVER_PORT is set and TG_DOLT_SERVER_DATABASE is missing or empty, return null. (3) In doltSql(), when port is set and getServerPool() returns null, fall through to the execa path (do not return "Dolt server pool not available"). (4) closeServerPool(port, host?, database?) and use getPoolKey(host, port, database); in __tests__/integration/test-utils.ts teardown call closeServerPool(context.serverPort, "127.0.0.1", process.env.TG_DOLT_SERVER_DATABASE ?? "dolt").
    suggestedChanges: |
      connection.ts: getPoolKey(host, port, database); getServerPool() check (TG_DOLT_SERVER_DATABASE ?? "") === "" then return null; createPool with database in key; doltSql when port set and !pool, do not return errAsync, fall through to runQuery(); closeServerPool(port, host?, database?) with key getPoolKey(host, port, database ?? ""). test-utils.ts teardown: closeServerPool(context.serverPort, "127.0.0.1", process.env.TG_DOLT_SERVER_DATABASE ?? "dolt").
  - id: reset-dolt-env-unit-tests
    content: "Reset TG_DOLT_SERVER_PORT (and DATABASE) in query and cached-query unit tests"
    agent: implementer
    changeType: modify
    docs: [testing]
    intent: |
      In __tests__/db/query.test.ts and __tests__/db/cached-query.test.ts, at top level (before any code that reads env) or in beforeEach, delete process.env.TG_DOLT_SERVER_PORT and delete process.env.TG_DOLT_SERVER_DATABASE so leftover integration env does not cause unit tests to hit the real pool when mock.module does not apply (e.g. when connection was already loaded by another test file).
  - id: isolate-mock-tests
    content: "Isolate query and cached-query tests so mock.module applies (run first or separate process)"
    agent: implementer
    changeType: modify
    docs: [testing]
    intent: |
      Ensure __tests__/db/query.test.ts and __tests__/db/cached-query.test.ts run before any test that loads src/db/connection (so Bun mock.module takes effect), or run them in a separate process. Options: (a) In scripts/cheap-gate.sh --full, run bun test __tests__/db/query.test.ts __tests__/db/cached-query.test.ts before bun test __tests__; or (b) configure Bun to run db/ tests first; or (c) document and rely on env reset (task reset-dolt-env-unit-tests) and run gate:full to verify. Prefer (a) or (b) so mock is guaranteed to apply.
  - id: unify-doc-skill-registry-runner
    content: "Convert doc-skill-registry.test.ts from Vitest to Bun"
    agent: implementer
    changeType: modify
    docs: [testing]
    intent: |
      __tests__/domain/doc-skill-registry.test.ts uses Vitest (import from "vitest"). Gate runs bun test __tests__. Convert to Bun: replace import { beforeAll, describe, expect, it } from "vitest" with import { beforeAll, describe, expect, it } from "bun:test". Keep loadRegistry(process.cwd()) or explicit repo root so cwd in gate:full matches. Ensure all assertions still pass under Bun.
  - id: gate-full
    content: "Run gate:full and verify full suite passes"
    agent: implementer
    changeType: test
    blockedBy: [pool-key-and-empty-db, reset-dolt-env-unit-tests, isolate-mock-tests, unify-doc-skill-registry-runner]
    intent: |
      Run pnpm gate:full from repo root. If it passes, evidence "gate:full passed". If it fails, tg note with failure summary and evidence "gate:full failed: <summary>". Do not run plan-merge until gate:full passes.
isProject: false
---

## Analysis

The investigation report (reports/investigation-gate-full-failures-2026-03-01.md) identified root causes for gate:full failures: (1) pool cache key does not include database, so a pool created with database "" is reused; (2) when port is set but database is empty we should fall back to execa, not error; (3) unit tests that mock connection fail when connection is already loaded by another test; (4) leftover TG_DOLT_SERVER_PORT in the same worker affects unit tests; (5) doc-skill-registry.test.ts uses Vitest while gate runs Bun. This plan implements the report's follow-up tasks. Optional "confirm Dolt error format" is omitted; we can add it later if needed.

## Dependency graph

```
Parallel start (4 unblocked):
  ├── pool-key-and-empty-db      (connection.ts + test-utils teardown)
  ├── reset-dolt-env-unit-tests  (query.test.ts, cached-query.test.ts)
  ├── isolate-mock-tests         (cheap-gate or Bun order / process)
  └── unify-doc-skill-registry-runner (doc-skill-registry.test.ts → Bun)

After all four:
  └── gate-full                  (pnpm gate:full)
```

## Proposed changes

- **pool-key-and-empty-db:** getPoolKey(host, port, database); getServerPool() returns null when port set and (TG_DOLT_SERVER_DATABASE ?? "") === ""; createPool key includes database; doltSql when port set and pool null falls through to execa path; closeServerPool(port, host?, database?) with same key; test-utils teardown passes database.
- **reset-dolt-env-unit-tests:** Top-level or beforeEach in query.test.ts and cached-query.test.ts: delete process.env.TG_DOLT_SERVER_PORT and TG_DOLT_SERVER_DATABASE.
- **isolate-mock-tests:** Run db/query and db/cached-query tests before the rest of **tests** (e.g. in cheap-gate.sh run them first) or in a separate bun test invocation so connection is not pre-loaded.
- **unify-doc-skill-registry-runner:** Vitest → bun:test in doc-skill-registry.test.ts; verify under Bun.

## Open questions

- None. Analyst confirmed closeServerPool has a single caller (test-utils) and all getServerPool() callers already handle null.

<original_prompt>
write plan for reports/investigation-gate-full-failures-2026-03-01.md
</original_prompt>
