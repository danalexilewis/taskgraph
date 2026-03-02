# Reprioritise report

**Date:** 2026-03-02  
**Basis:** Meta cross-plan analysis (execution tiers + blocks). See `reports/26-03-02_meta_crossplan_analysis.md`.

---

## Are these the right projects?

**Yes, with ordering.** The current active/draft set is appropriate: gate health (Gate Full Triage, Integration Test Isolation), refactors (Benchmark Schema, Default Daily, Initiative-Aware, Per-plan Worktree, etc.), and validators (Doc Review, CLI Smoke, Custom Benchmark). The meta analysis already added **blocks** so that the Gate Full Triage fix (tg-95e850) runs before any other plan’s gate:full task. Reprioritising **by execution tier** ensures agents pick gate-health work first, then refactors, then validators, so gate:full runs see a green suite and validators run against a stable CLI/docs surface.

---

## Prioritised project list

Order follows meta Tier 1 → Tier 2 → Tier 3 → Tier 4. Projects with no runnable work are listed after those with runnable work within the same tier.

### Tier 1 — Gate health (fix tests / isolation first)

1. **Gate Full Triage** — Fix pre-existing status.test.ts failures; unblocks all other plans’ gate:full tasks.
2. **Integration Test Isolation Improvements** — Test infra and isolation; reduces flake for everyone.
3. **Gate Full Remediation** — (All done; kept for reference.) Historical gate fixes.

### Tier 2 — Gate:full verifications (after Tier 1 is green)

4. **Gate Full Root Cause Fixes** — Has runnable “Run gate:full” task; runs after triage/remediation.
5. _(Other plans’ gate:full tasks — Default Daily, Benchmark Schema, Per-plan Worktree, Initiative-Aware, Git Workflow — are blocked by tg-95e850 and become runnable only after that fix.)_

### Tier 3 — Schema / CLI / core refactors

6. **Perf Audit Remediation — Test Infra, Schema Indexes, CLI Speed** — Test infra and perf; one runnable.
7. **Report Follow-up Integration Tests done-force Stash** — Integration test and stash fixes; 3 runnable.
8. **Git Workflow Tidy-Up** — Worktree/done/merge behaviour; 5 runnable.
9. **Strategic Planning Implementation** — Plan format, analyst doc; 2 runnable.
10. **Hivemind Initiative** — Initiative and context; 3 runnable.
11. **Initiative-scoped analyst context** — Analyst template and context; 2 runnable.
12. **Initiative-Aware Plan Ingestion** — Parser/import/initiative; 3 runnable (coordinate with Strategic Planning on parser/import per meta notes).
13. **Default Daily Initiative** — Initiative and daily default; 2 runnable (gate:full blocked by tg-95e850).
14. **Benchmark Schema and Import** — Schema and import; 1 blocked (gate:full blocked by tg-95e850).
15. **Per-plan Worktree Model** — Worktree model; 1 blocked.
16. **Performance Intelligence** — Perf tooling; 1 blocked.
17. **AgentDex and Agents (discovered)** — Agent dex schema and CLI; 3 runnable.
18. **Git Merge Recording - Tags and Branch History** — Merge/tag recording; 2 runnable.

### Tier 4 — Validators (after Tier 3 stabilises)

19. **Doc Review Benchmark** — Review cli-reference and benchmarking docs; 3 runnable (note: run after CLI/schema-heavy plans).
20. **CLI Smoke Benchmark** — Smoke-test CLI; currently blocked.
21. **Custom Benchmark Suite (Option C)** — Custom benchmark structure; 1 runnable.

### Other (draft, no runnable or placeholder)

22. **2026-03-02 grouped commit (1)** — chore(cursor) parallel dispatch and clean-up.
23. **2026-03-02 grouped commits (7)** — CLI cancel, db, docs, cursor, style, test.
24. **DAL Query Cache**, **Sub-Agent Execution Performance**, **tg server - Dolt SQL Server Lifecycle Command**, **Historical Evolve Sweep** — Active but all tasks done; no reorder needed.
25. **Work Self-Orientation and Micro-Cluster Formation** — Done.

---

## Ready count

- **Before:** 33 runnable (from `tg next --json --limit 50`).
- **Target:** ≥ 10.
- **After:** 33 runnable (no change).

---

## Actions taken (2026-03-02 update)

- **CLI added:** `tg plan set-priority <planIdOrTitle> <priority>` (higher number = shown first in `tg status` and `tg next`).
- **Priorities applied:** All 21 projects from the prioritised list above were updated in the task graph (priority 21 = Gate Full Triage, down to 2 = Custom Benchmark Suite). One duplicate "Perf Audit Remediation…" project was set to 0. Active projects now sort by this order in the dashboard and in `tg next`.
- **Build fix:** `enterAlternateScreen` / `exitAlternateScreen` were added to `src/cli/terminal.ts` so the build succeeds (they were referenced by status.ts but missing).
