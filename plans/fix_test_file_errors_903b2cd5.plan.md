---
name: Fix Test File Errors
overview: Fix the failing tests in `__tests__/db/query.test.ts` by correcting the mock return type (Result vs ResultAsync), fixing the COUNT test assertion, and resolving the `vi.Mock` type error. Optionally include test files in tsconfig for proper IDE type-checking.
todos: []
isProject: false
---

# Fix Test File Errors

## Problem Summary

The `[__tests__/db/query.test.ts](tools/taskgraph/__tests__/db/query.test.ts)` file has several issues causing test failures and type errors:

1. `**doltSql(...).map is not a function**` — The mock returns `ok([...])` (a `Result`) but `doltSql` must return `ResultAsync`, which has `.map()`. A `Result` has no `.map()`.
2. **"Cannot find namespace 'vi'"** — Using `vi.Mock` as a type causes a TypeScript error when the test file is not included in tsconfig or when vitest types are not fully resolved.
3. **COUNT test logic** — Uses `mockResolvedValueOnce` (Promise-based) which conflicts with the sync `okAsync` return. The expected column is `count` (from `AS count`) but the mock in beforeEach returns `COUNT(*)` (Dolt/MySQL uses the alias). The count test also expects `count.unwrapOr(0)` to be `5`, but `mockResolvedValueOnce` overrides the mock to return a Promise, not a ResultAsync.

## Root Causes

- **Neverthrow types**: `ok(x)` returns `Result<T,E>`; `okAsync(x)` returns `ResultAsync<T,E>`. The query builder's `count` method chains `.map()` on the return of `doltSql`, so the mock must return `okAsync([...])`.
- **Column name**: The `query.ts` count method uses `res[0]?.count` (lowercase) — the SQL is `SELECT COUNT(*) AS count`. So the mock must return `[{ count: N }]`.
- **vi.Mock**: Use `import type { Mock } from "vitest"` and `doltSql as Mock` instead of `vi.Mock`.

## Changes

### 1. `[tools/taskgraph/__tests__/db/query.test.ts](tools/taskgraph/__tests__/db/query.test.ts)`

- **Fix Mock type**: Change `const mockDoltSql = doltSql as vi.Mock` to use the exported `Mock` type:

```typescript
  import type { Mock } from "vitest";
  const mockDoltSql = doltSql as Mock<(sql: string, repoPath: string) => ResultAsync<any[], any>>;
  

```

  Or simply: `const mockDoltSql = doltSql as Mock` (shorter).

- **Fix mock implementation return type**: In `beforeEach`, change `return ok([...])` to `return okAsync([...])` so the mock returns `ResultAsync` (which has `.map()`).
- **Fix COUNT test**: 
  - Remove `mockResolvedValueOnce` — it makes the mock return a Promise, which has no `.map()`.
  - Use `mockImplementationOnce` to return `okAsync([{ count: 5 }])` for that specific call, or update the default mockImplementation so that when the SQL contains "SELECT COUNT(*)", it returns `okAsync([{ count: 5 }])` for the count test.
  - Simpler: have `mockImplementation` always return `okAsync`. For the count test, use `mockImplementationOnce` before the call to return `okAsync([{ count: 5 }])`, then the assertion `expect(count.unwrapOr(0)).toBe(5)` will pass.
  The count test currently does:

```typescript
  mockDoltSql.mockResolvedValueOnce(ok([{ count: 5 }]));
  const count = await q.count(...);
  expect(count.unwrapOr(0)).toBe(5);
  

```

  Replace with:

```typescript
  mockDoltSql.mockImplementationOnce(() => okAsync([{ count: 5 }]));
  const count = await q.count(...);
  expect(count.unwrapOr(0)).toBe(5);
  

```

  This ensures the mock returns ResultAsync for that one call.

### 2. `[tools/taskgraph/tsconfig.json](tools/taskgraph/tsconfig.json)`

- Add `__tests__/**/*.ts` to `include` so test files are type-checked and get proper vitest types (avoids "Cannot find namespace vi" in IDE).
- Revert or adjust `"types": ["vitest/globals"]` — when you set `types` explicitly, TypeScript only loads those and can drop `@types/node`. Prefer:
  - `"types": ["node", "vitest/globals"]` if both are needed, or
  - Remove `types` and rely on explicit imports (the test already imports `vi` from vitest; the issue may be IDE using a tsconfig that doesn't cover `__tests__`).
  Recommended: add `"__tests__/**/*.ts"` to `include` and keep `"types": ["vitest/globals"]` (or try without it first — if tests import explicitly, vi.Mock might work once we switch to `Mock`).

## Verification

Run `pnpm test` (or `npm test`) from `tools/taskgraph` — all 75 tests should pass, including the 20 in query.test.ts.