# Obsolete projects cleanup

**Date:** 2026-03-03

## Summary

Reviewed outstanding (draft) TG projects; cancelled 7 as obsolete, empty, or superseded.

## Projects cancelled

| Project | Reason |
|--------|--------|
| Agent field and domain-to-docs rename (draft) | Obsolete duplicate; completed project with same name exists (8 tasks done) |
| Fix Test File Errors | Empty draft; no tasks |
| Query builder audit | Empty draft; no tasks |
| run_dolt_backed_tests | Empty draft; no tasks |
| update docs | Empty draft; no tasks |
| Git Worktree Isolation | Work done elsewhere; per-plan worktrees and Worktrunk already implemented |
| Status Dashboard and Focused Domain Views | Superseded by Dashboard Improvements (26-03-03); remaining work can be folded into that plan |

## Commands run

```bash
pnpm tg cancel 20b0e6b3-46a3-4281-9389-c50c50356573 --reason "Obsolete duplicate; completed project with same name exists (8 tasks done)"
pnpm tg cancel 6371c7f8-01ed-4c4b-a702-f94cef3f6029 --reason "Empty draft; no tasks"
pnpm tg cancel 44e81d81-9df7-46e6-ae0c-917e209f090f --reason "Empty draft; no tasks"
pnpm tg cancel 11346993-213e-4264-9908-f221ff87489a --reason "Empty draft; no tasks"
pnpm tg cancel 5cbf50e9-e7c1-40fc-adc2-78470dc6a3e3 --reason "Empty draft; no tasks"
pnpm tg cancel 16e51429-cb51-4fe0-864e-da7ee249cecf --reason "Work done elsewhere; per-plan worktrees and Worktrunk already implemented"
pnpm tg cancel febb3e44-43f7-4b50-b2af-d4b827643332 --reason "Superseded by Dashboard Improvements (26-03-03); remaining work can be folded into that plan"
```

All returned "Project ... abandoned."

## Remaining draft projects (kept)

- **Bulk context for tg context** — 5 todo; plan `26-03-03_bulk-context.md`
- **CQRS Write Queue for Agent I/O** — 1 todo; plan `26-03-03_cqrs_write_queue_agents.md`
- **Dashboard Improvements** — 4 todo, 2 blocked; plan `26-03-03_dashboard_improvements.md`
- **Short Hash Task IDs** — 2 todo, 6 done
- **Context Budget and Compaction** — 3 todo, 4 done
- Cheap Gate Typecheck Hygiene, Dolt Branch Per Agent, Dolt Replication, External Gates, Meta-Planning Skills, Persistent Agent Stats, Tactical Escalation Ladder, Task Templates (Formulas), TaskGraph MCP Server — left for prioritisation review.
