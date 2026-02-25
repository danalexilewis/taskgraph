---
name: Fix Neverthrow TypeScript Errors
overview: "Systematically fix all TypeScript compilation errors caused by incorrect neverthrow usage patterns across the CLI, DB, and importer layers. The root cause is a single repeated anti-pattern: using `Result.asyncAndThen` with callbacks that return `Promise<Result>` instead of `ResultAsync`."
todos:
  - id: fix-foundations
    content: "Fix foundational files: add UNKNOWN_ERROR to ErrorCode enum, export ParsedPlan from parser.ts, fix migrate.ts fromPromise call, fix plan.ts import path"
    status: pending
  - id: fix-export-graph
    content: "Fix export.ts: remove repoPath arg from generateMermaidGraph/generateDotGraph calls (they fetch config internally). Remove async from asyncAndThen callback since the inner call returns ResultAsync directly."
    status: pending
  - id: fix-simple-cli
    content: "Fix simple CLI files (plan, next, start, task, done, edge, portfolio): remove async from asyncAndThen callbacks so they return ResultAsync directly, add missing err imports, fix .requiredOption() usage"
    status: pending
  - id: fix-complex-cli
    content: "Fix complex CLI files needing multi-step await (block, show, split, import): wrap imperative async logic in ResultAsync.fromPromise or refactor into pure ResultAsync chains"
    status: pending
  - id: fix-importer
    content: "Fix importer.ts: wrap async andThen callback in ResultAsync.fromPromise pattern"
    status: pending
  - id: fix-corrupted-next
    content: Rewrite corrupted next.ts cleanly (has inline line numbers embedded in source)
    status: pending
  - id: verify-build-tests
    content: Run tsc --noEmit, then all test suites (unit, e2e, integration) to verify zero errors
    status: pending
isProject: false
---

# Fix Neverthrow TypeScript Errors

## Root Cause Analysis

There are **three distinct categories** of errors, all stemming from misunderstanding how neverthrow's `Result` and `ResultAsync` interoperate:

### Error Category 1: `asyncAndThen` callback returns `Promise<Result>` instead of `ResultAsync`

**This is the core issue affecting nearly every CLI file.**

`readConfig()` in [utils.ts](tools/taskgraph/src/cli/utils.ts) returns a synchronous `Result<Config, AppError>`. Every CLI command calls:

```typescript
readConfig().asyncAndThen(async (config) => { ... })
```

Per the neverthrow docs, `Result.asyncAndThen` requires the callback to return a `ResultAsync<U, F>`, **not** a `Promise<Result<U, F>>`. But marking the callback `async` means it returns a `Promise`, which is not a `ResultAsync`.

**The fix**: The callback must return a `ResultAsync`, not an `async` function. Since `doltSql()` already returns `ResultAsync`, the callback should simply return the `ResultAsync` chain directly (no `async`, no `await`).

**Affected files**: [block.ts](tools/taskgraph/src/cli/block.ts), [done.ts](tools/taskgraph/src/cli/done.ts), [edge.ts](tools/taskgraph/src/cli/edge.ts), [export.ts](tools/taskgraph/src/cli/export.ts), [import.ts](tools/taskgraph/src/cli/import.ts), [next.ts](tools/taskgraph/src/cli/next.ts), [plan.ts](tools/taskgraph/src/cli/plan.ts), [portfolio.ts](tools/taskgraph/src/cli/portfolio.ts), [show.ts](tools/taskgraph/src/cli/show.ts), [split.ts](tools/taskgraph/src/cli/split.ts), [start.ts](tools/taskgraph/src/cli/start.ts), [task.ts](tools/taskgraph/src/cli/task.ts)

**Pattern to apply** - before (broken):

```typescript
readConfig().asyncAndThen(async (config) => {
  // async function returns Promise<Result>, not ResultAsync
  return doltSql(...).andThen(async (rows) => { ... });
})
```

After (correct):

```typescript
readConfig().asyncAndThen((config) => {
  // non-async: returns ResultAsync directly
  return doltSql(...).andThen((rows) => { ... });
})
```

For places where `await` is truly needed mid-chain (e.g., multiple sequential `doltSql` calls inside a single `andThen` callback), wrap the entire body in `ResultAsync.fromPromise`:

```typescript
readConfig().asyncAndThen((config) => {
  return ResultAsync.fromPromise(
    (async () => {
      const r1 = await doltSql(...);
      if (r1.isErr()) throw r1.error;
      const r2 = await doltSql(...);
      if (r2.isErr()) throw r2.error;
      return someValue;
    })(),
    (e) => e as AppError
  );
})
```

