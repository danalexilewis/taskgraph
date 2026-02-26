---
name: Risk Assessment Report
overview: Cross-plan risk assessment (assess-risk skill). Rates entropy, surface area, backwards compat, reversibility, complexity concentration, testing surface, performance risk, blast radius; lists file overlaps, recommended execution order, and mitigations.
---

**Source:** `pnpm tg crossplan summary --json` + plan files under `plans/` (2026-02-26).
**Reviewed:** 2026-02-26 — corrected against actual DB state and codebase.

---

## Inventory

**25 plans in DB.** 12 fully done, 1 empty, **12 have outstanding todo tasks** (66 total). The report focuses on the 10 active todo plans plus notes on DB-stale plans.

| Status                  | Plans                                                                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **All tasks done (12)** | Sharpen Orchestrator, Cursor Plan Import, Cursor Sub-Agent Specialization, Export Markdown, Plan Import Robustness, Project Rules, Publish to npm, Restructure package, Rich Planning, Task Dimensions, tg plan list, Agent Sync                                          |
| **All tasks todo (10)** | Short Hash (8), Context Budget (7), Dolt Branch (7), External Gates (6), Git Worktree (6), TaskGraph MCP (6), Two-Stage Review (6), Task Templates (6), Dolt Replication (5), Persistent Agent Stats (4)                                                                  |
| **Code done, DB stale** | Meta-Planning Skills (5 todo in DB but crossplan.ts, assess-risk skill, pattern-tasks skill, docs, and tests all exist in codebase — needs `tg done --force`); No Hard Deletes & DAL (plan not in DB at all, but cancel.ts, connection guards, triggers, tests all exist) |
| **Multi-Agent Centaur** | 1 task done, 0 todo — effectively complete                                                                                                                                                                                                                                |
| **Empty**               | update docs (0 tasks)                                                                                                                                                                                                                                                     |

**Plan files not in DB** (never imported or lost during restore): Cursor Agent CLI Dispatch, Deps/Import/Stale/Onboarding, Post-Execution Reporting, plus older fix/build plans (Docs Tests Neverthrow, Fix Failing Tests, Fix Neverthrow TS Errors, Fix Remaining tsc Errors, Fix Test Dolt Integration, Fix Test File Errors, Query Builder Audit, Thin SQL Query Builder, Task Graph Implementation, run_dolt_backed_tests, resolve_type_errors_taskgraph). Not assessed.

---

## Summary

| Plan / Scope                    | Entropy | Surface Area | Backwards Compat | Reversibility | Complexity Concentration | Testing Surface | Performance Risk | Blast Radius | Overall |
| ------------------------------- | ------- | ------------ | ---------------- | ------------- | ------------------------ | --------------- | ---------------- | ------------ | ------- |
| Short Hash Task IDs (8 todo)    | H       | H            | M                | M             | **H**                    | M               | L                | M            | **H**   |
| Dolt Branch Per Agent (7)       | M       | M            | L                | M             | **H**                    | M               | M                | M            | **M-H** |
| Git Worktree Isolation (6)      | M       | M            | L                | M             | **H**                    | M               | L                | M            | **M-H** |
| External Gates (6)              | M       | M            | L                | M             | **M**                    | M               | L                | M            | M       |
| Context Budget & Compaction (7) | M       | M            | L                | L             | **M**                    | M               | L                | L            | M       |
| Two-Stage Review (6)            | L       | L            | L                | L             | **M**                    | L               | L                | M            | **L-M** |
| TaskGraph MCP Server (6)        | M       | M            | L                | L             | **M**                    | M               | L                | M            | M       |
| Persistent Agent Stats (4)      | L       | L            | L                | L             | L                        | M               | L                | L            | **L**   |
| Dolt Replication (5)            | M       | M            | L                | M             | **M**                    | M               | L                | L            | M       |
| Task Templates (Formulas) (6)   | M       | M            | L                | M             | M                        | M               | L                | L            | M       |

_L = Low, M = Medium, H = High. **Bold** = key driver for overall risk._

### Changes from initial auto-generated assessment

- **Two-Stage Review** downgraded from M to **L-M**: it only touches agent markdown and dispatch rules, no production code. Entropy and Surface Area both L.
- **Persistent Agent Stats** downgraded from M to **L**: it's a new self-contained command (stats.ts), touches only index.ts and docs. No schema changes, no shared code.
- **Dolt Branch Per Agent** Performance Risk upgraded L to **M**: adding branch/merge to start/done is on the critical path of every task lifecycle.
- **Restructure package, Rich Planning, Sharpen Orchestrator, Meta-Planning Skills** removed from active risk table — their work is done (even if DB state is stale). They no longer contribute active risk.
- **Multi-Agent Centaur** removed (1 task, already done).
- Added **Inventory** section so status is clear vs the DB.

---

## Cross-Plan Interactions

### File overlaps

- **docs/cli-reference.md** — 10 plans touch it. Highest concentration; doc-only but merge churn and consistency risk.
- **src/cli/index.ts** — 6 plans (Git Worktree, TaskGraph MCP, Persistent Agent Stats, External Gates, Meta-Planning Skills, Dolt Replication). Command registration; sequential ordering recommended.
- **src/cli/start.ts** and **src/cli/done.ts** — 3 plans: **Git Worktree Isolation**, **Dolt Branch Per Agent**, **Short Hash Task IDs**. These must not run in parallel.
- **.cursor/rules/subagent-dispatch.mdc** — 2 remaining todo plans: **Git Worktree Isolation**, **Two-Stage Review**. Do Two-Stage first (review flow), then Git Worktree (dispatch additions).
- **src/cli/context.ts** — 2 plans: **Context Budget and Compaction**, **Short Hash Task IDs**. Either order works; Context Budget is self-contained.
- **src/db/migrate.ts** and **src/domain/types.ts** — 2 plans: **External Gates**, **Short Hash Task IDs**. Serialize migrations.
- **.taskgraph/config.json** — 3 plans: Context Budget, Dolt Branch, Dolt Replication. Additive keys; low conflict.

