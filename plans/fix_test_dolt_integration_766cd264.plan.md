---
name: Fix Test Dolt Integration
overview: Fix the integration and e2e test suites so they correctly set up isolated Dolt environments and resolve the `process.cwd()` coupling that prevents tests from working against temporary directories.
todos:
  - id: utils-basepath
    content: Add optional basePath parameter to readConfig and writeConfig in src/cli/utils.ts
    status: pending
  - id: graph-basepath
    content: Thread basePath through getGraphData, generateMermaidGraph, and generateDotGraph
    status: pending
  - id: init-dolt-cwd
    content: "Fix init.ts to mkdir doltRepoPath and run dolt init with cwd: doltRepoPath"
    status: pending
  - id: fix-test-utils
    content: "Fix test-utils.ts: revert absolute dolt path, use correct writeConfig signature, fix await patterns"
    status: pending
  - id: fix-integration-tests
    content: "Fix graph-export.test.ts and invariants-db.test.ts: pass basePath, guard afterAll, fix doltSql await"
    status: pending
  - id: verify-all-tests
    content: Run tsc --noEmit, pnpm test, pnpm test:integration, pnpm test:e2e and verify all pass
    status: pending
isProject: false
---

# Fix Integration and E2E Test Dolt Integration

## Root Cause Analysis

There are **three interrelated problems** preventing the integration and e2e tests from working:

### Problem 1: `writeConfig` and `readConfig` are hardcoded to `process.cwd()`

Both functions in [src/cli/utils.ts](tools/taskgraph/src/cli/utils.ts) resolve the config path relative to `process.cwd()`:

```typescript
// line 14
const configPath = path.join(process.cwd(), CONFIG_FILE);
// line 38
const configPath = path.join(process.cwd(), CONFIG_FILE);
```

This works fine for CLI usage (the user runs `tg` from their project root), but in tests `process.cwd()` is `tools/taskgraph/` -- not the temporary test directory. So:

- `writeConfig()` tries to write to `tools/taskgraph/.taskgraph/config.json` (wrong)
- `readConfig()` reads from `tools/taskgraph/.taskgraph/config.json` (wrong)
- `generateMermaidGraph` / `generateDotGraph` call `readConfig()` internally via `getGraphData()`, so they also read from the wrong location

The test-utils attempted to work around this by calling `writeConfig(tempDir, { doltRepoPath })` with two arguments, but `writeConfig` only accepts one argument (`config: Config`). This call was a type error that silently passed `tempDir` as the config object.

### Problem 2: `dolt` not found via `execa` (ENOENT)

In [test-utils.ts](tools/taskgraph/__tests__/integration/test-utils.ts) line 24, `dolt` is called with an absolute path `/usr/local/bin/dolt`. This is brittle and machine-specific. The real issue was that `execa` by default does not search the system `PATH` the way a shell does. Using `{ shell: true }` or ensuring the PATH is inherited fixes this without hardcoding.

Note: `doltSql` in [connection.ts](tools/taskgraph/src/db/connection.ts) and `doltCommit` in [commit.ts](tools/taskgraph/src/db/commit.ts) also call `execa("dolt", ...)` without `shell: true`, so the same issue would affect them. However, they work in the CLI context because the CLI is invoked via a shell. In the integration tests, these functions are called directly from Node.js, so `dolt` must be findable.

### Problem 3: `afterAll` crashes when `beforeAll` fails

When `setupIntegrationTest()` throws, `context` is `undefined`, so `teardownIntegrationTest(context.tempDir)` throws a `TypeError`. Both test files have this issue.

---

## Solution

### 1. Make `readConfig` and `writeConfig` accept an optional `basePath` parameter

Modify [src/cli/utils.ts](tools/taskgraph/src/cli/utils.ts) so both functions accept an optional `basePath` argument that defaults to `process.cwd()`. This keeps CLI behavior unchanged while allowing tests to pass the temp directory:

```typescript
export function readConfig(basePath?: string): Result<Config, AppError> {
  const configPath = path.join(basePath ?? process.cwd(), CONFIG_FILE);
  // ...
}

export function writeConfig(config: Config, basePath?: string): Result<void, AppError> {
  const configPath = path.join(basePath ?? process.cwd(), CONFIG_FILE);
  // ...
}
```

This is a minimal, non-breaking change. All existing callers pass zero arguments and get `process.cwd()` automatically.

### 2. Propagate `basePath` through `getGraphData` and the generate functions

Since `generateMermaidGraph` and `generateDotGraph` call `getGraphData`, which calls `readConfig()`, the `basePath` must flow through:

- [src/export/graph-data.ts](tools/taskgraph/src/export/graph-data.ts): `getGraphData(planId?, featureKey?, basePath?)`
- [src/export/mermaid.ts](tools/taskgraph/src/export/mermaid.ts): `generateMermaidGraph(planId?, featureKey?, basePath?)`
- [src/export/dot.ts](tools/taskgraph/src/export/dot.ts): `generateDotGraph(planId?, featureKey?, basePath?)`

