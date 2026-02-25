---
name: Fix Failing Tests Properly
overview: Fix the two failing test suites by addressing actual root causes in source code and test architecture — not patching tests to pass. Introduce integration tests for DB-dependent logic and extract pure formatting functions for genuine unit testing.
todos:
  - id: fix-imports
    content: Fix wrong import paths in src/export/mermaid.ts and src/export/dot.ts (../../db/connection → ../db/connection) and remove unused imports
    status: in_progress
  - id: extract-formatters
    content: Extract formatMermaidGraph and formatDotGraph as pure functions, and dedup getGraphData into src/export/graph-data.ts
    status: pending
  - id: unit-tests-formatters
    content: Create __tests__/export/mermaid-format.test.ts with unit tests for the pure formatting functions — no mocks needed
    status: pending
  - id: integration-setup
    content: Create a shared integration test helper (tempDir + dolt init + applyMigrations + cleanup) for reuse across integration test files
    status: pending
  - id: integration-graph-export
    content: Create __tests__/integration/graph-export.test.ts testing generateMermaidGraph and generateDotGraph against real Dolt
    status: pending
  - id: integration-checkrunnable
    content: Create __tests__/integration/invariants-db.test.ts testing checkRunnable against real Dolt (task not found, wrong status, unmet blockers, runnable)
    status: pending
  - id: vitest-config
    content: Update vitest.config.ts to exclude integration/ from default test run and add test:integration script to package.json
    status: pending
isProject: false
---

# Fix Failing Tests Properly

## Root Cause Analysis

### 1. `mermaid_dot.test.ts` — Module resolution failure

**Error:** `Failed to load url ../../db/connection (resolved id: ../../db/connection) in .../src/export/mermaid.ts`

**Actual cause:** The import in `[src/export/mermaid.ts](tools/taskgraph/src/export/mermaid.ts)` (and identically in `[src/export/dot.ts](tools/taskgraph/src/export/dot.ts)`) is wrong:

```typescript
// mermaid.ts is at src/export/mermaid.ts
import { doltSql } from "../../db/connection";  // resolves to tools/taskgraph/db/ — doesn't exist
import { readConfig } from "../cli/utils";       // resolves to src/cli/utils — correct
```

The import should be `../db/connection` (one level up to `src/`, then into `db/`). Two levels up escapes `src/` entirely into the project root where there is no `db/` directory.

This is a **source code bug**, not a test bug. The mock in the test never even had a chance to intercept anything because Vite couldn't resolve the broken import when transforming `mermaid.ts`.

**Secondary architectural problem:** Even if the path is fixed, the test mocks `doltSql` and `readConfig` to verify graph formatting. Mocking a function that makes a DB call to test string output logic has low signal and high brittleness.

### 2. `invariants.test.ts` — Currently passing after recent fix

The test was originally written using `TaskStatus.todo`, but `TaskStatus` is a TypeScript type alias (`type TaskStatus = z.infer<...>`), not a runtime value. The fix to `TaskStatusSchema.enum.todo` is correct — `TaskStatusSchema` is the actual Zod enum object that holds `.enum` as a runtime dictionary of the enum values.

The `checkValidTransition` and `checkNoBlockerCycle` tests are testing pure functions correctly. `checkRunnable` (which calls `doltSql`) is correctly excluded from the unit tests, but is currently not tested anywhere.

## What Needs to Change

```
mermaid
├── Source fix: wrong import path in mermaid.ts and dot.ts
├── Test refactor: delete mock-based mermaid_dot.test.ts
├── Refactor: extract pure formatMermaidGraph/formatDotGraph functions
├── Unit test: formatMermaidGraph + formatDotGraph (pure string formatters)
└── Integration test: generateMermaidGraph/generateDotGraph + checkRunnable against real Dolt
```

## Changes

### 1. Fix source code bugs in `src/export/mermaid.ts` and `src/export/dot.ts`

Both files have the wrong import path AND have dead imports (`err`, `ErrorCode`, `buildError` are never used):

```typescript
// Before (wrong - resolves outside src/)
import { doltSql } from "../../db/connection";
import { ResultAsync, err, ok } from "neverthrow";
import { AppError, ErrorCode, buildError } from "../../domain/errors";

// After (correct)
import { doltSql } from "../db/connection";
import { ResultAsync } from "neverthrow";
import { AppError } from "../domain/errors";
```

Also note: `mermaid.ts` and `dot.ts` duplicate the entire `getGraphData` function and its interfaces. This should be consolidated into a shared `src/export/graph-data.ts` (same function, different formatters).

### 2. Refactor: extract pure formatting functions

Split each export file so the formatting logic is a pure function that can be unit tested without any DB involvement:

```typescript
// src/export/mermaid.ts
export function formatMermaidGraph(tasks: TaskRow[], graphEdges: EdgeRow[]): string { ... }
export function generateMermaidGraph(...): ResultAsync<string, AppError> {
  return getGraphData(...).map(({ tasks, edges }) => formatMermaidGraph(tasks, edges));
}
```

Same for `dot.ts` with `formatDotGraph`.

### 3. Delete `__tests__/export/mermaid_dot.test.ts`

Replace with two new files:

`**__tests__/export/mermaid-format.test.ts**` — unit tests for `formatMermaidGraph` and `formatDotGraph`:

```typescript
import { formatMermaidGraph } from '../../src/export/mermaid';
import { formatDotGraph } from '../../src/export/dot';
// No mocks needed — pure functions
```

`**__tests__/integration/graph-export.test.ts**` — integration tests using real Dolt:

- `beforeAll`: creates a temp dir, runs `dolt init`, runs `applyMigrations`
- Seeds test data via `doltSql`
- Calls `generateMermaidGraph` / `generateDotGraph` against the live DB
- `afterAll`: `fs.rmSync` cleanup

### 4. Add `__tests__/integration/invariants-db.test.ts`

Tests `checkRunnable` (the currently-untested DB-dependent invariant) using real Dolt:

```typescript
// Tests: task not found, task not in 'todo', task has unmet blockers, task is runnable
```

### 5. Update `vitest.config.ts` to separate integration tests

Add a separate config or script so integration tests can be run separately from unit tests (they require Dolt to be installed):

```typescript
// vitest.config.ts — exclude integration tests from default unit run
exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/integration/**'],

// package.json — add script
"test:integration": "vitest run --dir __tests__/integration"
```

## File Map

- Fix: `[src/export/mermaid.ts](tools/taskgraph/src/export/mermaid.ts)` — correct import path, remove dead imports, extract `formatMermaidGraph`
- Fix: `[src/export/dot.ts](tools/taskgraph/src/export/dot.ts)` — same fixes, extract `formatDotGraph`
- New: `src/export/graph-data.ts` — shared `getGraphData` + interfaces (dedup)
- Delete: `__tests__/export/mermaid_dot.test.ts`
- New: `__tests__/export/mermaid-format.test.ts` — unit tests for pure formatters
- New: `__tests__/integration/graph-export.test.ts` — integration tests for graph generation
- New: `__tests__/integration/invariants-db.test.ts` — integration tests for `checkRunnable`
- Update: `[vitest.config.ts](tools/taskgraph/vitest.config.ts)` — exclude integration from default run
- Update: `[package.json](tools/taskgraph/package.json)` — add `test:integration` script

