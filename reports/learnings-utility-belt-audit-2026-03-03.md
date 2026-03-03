# Learnings → Utility belt audit

**Date:** 2026-03-03  
**Scope:** All learnings in `.cursor/agents/*.md` (implementer, quality-reviewer, README) compared to `.cursor/agent-utility-belt.md`. For each learning only in agent files, recommend whether it should also live in the utility belt so all agents see it.

**Rule of thumb:** If the learning applies to **any agent** that might touch that area (code, tests, docs, review, planning), it belongs in the belt. If it is **role-specific** (e.g. "implementers do not run tests", "reviewers flag X"), keep it only in that agent file.

---

## Already in utility belt (no action)

These patterns are already in the belt; implementer/quality-reviewer entries are redundant for cross-cutting use (agents get them via the belt when it’s injected).

- Result/error: `okAsync`, `.map()` misuse, `(e) => e as AppError`, `(e as Error).message`, cause in `buildError`, IIFE + throw
- SQL/DB: batch CLI multi-ID, `ResultAsync.combine` for parallel queries, Dolt FK + CREATE INDEX, ensureMigrations probe batching, execa DOLT_DISABLE_UPDATE_CHECK, doltCommit guard, dolt sql-server stdio/exit
- Caching: cache key normalization, invalidateTable vs clear, probe functions use cache or don’t accept, repeated reads shared cache, TTL passthrough, cachedProbe helper, cache tests assert behavior
- Refactoring: rename collateral deletion, legacy comment, clean-while-here deletion, squash scope verification
- CLI: rename + grep agents/rules, visual regression cli-tables, dashboard-format assertion, new flags → templates, extract domain logic, withConfig, double readConfig
- Test infra: SIGTERM -pid, try/finally after spawn, PID file, pgrep, process.env delete, gate:full baseline
- Types: fixed JSON contract no index signature
- Merge: docs combine both, code semantic merge
- Worktree: tg start --force recovery, env-var activation set all vars

---

## Only in agent file(s) — recommend ADD to utility belt

| # | Source | One-line summary | Why add to belt |
|---|--------|------------------|------------------|
| 1 | implementer | Single-table INSERT/UPDATE in CLI/db: use query(repoPath).insert/update; raw SQL only for upserts, complex WHERE, migrations. | Anyone writing or reviewing CLI/db code (implementer, reviewer, documenter) should use the builder when possible. |
| 2 | implementer | Sync helpers that can fail: return Result/ResultAsync, never throw; use ok()/err(buildError()). | Any agent adding or changing helpers used inside Result chains (implementer, reviewer, fixer). |
| 3 | implementer | Log only at CLI boundary (inside result.match()); no console.error in domain/plan-import before throw. | Applies to anyone touching error paths (implementer, reviewer, documenter). |
| 4 | implementer | q.raw() for SQL the builder can’t express; never call doltSql() directly from src/cli/. | Layering rule; anyone editing CLI or db layer benefits. |
| 5 | implementer | Worktree: always `git add -A && git commit -m "task(<id>): ..."` before `tg done`; both worktree path and `--merge` required. | Implementers and orchestrators; prevents lost work and orphan commits. |
| 6 | implementer | tg done without --merge in worktree context: commits become orphaned, excluded from plan-merge. | Same as above; all execution agents. |
| 7 | implementer | When multiple code paths resolve the same concept (e.g. ID/title), use a single shared resolver; do not add a second with different semantics. | General design rule (initiative, plan_id, etc.); implementer, reviewer, planner. |
| 8 | implementer | Resolve options (e.g. --initiative) by ID or title via shared resolver before persisting; do not store raw CLI string in DB. | Validation/persistence rule; any agent touching CLI options and DB. |
| 9 | implementer | When one piece of data is computed in multiple places, compute in one helper and pass in; avoids duplication and drift. | General (dashboard section data, initiative WHERE fragment); implementer, reviewer. |
| 10 | implementer | User-supplied SQL filters (plan_id, domain, etc.): prefer parameterized queries where the API supports them; sqlEscape only when it doesn’t. | Security and correctness; anyone touching queries with user input. |
| 11 | implementer | Functions that return T \| null for "unavailable": document null and require callers to handle, or return Result and treat unavailability as an error path. | API design; implementer, reviewer, documenter. |
| 12 | implementer | CLI helpers that resolve options and can fail: either document as CLI boundary (allow process.exit) or return Result and unwrap in the command action. | Consistency; anyone adding CLI helpers. |
| 13 | quality-reviewer | Redundant `as T[]` after q.select<T>() masks type mismatches; remove the extra cast. | Type safety; implementer and reviewer. |
| 14 | quality-reviewer | `if (result.isErr()) { return fallback; }` with no log: silent swallow. At least log; better propagate the error. | Result handling; any agent writing or reviewing Result use. |
| 15 | quality-reviewer | Mutable flag set inside .match() error callback then checked imperatively (e.g. let failed = false; r.match(..., () => { failed = true })): mixed paradigm. Use shape-check on result or chained Result. | Result style; implementer, reviewer. |
| 16 | quality-reviewer | TUI/refresh: don’t use empty catch or empty err callback for render/initial fetch; log or surface errors. | Error visibility; anyone touching TUI or refresh paths. |
| 17 | quality-reviewer | Registry/loader that skips invalid entries: log each skipped file and reason so operators know what was omitted. | Observability; implementer, reviewer. |
| 18 | quality-reviewer | When a doc lists "key functions (do not remove)" for an area (e.g. dashboard styling), verify presence of those functions after changes to that area. | Prevents silent UI/behavior breakage; implementer, reviewer, documenter. |
| 19 | README (agents) | Always read and follow suggested_changes as a starting point; deviate only when the suggestion is clearly wrong. | All agents that execute tasks (implementer, fixer, documenter). |
| 20 | README (agents) | Run the project linter before completing the task. | All agents that edit code. |

---

## Only in agent file(s) — recommend KEEP in agent file only

| # | Source | One-line summary | Why not in belt |
| 1 | implementer | Do not run tests; tests are added and run in dedicated plan-end tasks. | Implementer contract only; other agents don’t have this constraint. |
| 2 | implementer | getSchemaFlags / status tableExists should pass same QueryCache so probes deduplicated. | Codebase-specific wiring (status-cache, dashboard); not a general pattern. |
| 3 | quality-reviewer | "Flag X" / "direct to Y" style entries. | Reviewer’s job is to flag; the underlying rule is in belt or implementer. Where the rule is already in belt, no duplicate. |

---

## Summary

- **Add to belt (20 items):** Single-table SQL → query builder, sync helpers → Result, log at boundary only, q.raw vs doltSql layering, worktree commit + tg done --merge, orphan commits without --merge, single shared resolver, resolve options before persist, compute-once pass-in, parameterized SQL for user input, T | null document or Result, CLI helpers Result or boundary, redundant as T[], no silent Result swallow, no mutable flag in .match(), TUI/registry log errors/skips, verify "do not remove" functions after changes, follow suggested_changes, run linter before done.
- **Keep agent-only (3):** Do not run tests (implementer), getSchemaFlags + status cache (implementer), reviewer "flag" phrasing (quality-reviewer).

If you confirm, the 20 recommended items will be added to the utility belt under the appropriate sections (Result/error, SQL/DB, CLI, Refactoring, Types, Test infrastructure, Worktree, and one short "Task execution" or "All agents" block for suggested_changes + linter).
