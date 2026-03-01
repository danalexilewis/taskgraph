# Task Graph DB Migration Fix

**Date:** 2026-03-01  
**Scope:** Fix migration failure and status command failure after plan→project rename in the task graph Dolt schema.  
**Produced by:** Orchestrator (direct investigation and implementation).

---

## Scope

The CLI was failing on every command that triggered migrations: first with "ALTER TABLE `plan` ADD COLUMN ..." and, after that path was corrected, with "SELECT ... FROM `plan` WHERE status = 'done'". The root cause was that the schema had been migrated to rename table `plan` to `project`, but two pieces of logic still assumed `plan` existed.

---

## Files Examined

| File                | Role                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/db/migrate.ts` | Migration chain, `applyPlanRichFieldsMigration`, `applyPlanToProjectRenameMigration`, `ensureMigrations` |
| `src/cli/index.ts`  | Pre-action hook that runs `ensureMigrations`                                                             |
| `src/cli/status.ts` | Status queries using `bt("plan")` (i.e. `` `plan` ``)                                                    |
| `.cursor/memory.md` | Existing migration idempotency notes                                                                     |

---

## Root Cause Analysis

1. **Rich-fields migration running against missing table**  
   `applyPlanRichFieldsMigration` checks whether the `plan` table has a `file_tree` column via `planColumnExists(repoPath, "file_tree")`, which queries `information_schema.COLUMNS` for `TABLE_NAME = 'plan'`. After the rename, only `project` exists, so the check returns false. The migration then runs `ALTER TABLE plan ADD COLUMN ...`, which fails because `plan` no longer exists.

2. **Application code still referencing `plan`**  
   Status and other commands build SQL against `` `plan` `` (e.g. `SELECT COUNT(*) FROM \`plan\` WHERE status = 'done'`). After the rename, the table is `project`, so those queries fail with "table doesn't exist" (or equivalent).

---

## Hypothesis Evidence

- Reproducer: `pnpm build && pnpm tg status` → "Migration failed: Dolt SQL query failed: ALTER TABLE \`plan\` ..." then, after fixing that path, "Error fetching status: Dolt SQL query failed: SELECT ... FROM \`plan\` ...".
- Migration order in `ensureMigrations`: `applyPlanRichFieldsMigration` runs first; `applyPlanToProjectRenameMigration` runs later and renames `plan` → `project`. So on a DB that had already completed all migrations, only `project` exists.
- `status.ts` uses `bt("plan")` in multiple queries (completedPlansSql, activePlansSql, nextSql, etc.); no references to `project` in query construction.

---

## Changes Implemented

| Change                                | Purpose                                                                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **applyPlanRichFieldsMigration**      | Before altering `plan`, call `tableExists(repoPath, "project")`. If `project` exists, skip (rich columns already on `project` from when they were on `plan` before rename).               |
| **viewExists()**                      | New helper querying `information_schema.VIEWS` for a given view name.                                                                                                                     |
| **applyPlanToProjectRenameMigration** | At end of migration, run `CREATE OR REPLACE VIEW plan AS SELECT * FROM project` so new installs get the compatibility view in the same commit.                                            |
| **applyPlanViewMigration**            | New idempotent migration: if `project` exists and view `plan` does not, create view `plan` AS SELECT \* FROM `project`. Handles DBs that already had `project` before the view was added. |
| **ensureMigrations**                  | Run `applyPlanViewMigration` after `applyPlanToProjectRenameMigration`.                                                                                                                   |
| **.cursor/memory.md**                 | Document rich-fields skip when project exists and the plan view compatibility pattern.                                                                                                    |

---

## Application code switched to `project` (2026-03-01 follow-up)

Application code now uses the `project` table directly so the stack is consistent and the compatibility view is no longer required for queries:

- **status.ts**: All `bt("plan")` → `bt("project")`.
- **next.ts, show.ts**: `JOIN \`plan\``→`JOIN \`project\``.
- **cancel.ts**: `q.select` / `q.update` table `"plan"` → `"project"`.
- **import.ts, plan.ts, template.ts, context.ts**: `q.select` / `q.insert` / `q.update` table `"plan"` → `"project"`.
- **crossplan.ts**: All `JOIN \`plan\``and`q.select("plan", ...)`→`project`.
- **mcp/tools.ts**: `JOIN \`plan\``and`q.select("plan", ...)`→`project`.
- **export/markdown.ts**: `q.select<PlanRow>("plan", ...)` → `"project"`.
- **domain/plan-completion.ts**: Already used `q.update("project", ...)`.
- **connection.ts**: `PROTECTED_TABLES` includes `"project"` (view `plan` still protected for safety).

Column names (`plan_id` in task/decision, `plan_title` as alias) are unchanged. Build and typecheck pass.

## Gaps / Not Done

- Dolt support for `information_schema.VIEWS` was assumed (MySQL-compatible); if a deployment uses an engine without it, `viewExists` would need a fallback (e.g. `TABLES` with `TABLE_TYPE = 'VIEW'`).

---

## Summary

Two migration bugs were fixed: (1) skipping the plan rich-fields migration when the table has already been renamed to `project`, and (2) introducing a compatibility view `plan` → `project` so all existing SQL that references `plan` continues to work. After these changes, `pnpm tg status` and the migration chain complete successfully on a DB that had already applied the plan→project rename.
