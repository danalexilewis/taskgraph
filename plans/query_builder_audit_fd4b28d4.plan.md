---
name: Query builder audit
overview: "Audit confirmed portfolio.ts and other files already use the query builder where appropriate. A few files need cleanup: remove dead imports in edge.ts, fix missing escaping in invariants.ts, and optionally refactor graph-data.ts to use q.select instead of hand-built SQL with sqlEscape."
todos: []
isProject: false
---

# Query builder usage audit and fixes

## Summary

All command and domain code that touches the DB already goes through the thin query builder (`query(repoPath)` and `q.insert` / `q.update` / `q.select` / `q.count` / `q.raw`). The only direct `doltSql` user left is [tools/taskgraph/src/db/migrate.ts](tools/taskgraph/src/db/migrate.ts), which is correct—migrations run DDL (e.g. `CREATE TABLE`) that the builder does not support.

**portfolio.ts** uses the builder correctly: it calls `query(config.doltRepoPath)` and runs analytics via `q.raw()` with multi-table JOINs, GROUP BY, and HAVING. The only user input in those queries is `minFeatures` (an integer from `parseInt`), so there is no string interpolation risk. No change needed.

Findings that do need changes:

- **edge.ts** — Uses `query()` in code but does not import it; still imports unused `doltSql` and `sqlEscape`.
- **invariants.ts** — Uses `q.raw()` with a template literal that embeds `taskId` without escaping (`WHERE e.to_task_id = '${taskId}'`), which is a SQL injection risk.
- **graph-data.ts** — Uses `q.raw()` for the tasks query and builds the WHERE clause with manual `sqlEscape(planId)` and `sqlEscape(featureKey)`. Safe but duplicates escaping; can be refactored to `q.select()` to rely on the builder’s escaping.

---

## 1. [tools/taskgraph/src/cli/edge.ts](tools/taskgraph/src/cli/edge.ts)

- **Issue**: Line 36 uses `query(config.doltRepoPath)` but there is no `import { query } from "../db/query"`. The file still imports `doltSql` and `sqlEscape`, which are unused (all DB access goes through `q.select` and `q.insert`).
- **Change**: Add `import { query } from "../db/query";`. Remove `import { doltSql } from "../db/connection";` and `import { sqlEscape } from "../db/escape";`.

---

## 2. [tools/taskgraph/src/domain/invariants.ts](tools/taskgraph/src/domain/invariants.ts)

- **Issue**: In `checkRunnable`, the raw SQL string embeds `taskId` unescaped:

  ```ts
  WHERE e.to_task_id = '${taskId}'
  ```

  So the builder is used for execution (`q.raw()`), but the value is not safely escaped.

- **Change**: Import `sqlEscape` from `"../db/escape"` and use it in the template: `'${sqlEscape(taskId)}'`. Alternatively, add a small helper in query.ts that accepts a raw SQL template and a list of string parameters to escape and substitute (if you prefer not to use sqlEscape in domain code). Minimal fix is to use `sqlEscape(taskId)` in the existing template.

---

## 3. [tools/taskgraph/src/export/graph-data.ts](tools/taskgraph/src/export/graph-data.ts) (optional)

- **Current**: Builds `tasksQuery` with string concatenation and `sqlEscape(planId)` / `sqlEscape(featureKey)`, then runs it via `q.raw(tasksQuery)`.
- **Optional improvement**: Replace the custom tasks query with `q.select()` and the builder’s `where` so escaping is centralized. For example:
  - If only `planId` is set: `q.select(..., { where: { plan_id: planId } })`.
  - If only `featureKey` is set: `q.select(..., { where: { feature_key: featureKey } })`.
  - If both: `q.select(..., { where: { plan_id: planId, feature_key: featureKey } })`.
  - Columns are already a simple list: `columns: ["task_id", "title", "status"]`.
- **Benefit**: Single place for escaping (query.ts), no direct `sqlEscape` in graph-data. No change to behavior.

---

## 4. Files that require `q.raw()` and need no change

These use the query builder for execution and use `q.raw()` for queries that cannot be expressed with `q.select()`:

- **[tools/taskgraph/src/cli/portfolio.ts](tools/taskgraph/src/cli/portfolio.ts)** — Multi-table JOINs, GROUP BY, HAVING; only numeric `minFeatures` is interpolated. Correct as-is.
- **[tools/taskgraph/src/cli/next.ts](tools/taskgraph/src/cli/next.ts)** — Complex “next tasks” query; appropriate for `q.raw()`.
- **[tools/taskgraph/src/cli/show.ts](tools/taskgraph/src/cli/show.ts)** — Multiple raw queries for task detail, blockers, dependents, events; appropriate for `q.raw()`.
- **[tools/taskgraph/src/db/migrate.ts](tools/taskgraph/src/db/migrate.ts)** — DDL only; must keep using `doltSql` directly.

---

## Verification

- Run unit tests: `npm test` from `tools/taskgraph`.
- Run e2e: `npm run test:e2e` (after fixing portfolio.ts build if needed).
- Run integration: `npm run test:integration`.
- Manually run `tg edge add ...` to confirm edge.ts runs with the new import and without doltSql/sqlEscape.