### Domain/skill clusters

- **cli** — 12 plans, 26 tasks. Batch "add new command" work to reduce context switching.
- **documentation-sync** — 11 plans. Do doc passes after related code is stable.
- **cli-command-implementation** — 10 plans. Short Hash's resolver benefits all subsequent CLI work.
- **integration-testing** — 10 plans. Each plan should use isolated Dolt repos in tests.

### Impact on Complexity Concentration and ordering

- **Short Hash Task IDs** has the widest touch surface (13+ files). Doing it first reduces future merge conflicts and gives other plans the `resolveTaskId` utility.
- **start/done stack**: Dolt Branch and Git Worktree both modify start.ts/done.ts. Run one to completion before the other.
- **subagent-dispatch.mdc**: Two-Stage Review first (review flow changes), then Git Worktree (worktree dispatch).
- **index.ts and cli-reference.md**: Serialize command registration and doc updates across plans.

---

## Overall Risk

**Overall risk: Medium**, trending Medium-High for the start/done stack. Short Hash Task IDs is the **highest individual risk** (H) due to broad CLI and schema surface. Dolt Branch and Git Worktree are **M-H** because they share start.ts/done.ts with each other and Short Hash. The remaining 7 plans are solidly Medium or lower — most are additive (new commands, new files) with no breaking changes.

Completed plans (Restructure, Rich Planning, Task Dimensions, etc.) no longer contribute active risk.

---

## Mitigation Strategies

- **Short Hash Task IDs**: Implement resolver and schema/migration first; update CLI commands in a single pass. Run integration tests after all command updates. Consider config toggle for short-hash display until stable.
- **Dolt Branch / Git Worktree**: Run one plan fully before starting the other. Avoid parallel edits to start.ts/done.ts.
- **Two-Stage Review before Git Worktree**: Complete Two-Stage Review (spec/quality agents + dispatch rule) before Git Worktree's dispatch changes.
- **External Gates vs Short Hash**: Serialize migrations and type changes — run one plan's schema work before the other.
- **index.ts and cli-reference.md**: Serialize command additions; use small commits for easy conflict resolution.
- **Testing**: Each plan's integration tests should use isolated Dolt repos to avoid cross-test pollution.

---

## Key Risks to Monitor

1. **Merge conflicts on start.ts, done.ts, and subagent-dispatch.mdc** — 3 plans and 2 plans respectively; enforce ordering.
2. **Short Hash collision and resolver behavior** — Hash space (6 hex chars = 16M values) and ambiguity handling.
3. **Dolt Branch merge conflicts and orphan branches** — Monitor merge success; add cleanup visibility.
4. **docs/cli-reference.md consistency** — Many plans update it; do a final consistency pass.
5. **DB state drift** — Meta-Planning Skills and No Hard Deletes are done in code but stale/missing in DB. Fix with `tg done --force` and re-import.

---

## Prioritized Risk Summary & Recommended Execution Order

### Immediate: fix DB state

- **Meta-Planning Skills**: Mark 5 tasks done (`tg done <id> --force --evidence "completed previously"`). Code, skills, and tests all exist.
- **No Hard Deletes & DAL**: Re-import from `plans/26-02-26_no_hard_deletes_dal.md` and mark all 7 tasks done. Code exists and is tested.

### Phase 1: Foundation / low conflict

- **Two-Stage Review** (6 tasks, L-M risk) — Agent markdown and dispatch rule only. No production code. Do before Git Worktree's dispatch changes.
- **Persistent Agent Stats** (4 tasks, L risk) — Self-contained new command. Can run in parallel with Two-Stage Review (no file overlap).

### Phase 2: High concentration (serialize)

- **Short Hash Task IDs** (8 tasks, H risk) — Do early. Establishes resolver and hash_id column. Reduces future conflicts on context, start, done, and CLI commands.
- **Dolt Branch Per Agent** (7 tasks, M-H risk) — After Short Hash. Completes start/done branching story. Not in parallel with Git Worktree.
- **Git Worktree Isolation** (6 tasks, M-H risk) — After Dolt Branch and Two-Stage Review. Subagent-dispatch changes sit on top of the new review flow.

### Phase 3: Medium risk, independent

- **External Gates** (6 tasks, M) — Schema and CLI. Avoid parallel migration work with Short Hash.
- **Context Budget and Compaction** (7 tasks, M) — Self-contained (context.ts, config, token-estimate). Can run after or alongside plans that don't touch context.ts.
- **TaskGraph MCP Server** (6 tasks, M) — New surface (src/mcp/). Register in index after other command additions if possible.
- **Dolt Replication** (5 tasks, M) — New sync command and config. Lower conflict if done after Dolt Branch (config overlap).
- **Task Templates (Formulas)** (6 tasks, M) — New command and schema. Independent of most other plans.

### Phase 4: Cleanup

- Batch **doc updates** across cli-reference.md and schema.md after code is stable.
- Cancel or archive remaining empty/stale plans (update docs).