All CLI callers pass no `basePath` (unchanged behavior). Integration tests pass their `tempDir`.

### 3. Update all CLI commands that call `readConfig()`

Every CLI command in `src/cli/` calls `readConfig()` with no arguments, which will continue to use `process.cwd()`. No changes needed for CLI files.

### 4. Fix `execa("dolt", ...)` to use PATH resolution

Remove the hardcoded `/usr/local/bin/dolt` in test-utils.ts. Instead, ensure execa can find `dolt` by passing `{ env: { ...process.env } }` to inherit the full environment (including PATH). Alternatively, since `execa` v9 inherits env by default, the original `execa("dolt", ["init"], { cwd: doltRepoPath })` should already work -- the ENOENT was actually about the `cwd` directory not existing, not about `dolt` not being found (the error message says: `The "cwd" option is invalid: ...`).

Looking at the original error more carefully:

```
ENOENT: no such file or directory, stat '.../tg-integration-nEKL4v/.taskgraph/dolt'
```

This confirms the `cwd` directory didn't exist when `dolt init` was called. The fix to `mkdirSync(doltRepoPath, { recursive: true })` (already applied) was correct. Revert the `/usr/local/bin/dolt` absolute path back to just `"dolt"`.

### 5. Fix test-utils.ts `setupIntegrationTest`

- Revert `"/usr/local/bin/dolt"` back to `"dolt"`
- Fix `writeConfig` call: pass `(config, tempDir)` with the correct new signature
- Guard `afterAll` against undefined context

### 6. Fix integration test files to pass `basePath`

- [graph-export.test.ts](tools/taskgraph/__tests__/integration/graph-export.test.ts): Pass `context.tempDir` (or similar basePath) to `generateMermaidGraph`/`generateDotGraph` so they can read config from the temp directory
- [invariants-db.test.ts](tools/taskgraph/__tests__/integration/invariants-db.test.ts): Guard `afterAll`
- Both files: `await` the `doltSql(...)` `ResultAsync` correctly (currently mixing `await (await doltSql(...))._unsafeUnwrap()` and `await doltSql(...)._unsafeUnwrap()` patterns)

### 7. Fix e2e test `init.ts` Dolt init directory

In [src/cli/init.ts](tools/taskgraph/src/cli/init.ts) line 31, `dolt init` runs with `{ cwd: taskGraphPath }` which is `.taskgraph/`, but dolt creates its repo *in* the cwd. So the Dolt repo ends up at `.taskgraph/` itself rather than `.taskgraph/dolt/`. The e2e test checks for `.taskgraph/dolt/.dolt` but `tg init` creates `.taskgraph/.dolt`. Either the `init.ts` logic or the e2e test expectation needs to align. The fix depends on intended behavior: if `.taskgraph/dolt/` is the intended repo path, then `init.ts` should `mkdirSync(doltRepoPath)` and run `dolt init` with `{ cwd: doltRepoPath }` instead of `{ cwd: taskGraphPath }`.

---

## Files to Change

- **[src/cli/utils.ts](tools/taskgraph/src/cli/utils.ts)** -- Add optional `basePath` param to `readConfig` and `writeConfig`
- **[src/export/graph-data.ts](tools/taskgraph/src/export/graph-data.ts)** -- Add optional `basePath` param to `getGraphData`, pass to `readConfig`
- **[src/export/mermaid.ts](tools/taskgraph/src/export/mermaid.ts)** -- Add optional `basePath` param to `generateMermaidGraph`
- **[src/export/dot.ts](tools/taskgraph/src/export/dot.ts)** -- Add optional `basePath` param to `generateDotGraph`
- **[src/cli/init.ts](tools/taskgraph/src/cli/init.ts)** -- Fix `dolt init` cwd to use `doltRepoPath` and create the directory first
- **[tests/integration/test-utils.ts](tools/taskgraph/__tests__/integration/test-utils.ts)** -- Revert absolute dolt path, fix `writeConfig` call, fix `applyMigrations` await pattern
- **[tests/integration/graph-export.test.ts](tools/taskgraph/__tests__/integration/graph-export.test.ts)** -- Pass basePath to generate functions, guard afterAll, fix doltSql await pattern
- **[tests/integration/invariants-db.test.ts](tools/taskgraph/__tests__/integration/invariants-db.test.ts)** -- Guard afterAll, fix doltSql await pattern
- **[tests/e2e/core-flow.test.ts](tools/taskgraph/__tests__/e2e/core-flow.test.ts)** -- No source changes needed (uses CLI via shell, so process.cwd() is the tempDir passed via `cwd`)

