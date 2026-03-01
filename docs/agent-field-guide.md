# Agent Field Guide

A hard-won utility belt of patterns, conventions, and gotchas for this codebase. Read this before implementing anything. Every entry has a real failure behind it.

## Contents

1. [CLI Command Checklist](#cli-command-checklist)
2. [Dolt / Query Patterns](#dolt--query-patterns)
3. [Common Mistakes (Avoid These)](#common-mistakes-avoid-these)
4. [Codebase-Specific Gotchas](#codebase-specific-gotchas)
5. [Testing Patterns](#testing-patterns)
6. [Output Conventions](#output-conventions)
7. [Worktree Workflow](#worktree-workflow)

---

## CLI Command Checklist

Use this when adding or extending any `tg` subcommand. Every step matters.

```text
□  Read config first
   const configResult = readConfig();
   if (configResult.isErr()) { console.error(configResult.error.message); process.exit(1); }
   const config = configResult.value;

□  Init query
   const q = query(config.doltRepoPath);

□  Check JSON flag
   const json = rootOpts(cmd).json ?? false;

□  Escape user input
   sqlEscape(userInput)  — before any raw SQL interpolation

□  Define row interfaces
   interface XxxRow { field: type; ... }  — one per query shape, never use any[]

□  Check table existence if using project/plan
   const tableName = (await tableExists(repoPath, 'project').then(r => r._unsafeUnwrap())) ? 'project' : 'plan';

□  Coerce Dolt return types
   String(r.datetime_col).slice(0, 10)   — datetimes come back as Date objects in server mode
   Number(r.count_col)                   — COUNT/SUM may be bigint

□  Use result.match() at CLI boundary — never throw, never _unsafeUnwrap in production

□  Both output modes: human table + --json (no exceptions)

□  For multi-ID commands: parseIdList + explicit config unwrap + accumulate results
   const ids = parseIdList(rawIds);
   const configResult = await readConfig();
   if (configResult.isErr()) { console.error(configResult.error.message); process.exit(1); }
   const config = configResult.value;
   const results: ({ id: string; status: string } | { id: string; error: string })[] = [];
   for (const id of ids) { const r = await doOne(config, id); r.match(ok => results.push({id, status:'ok'}), e => results.push({id, error: e.message})); }
   const anyFailed = results.some(r => "error" in r);
   // output results, then if (anyFailed) process.exit(1);
   // Do NOT nest this loop inside asyncAndThen — partial-failure accumulation is impossible inside a monadic chain

□  Register in src/cli/index.ts

□  pnpm build  — always after source changes, before testing

□  Update docs/cli-reference.md  — new options + --json shape

□  Update existing tests if --json output shape changed  — grep for the command name in __tests__/
```

---

## Dolt / Query Patterns

### Standard query builder

```typescript
// Select with conditions
const rows = await q.select<TaskRow>("task", {
  columns: ["task_id", "title", "status"],
  where: { plan_id: planId, status: "done" },
  orderBy: "`created_at` DESC",
  limit: 20,
});

// Insert
await q.insert("event", {
  event_id: uuidv4(),
  task_id,
  kind: "done",
  body: jsonObj({ evidence: "..." }), // <-- always jsonObj() for JSON columns
  created_at: now(),
});

// Update
await q.update("task", { status: "done", updated_at: now() }, { task_id });

// Complex joins / aggregates — drop to raw (q.raw, NOT doltSql directly in CLI)
const result = await q.raw<TimelineRow>(complexSql);
result.match(
  (rows) => {
    /* render */
  },
  (e: AppError) => {
    console.error(e.message);
    process.exit(1);
  },
);

// Multiple independent queries — use ResultAsync.combine, NOT nested andThen
// (nested andThen runs queries serially; combine runs them in parallel)
const [r1, r2, r3] = await ResultAsync.combine([
  q.raw<Row1>(sql1),
  q.raw<Row2>(sql2),
  q.select<Row3>("task", { where: { plan_id: planId } }),
]);
// r1, r2, r3 are typed correctly
```

### JSON column write: always `jsonObj()`

```typescript
// Correct
body: jsonObj({ evidence: "...", tokens_in: 1200 })

// Wrong — plain JS objects won't be serialized correctly
body: { evidence: "..." } as any
```

### JSON column read: defensive parsing

Dolt returns JSON columns as a JS object (server mode) OR as a JSON string (CLI mode). Handle both:

```typescript
const raw = row.body;
let parsed: MyShape;
try {
  parsed =
    typeof raw === "string" ? (JSON.parse(raw) as MyShape) : (raw as MyShape);
} catch {
  return null;
}
```

Dolt may also double-encode string values inside JSON: `'"value"'` instead of `'value'`. Unwrap:

```typescript
const unwrap = (v: string): string =>
  v.startsWith('"') ? (JSON.parse(v) as string) : v;
```

### Datetime columns — always `String()` before string ops

```typescript
// Correct — works in both server mode (Date object) and CLI mode (string)
String(r.started_at).slice(0, 10);

// Wrong — throws TypeError in server mode: r.started_at.slice is not a function
r.started_at.slice(0, 10);
```

### Numeric columns — always `Number()` before arithmetic

```typescript
// Correct — COUNT/SUM may be bigint from mysql2
Number(r.task_count) +
  Number(r.done_count)`${Number(r.done_count)}/${Number(r.task_count)}`;

// Wrong — may get "10n" bigint string or NaN
r.task_count + r.done_count;
```

### TIMESTAMPDIFF for elapsed time

```sql
TIMESTAMPDIFF(SECOND, MIN(e_start.created_at), MAX(e_done.created_at)) AS total_elapsed_s
```

Returns seconds as number (or null if either timestamp is null). Use `Number()` before arithmetic.

### `tableExists()` for plan/project branching

The `plan` table was renamed to `project` in a migration. Test environments may have either:

```typescript
import { tableExists } from "../db/migrate";

const hasProject = await tableExists(repoPath, "project").then((r) =>
  r._unsafeUnwrap(),
);
const tableName = hasProject ? "project" : "plan";
```

This is not optional. Hardcoding `'project'` breaks test environments; hardcoding `'plan'` breaks production.

### Result chain — never throw at the boundary

```typescript
// Correct pattern
const result = await q.raw<Row>(sql);
result.match(
  (rows) => {
    /* success path */
  },
  (e: AppError) => {
    console.error(`Error: ${e.message}`);
    if (json)
      console.log(
        JSON.stringify({ status: "error", code: e.code, message: e.message }),
      );
    process.exit(1);
  },
);

// Never: try/catch around DB calls
// Never: result._unsafeUnwrap() in production code (tests only)
```

---

## Common Mistakes (Avoid These)

### 1. Changing `--json` output shape without updating all parsers

When you add wrapper keys to a JSON output (e.g. changing a flat `[{agent}]` array to `{agent_metrics: [{agent}]}`), you **will** break existing integration tests and any tooling that parses that output.

**Before changing any `--json` output:**

1. `grep -r "stats --json\|\"stats --json\"" __tests__/` to find all tests that parse it
2. Update those tests in the same commit
3. Update `docs/cli-reference.md` with the new shape

### 2. Not rebuilding `dist/` before integration tests

Integration tests run the compiled CLI from `dist/`. Source edits without a rebuild test stale code.

```bash
pnpm build          # always after src/ changes
pnpm gate           # lint + typecheck + affected tests
pnpm test:integration  # full integration suite
```

### 3. `console.error()` in test files triggers biome lint failure

Biome flags `console.error` in `__tests__/`. This causes `pnpm build` to fail before `tsc` even runs.

```typescript
// Wrong — will fail lint
console.error("TEST4 done --merge failed:", doneResult.stderr);

// Correct — assert, don't log
expect(doneResult.exitCode).toBe(0);
expect(doneResult.stderr).toBe("");
```

Run `pnpm lint:fix` if you see lint errors during build. Then rebuild.

### 4. Running `tg done` from repo root instead of worktree

When a task is started with `--worktree`, the entire implementation lifecycle runs FROM the worktree directory:

```bash
# All of this runs from the worktree, not repo root:
cd /path/to/Task-Graph.tg-xxxx
# ... make changes ...
git add -A && git commit -m "task(tg-xxxx): ..."
pnpm tg done <taskId> --evidence "..."
```

Running `tg done` from the repo root when a worktree was used either merges nothing or fails silently.

### 5. Interface fields typed as `string` but Dolt returns `Date`

Always check what Dolt actually returns vs what you typed. Safest interface pattern:

```typescript
interface MyRow {
  started_at: string | Date | null; // explicit about both possibilities
  task_count: number | bigint; // explicit about bigint possibility
}
```

Or just always coerce at use-site: `String(r.started_at)`, `Number(r.task_count)`.

### 6. Forgetting to check `tableExists` for `project` vs `plan`

Grep for any SQL that references `project` or `plan` without a guard. If it doesn't have `tableExists`, it's wrong in at least one environment.

### 8. `(e) => e as AppError` in `ResultAsync.fromPromise` error mapper

Runtime exceptions (TypeError, RangeError, null dereferences) are **not** `AppError`. Writing `(e) => e as AppError` silently miscasts them — the caller receives a malformed object with none of the expected fields.

```typescript
// Wrong — silent miscast
ResultAsync.fromPromise(asyncOp(), (e) => e as AppError)

// Correct — always use buildError in the mapper
ResultAsync.fromPromise(
  asyncOp(),
  (e) => buildError(ErrorCode.UNKNOWN_ERROR, e instanceof Error ? e.message : String(e), e)
)
```

Prefer `.andThen()` chains over async IIFEs wrapped in `ResultAsync.fromPromise` — chains keep all error paths in the Result type system and the error mapper is rarely needed.

### 7. SQL / Type Anti-Patterns (always avoid)

These are checked by the `quality-reviewer` and will cause a FAIL verdict:

1. **Raw SQL template literals for single-table INSERT/UPDATE** — e.g. ``doltSql(`INSERT INTO t VALUES ('${sqlEscape(x)}')`)`` where `query(repoPath).insert(table, data)` or `.update(table, data, where)` would suffice. Reserve `doltSql()` / `query.raw()` for complex multi-join queries and migrations.
2. **Direct `doltSql()` in `src/cli/` files** — route through `query(repoPath)` from `src/db/query.ts`. Use `q.insert()`, `.update()`, `.select()` for simple operations. Use `q.raw(sql)` for complex queries the builder cannot express (joins, upserts, `ON DUPLICATE KEY UPDATE`). Direct `doltSql()` is acceptable only in `src/db/` — it bypasses the layering if called in CLI.
3. **Non-null assertions (`!` postfix)** on values that could be null at runtime without a preceding guard. Use optional chaining (`?.`) or an explicit null-check.
4. **`as any` / `as unknown as T` type coercions** that bypass type safety. Use type guards or Zod validation instead.
5. **Empty catch blocks** — always log or rethrow with context; never swallow errors silently.

---

## Codebase-Specific Gotchas

### The `plan` → `project` table rename

The rename migration runs on schema upgrade. Test environments created with fresh inits before the migration was added have `plan`. Production envs have `project`. The query pattern is:

```typescript
const tableName = (await tableExists(repoPath, "project").then((r) =>
  r._unsafeUnwrap(),
))
  ? "project"
  : "plan";
```

This pattern appears in `status.ts` many times. Copy it, don't diverge from it.

### `dist/` is the integration test execution surface

`src/` is TypeScript source. `dist/` is the compiled output that `tg` actually runs. They are not the same. The on-stop hook rebuilds `dist/` at session end. During a session, run `pnpm build` manually before integration tests.

### Domain docs must have complete `triggers` frontmatter

Every doc listed in `docs/domains.md` must have:

```yaml
---
triggers:
  files: ["src/.../**"]
  change_types: ["create", "modify"]
  keywords: ["term1", "term2"]
---
```

`parseFrontmatterTriggers` returns `null` if `triggers` is absent or malformed. `loadRegistry` returns an error and breaks the doc-skill-registry. Missing `files` or `change_types` won't fail the registry but makes the doc invisible to file-based matching.

### Dolt golden server state

The integration test global setup starts a Dolt SQL server (`dolt sql-server`) pointing to a fresh temporary repo. Tests share this server via connection pool. If the server crashes or loses its `dolt/` database context, tests fail with `ER_BAD_DB_ERROR: database not found: dolt/`. This is an infrastructure flake, not a code bug. Re-run the test suite; it usually passes on retry.

### JSON in done event body

The `done` event's `body` JSON has a well-defined shape:

```json
{
  "evidence": "...",
  "timestamp": "...",
  "tokens_in": 12400, // optional self-report
  "tokens_out": 3200, // optional self-report
  "tool_calls": 47, // optional self-report
  "attempt": 1 // optional self-report
}
```

Read `tokens_in` etc. via `JSON_EXTRACT(e.body, '$.tokens_in')` in SQL. Cast: `CAST(JSON_EXTRACT(...) AS UNSIGNED)`. Null-check: `WHERE JSON_EXTRACT(e.body, '$.tokens_in') IS NOT NULL`.

---

## Testing Patterns

### Always `describe.serial` for integration tests

```typescript
// Correct
describe.serial("my integration test suite", () => {

// Wrong — races on shared Dolt state
describe("my integration test suite", () => {
```

### Direct DB insertion for test setup

Don't set up test state with CLI round-trips if you need precise control. Insert directly:

```typescript
import { jsonObj, now, query } from "../../src/db/query";
const q = query(context.doltRepoPath);
await q
  .insert("event", {
    event_id: uuidv4(),
    task_id,
    kind: "done",
    body: jsonObj({ evidence: "test", tokens_in: 1000 }),
    created_at: now(),
  })
  .then((r) => r._unsafeUnwrap());
```

### `toDatetime()` for controlled timestamps

```typescript
function toDatetime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}
const base = new Date();
const startedAt = toDatetime(new Date(base.getTime() - 200_000)); // 200s ago
```

### Verify JSON shape, not just exit code

```typescript
// Weak
expect(exitCode).toBe(0);

// Strong
expect(exitCode).toBe(0);
const parsed = JSON.parse(stdout) as {
  agent_metrics: Array<{ agent: string; tasks_done: number }>;
};
expect(parsed.agent_metrics.find((r) => r.tasks_done === 2)).toBeDefined();
```

### Extract shared helpers to top of test file

```typescript
// Put repeated setup code at the top, not inline in each beforeAll
async function importPlan(context: TestContext, name: string, tasks: Array<{id: string; content: string}>) { ... }
async function getPlanId(context: TestContext, name: string): Promise<string> { ... }
async function getTaskIds(context: TestContext, planId: string, titles: string[]): Promise<Record<string, string>> { ... }
```

---

## Output Conventions

### Human output: `renderTable` + `boxedSection`

```typescript
import { renderTable } from "./table";
import { boxedSection } from "./tui/boxen";
import { getTerminalWidth } from "./terminal";

const w = getTerminalWidth();
const table = renderTable({
  headers: ["Id", "Title", "Elapsed"],
  rows: data.map((r) => [r.hash_id, r.title, formatElapsed(r.elapsed_s)]),
  maxWidth: w,
  flexColumnIndex: 1, // "Title" column gets remaining space
});
console.log(boxedSection("Plan Summary", summaryLine + "\n" + table));
```

### JSON output: namespaced keys for compound responses

```typescript
// Correct — named keys allow future additions without breaking parsers
console.log(
  JSON.stringify({ agent_metrics: out, token_usage: tokenRows }, null, 2),
);

// Avoid — a flat array can't be extended without breaking all parsers
console.log(JSON.stringify(out, null, 2));
```

### Commit message format

```text
task(<hash_id>): <brief description>
```

Example: `task(tg-d46bfc): trim tg context output to spec + relevant docs + immediate blockers`

The hash ID ties the commit to the task graph entry. Required for all task commits.

### Stale Dolt migrations

Migrations in `src/db/migrate.ts` are idempotent. Each uses a `tableExists()` or `columnExists()` guard before applying. If a migration fails with `ALTER TABLE ... DUPLICATE COLUMN`, it means the guard is missing or the migration was already partially applied. Fix the guard; never delete or skip migrations.

---

## Worktree Workflow

### The complete implementer lifecycle

```bash
# Step 1: Start (orchestrator passes WORKTREE_PATH)
pnpm tg start <taskId> --agent implementer-N --worktree
# Get the path
pnpm tg worktree list --json  # find path for this task's branch

# Step 2: Switch to worktree
cd /path/to/Task-Graph.tg-<hash>
# All subsequent commands run from here

# Step 3: Implement, then commit
git add -A && git commit -m "task(tg-<hash>): <description>"

# Step 4: Done
pnpm tg done <taskId> --evidence "implemented; no test run"
# Orchestrator then runs: pnpm tg done <taskId> --merge  (or wt merge)
```

### Recovering lost worktree commits

If a worktree was cleaned up before merging, the commits are dangling:

```bash
git fsck --lost-found 2>&1 | grep "dangling commit"
# Shows commit hashes — examine each:
git show <hash> --stat
# Cherry-pick the relevant ones:
git cherry-pick <hash1> <hash2> ...
```

### Check which worktrees are active

```bash
pnpm tg worktree list --json
# or
git worktree list
ls /path/to/parent/ | grep "Task-Graph\."
```

---

## Reference: File Locations

| What                                    | Where                                 |
| --------------------------------------- | ------------------------------------- |
| CLI command implementations             | `src/cli/<command>.ts`                |
| CLI entry point / command registry      | `src/cli/index.ts`                    |
| Query builder                           | `src/db/query.ts`                     |
| Migrations + tableExists                | `src/db/migrate.ts`                   |
| Table rendering                         | `src/cli/table.ts`                    |
| Box sections                            | `src/cli/tui/boxen.ts`                |
| Shared CLI utils (rootOpts, readConfig) | `src/cli/utils.ts`                    |
| Error codes                             | `src/domain/errors.ts`                |
| SQL escaping                            | `src/db/escape.ts`                    |
| Integration test utilities              | `__tests__/integration/test-utils.ts` |
| Domain docs                             | `docs/<slug>.md`                      |
| CLI reference                           | `docs/cli-reference.md`               |
| Schema reference                        | `docs/schema.md`                      |
| Testing patterns                        | `docs/testing.md`                     |