Alternatively, for the imperative-style multi-step logic (like in `split.ts`, `show.ts`, `import.ts`), use `safeTry` from neverthrow or refactor into pure `ResultAsync` chains.

### Error Category 2: `result.match` callback type annotations conflict with `unknown`

When `asyncAndThen` returns `ResultAsync<unknown, unknown>` (due to Category 1), the `.match` callbacks receive `unknown` parameters, which clash with explicit type annotations like `(data: Task) => ...`.

**The fix**: Once Category 1 is fixed and the types flow correctly through `ResultAsync`, the `T` and `E` generics will be properly inferred. The `.match` callbacks will receive the correct types. No casts to `unknown` or `as` casts will be needed.

**Affected files**: Same as Category 1, plus [init.ts](tools/taskgraph/src/cli/init.ts).

### Error Category 3: Miscellaneous individual bugs


| File                                                       | Error                                                                                                                   | Fix                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [next.ts](tools/taskgraph/src/cli/next.ts)                 | Corrupted with inline line numbers from a bad write                                                                     | Rewrite the file cleanly                                                                                                                                                                                                |
| [split.ts](tools/taskgraph/src/cli/split.ts)               | Uses `TaskStatusSchema` without importing it; uses `{ required: true }` on `.option()`                                  | Import `TaskStatusSchema`; change to `.requiredOption()`                                                                                                                                                                |
| [start.ts](tools/taskgraph/src/cli/start.ts)               | Missing `err` import                                                                                                    | Add `err` to imports                                                                                                                                                                                                    |
| [task.ts](tools/taskgraph/src/cli/task.ts)                 | Missing `err` import                                                                                                    | Add `err` to imports                                                                                                                                                                                                    |
| [init.ts](tools/taskgraph/src/cli/init.ts)                 | `ErrorCode.UNKNOWN_ERROR` doesn't exist; `ResultAsync.fromPromise` receives `async () => {...}` (function, not Promise) | Add `UNKNOWN_ERROR` to `ErrorCode` enum; call the async IIFE to produce a Promise                                                                                                                                       |
| [plan.ts](tools/taskgraph/src/cli/plan.ts)                 | Import path `../../db/escape` is wrong                                                                                  | Fix to `../db/escape`                                                                                                                                                                                                   |
| [migrate.ts](tools/taskgraph/src/db/migrate.ts)            | `ResultAsync.fromPromise` receives `async () => {...}` (function, not Promise)                                          | Call the async IIFE: `(async () => { ... })()`                                                                                                                                                                          |
| [export.ts](tools/taskgraph/src/cli/export.ts)             | `generateMermaidGraph` / `generateDotGraph` called with 3 args but only accept 2                                        | These functions use `readConfig()` internally via `getGraphData()`, so don't pass `repoPath`. Call with only `(planId, featureKey)`. Also, since they already return `ResultAsync`, no need for `asyncAndThen` wrapper. |
| [import.ts](tools/taskgraph/src/cli/import.ts)             | Imports non-exported `ParsedPlan` from parser                                                                           | Export `ParsedPlan` from parser.ts                                                                                                                                                                                      |
| [importer.ts](tools/taskgraph/src/plan-import/importer.ts) | `andThen` callback is async (same as Cat. 1)                                                                            | Refactor to use `ResultAsync.fromPromise` wrapper                                                                                                                                                                       |


## tsconfig.json Review

Current [tsconfig.json](tools/taskgraph/tsconfig.json):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Assessment**: The config is mostly appropriate but is **missing `moduleResolution`**. When `module` is `NodeNext`, TypeScript defaults `moduleResolution` to `NodeNext`, which is correct for this project. However, two additions are recommended:

- `**"declaration": true**` - useful for publishing/consuming the package
- `**"sourceMap": true**` - useful for debugging

These are nice-to-haves, not blockers. The tsconfig is not causing the compilation errors.

## Execution Strategy

Since the same anti-pattern repeats across ~15 files, the most efficient approach is:

1. Fix foundational pieces first: `errors.ts` (add `UNKNOWN_ERROR`), `parser.ts` (export `ParsedPlan`), `migrate.ts`
2. Fix `export.ts` and the graph functions (argument count issue)
3. Fix all CLI files systematically with the correct `asyncAndThen` pattern
4. Fix the corrupted `next.ts`
5. Run `tsc --noEmit` to verify zero errors
6. Run all test suites

The key insight is that **most files need the exact same transformation**: remove `async` from `asyncAndThen` callbacks, and for callbacks that genuinely need `await` (multi-step imperative logic), wrap them in `ResultAsync.fromPromise((async () => { ... })(), errorHandler)`.