---
name: Fix remaining tsc errors
overview: "Fix the 4 remaining TypeScript compilation errors across init.ts, next.ts, portfolio.ts, and task.ts. All stem from two root causes: (1) using `ResultAsync.fromSafePromise(Promise.resolve(err(...)))` which wraps an Err as a success value instead of using `errAsync()`, and (2) init.ts having an un-invoked async IIFE and accessing `unknown` typed error without cast."
todos:
  - id: fix-errAsync
    content: Replace ResultAsync.fromSafePromise(Promise.resolve(err(...))) with errAsync(...) in next.ts, portfolio.ts, task.ts
    status: in_progress
  - id: fix-init
    content: "Fix init.ts: invoke the async IIFE with () and use appError variable instead of error on line 73"
    status: pending
  - id: verify-tsc-tests
    content: Run tsc --noEmit (0 errors), pnpm test (53 pass), pnpm test:e2e
    status: pending
isProject: false
---

# Fix Remaining tsc Errors

## Current State

- **Unit tests**: All 53 passing
- **tsc --noEmit**: 5 errors across 4 files
- **E2E tests**: Blocked by tsc errors (build fails)

## Root Cause

There are exactly **two patterns** causing all remaining errors:

### Pattern A: `ResultAsync.fromSafePromise(Promise.resolve(err(...)))` is wrong

`fromSafePromise<T>(promise: PromiseLike<T>)` takes a promise of a **value** and wraps it as `ResultAsync<T, never>`. When you pass `Promise.resolve(err(buildError(...)))`, the `T` becomes `Err<never, AppError>` -- it wraps the error *as the success value*. TypeScript correctly rejects this because the return types don't unify.

**Fix**: Use `errAsync(buildError(...))` from neverthrow, which creates `ResultAsync<never, AppError>` -- a proper async error result.

**Affected files and lines**:

- [tools/taskgraph/src/cli/next.ts](tools/taskgraph/src/cli/next.ts) line 18: validation error for invalid limit
- [tools/taskgraph/src/cli/portfolio.ts](tools/taskgraph/src/cli/portfolio.ts) line 40: validation error for invalid min count
- [tools/taskgraph/src/cli/task.ts](tools/taskgraph/src/cli/task.ts) line 38: validation error for invalid JSON

**Before** (broken):

```typescript
return ResultAsync.fromSafePromise(
  Promise.resolve(
    err(buildError(ErrorCode.VALIDATION_FAILED, "msg")),
  ),
);
```

**After** (correct):

```typescript
return errAsync(buildError(ErrorCode.VALIDATION_FAILED, "msg"));
```

Import `errAsync` from `neverthrow` in each file.

### Pattern B: `init.ts` has two bugs

**Bug 1** (line 24): `ResultAsync.fromPromise` receives an async arrow function `(async (): Promise<void> => { ... })` but this is a **function**, not a **Promise**. The async IIFE must be **invoked**: `(async () => { ... })()`.

Currently on line 24 the code is:

```typescript
const initResult = await ResultAsync.fromPromise(
  (async (): Promise<void> => {
```

but the closing `)` on line 37 closes the arrow function, not invokes it. It should be `})()`.

**Bug 2** (line 73): `error` is typed `unknown` but accessed as `error.message`. Should use `appError.message` (the cast is on line 72 but never used on line 73).

## Changes

### 1. [tools/taskgraph/src/cli/next.ts](tools/taskgraph/src/cli/next.ts)

- Add `errAsync` to the neverthrow import
- Replace `ResultAsync.fromSafePromise(Promise.resolve(err(...)))` on line 18 with `errAsync(buildError(...))`

### 2. [tools/taskgraph/src/cli/portfolio.ts](tools/taskgraph/src/cli/portfolio.ts)

- Add `errAsync` to the neverthrow import
- Replace `ResultAsync.fromSafePromise(Promise.resolve(err(...)))` on line 40 with `errAsync(buildError(...))`

### 3. [tools/taskgraph/src/cli/task.ts](tools/taskgraph/src/cli/task.ts)

- Add `errAsync` to the neverthrow import
- Replace `ResultAsync.fromSafePromise(Promise.resolve(err(...)))` on line 38 with `errAsync(buildError(...))`

### 4. [tools/taskgraph/src/cli/init.ts](tools/taskgraph/src/cli/init.ts)

- Line 37: Change `})` to `})()` to invoke the async IIFE so it produces a `Promise<void>` instead of a function
- Line 73: Change `error.message` to `appError.message` (use the cast variable from line 72)

### 5. Verify

- Run `npx tsc --noEmit` -- expect 0 errors
- Run `pnpm test` -- expect all 53 unit tests passing
- Run `pnpm test:e2e` -- expect e2e tests to build and execute

