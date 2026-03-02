# Blocked task triage report

**Date:** 2026-03-02

## 1. Summary

- **Blocked tasks:** 55
- **Total tasks (excl. canceled):** 200
- **Blocked share:** 27.5%

## 2. Per blocked task

| Task ID (hash) | Title | Project | Blocker ID(s) | Recommendation |
|----------------|-------|---------|---------------|----------------|
| tg-b0c844 | Persist agent_id (tgid) and agent (name) in started, done, n… | Agent clock-in and CLI agent-id (tg | tg-c7bb3a | keep |
| tg-479d0b | Add tg clock-in and tg clock-out subcommands; clock-in retur… | Agent clock-in and CLI agent-id (tg | tg-60ba72 | keep |
| tg-cd0759 | Add config requireAgentId; when true, reject start/done/note… | Agent clock-in and CLI agent-id (tg | tg-b0c844 | keep |
| tg-46de32 | Document clock-in/out, TG_AGENT_ID, requireAgentId; add inte… | Agent clock-in and CLI agent-id (tg | tg-b0c844, tg-479d0b | keep |
| tg-c55f65 | Dashboard status bar shows reliable agent stat from agent_se… | Agent clock-in and CLI agent-id (tg | tg-60ba72 | keep |
| tg-feba95 | Add or update dashboard/status tests for reliable agent stat… | Agent clock-in and CLI agent-id (tg | tg-c55f65 | keep |
| tg-e0f785 | Create research-agents skill that researches agent profiles … | AgentDex and Agents (discovered) | tg-8e2a65 | keep |
| tg-7cd4e0 | Populate agent_dex from distinct started.body.agent in event… | AgentDex and Agents (discovered) | tg-d8ff02 | keep |
| tg-8e2a65 | Add tg dex add command to insert researched agent profiles | AgentDex and Agents (discovered) | tg-d8ff02 | keep |
| tg-dfc66b | Run full test suite (pnpm gate:full) and record result in ev… | Benchmark Schema and Import | tg-95e850, tg-8226d2 | keep |
| tg-d68dad | Run full test suite (pnpm gate:full) and record result in ev… | CLI Ergonomics for Agents and Subag | tg-f43397 | keep |
| tg-f43397 | Add tests for start worktree JSON and error envelope | CLI Ergonomics for Agents and Subag | tg-0df7a0, tg-c0bfa9 | keep |
| tg-fab61d | Run tg stats and verify the per-agent summary table is prese… | CLI Smoke Benchmark | tg-f03dd6 | keep |
| tg-71d378 | Run pnpm gate and record result in evidence | CLI Smoke Benchmark | tg-fab61d | keep |
| tg-4b678d | Add scripts/run-benchmark.ts to run tasks and write results | Custom Benchmark Suite (Option C) | tg-c4216e, tg-238d53 | keep |
| tg-c4216e | Add task_01_cli_command (spec, self-contained stub, run.sh) | Custom Benchmark Suite (Option C) | tg-784058 | keep |
| tg-0845ab | Smoke-test runner and document verification | Custom Benchmark Suite (Option C) | tg-4b678d | keep |
| tg-238d53 | Add task_02_fix_test (spec, stub with wrong assertion, run.s… | Custom Benchmark Suite (Option C) | tg-784058 | keep |
| tg-6dd20d | Link productivity benchmark from docs/performance.md | Custom Benchmark Suite (Option C) | tg-784058 | keep |
| tg-d65da1 | Run gate:full and verify all changes pass | Default Daily Initiative | tg-dad4fc, tg-95e850, tg-97bea9, tg-f069df | keep |
| tg-dad4fc | Integration tests for tg import auto-daily initiative behavi… | Default Daily Initiative | tg-e3c014 | keep |
| tg-97bea9 | Integration tests for tg initiative update and tg initiative… | Default Daily Initiative | tg-f79dfe, tg-03173e, tg-6ba360 | keep |
| tg-03173e | Add tg initiative today subcommand and findOrCreateDailyInit… | Default Daily Initiative | tg-f79dfe | keep |
| tg-e3c014 | Modify tg import to auto-assign daily initiative when --init… | Default Daily Initiative | tg-03173e | keep |
| tg-f069df | Create .cursor/skills/day-summary/SKILL.md | Default Daily Initiative | tg-6ba360 | keep |
| tg-81d3d6 | Add integration tests for tag creation and no-ff merge recor… | Git Merge Recording - Tags and Bran | tg-4b58ec | keep |
| tg-4b58ec | Thread taskTitle and taskHashId from done.ts into mergeWorkt… | Git Merge Recording - Tags and Bran | tg-793d73, tg-3489d8 | keep |
| tg-ff2572 | Run gate:full from plan worktree to confirm all tests pass | Git Workflow Tidy-Up | tg-95e850, tg-46b0d5 | keep |
| tg-46b0d5 | Integration tests for no-ff merge, dirty-worktree guard, and… | Git Workflow Tidy-Up | tg-ad7a40, tg-2ea910, tg-a17f55, tg-38235f | keep |
| tg-dfdc0e | Add integration tests for import with initiative and multi-p… | Initiative-Aware Plan Ingestion | tg-563ca8, tg-37ae96 | keep |
| tg-d523b1 | Add parser tests for initiative and strategic shape | Initiative-Aware Plan Ingestion | tg-7d6e0f, tg-4b9750 | keep |
| tg-563ca8 | Import creates initiative and N projects when parser returns… | Initiative-Aware Plan Ingestion | tg-4b9750, tg-37ae96 | keep |
| tg-5393bb | Run full test suite (pnpm gate:full) and record result in ev… | Initiative-Aware Plan Ingestion | tg-dfdc0e, tg-95e850, tg-2a59cc, tg-d523b1 | keep |
| tg-4b9750 | Parser supports optional projects array and returns strategi… | Initiative-Aware Plan Ingestion | tg-c7e49e | keep |
| tg-37ae96 | Import creates or finds initiative by name and sets project.… | Initiative-Aware Plan Ingestion | tg-7d6e0f | keep |
| tg-fdb390 | Apply --no-commit flag to read-only tests & remove temp SQL … | Integration Test Isolation Improvem | tg-fdb9b8 | keep |
| tg-cdd524 | Convert plan-completion tests to use beforeAll | Integration Test Isolation Improvem | tg-fdb9b8 | keep |
| tg-a9f829 | Add in-process cache for migration checks | Integration Test Isolation Improvem | tg-fdb9b8 | keep |
| tg-130616 | Merge describe blocks in status-live tests | Integration Test Isolation Improvem | tg-fdb9b8 | keep |
| tg-c92ff5 | Run full test suite (gate:full) to validate per-plan worktre… | Per-plan Worktree Model | tg-95e850, tg-f6a1ec | keep |
| tg-de0227 | Persist migration state — write .taskgraph/.tg-migration-ver… | Perf Audit Remediation — Test Infra | tg-b59c33 | keep |
| tg-c6bdc4 | Fix port allocation — expand range from 90 to 200 ports (133… | Perf Audit Remediation — Test Infra | tg-7bde74 | keep |
| tg-a416b5 | Parallelize fetchStatusData queries — replace sequential .an… | Perf Audit Remediation — Test Infra | tg-b59c33 | keep |
| tg-7bde74 | Add assertNoDoltLeak() helper to test-utils.ts — pgrep -c do… | Perf Audit Remediation — Test Infra | tg-aa54a6 | keep |
| tg-b59c33 | Add secondary index migration — applyIndexMigration() in mig… | Perf Audit Remediation — Test Infra | tg-c6bdc4 | keep |
| tg-0e1f2a | Update docs/cli-reference.md with tg stats --plan and --time… | Performance Intelligence | tg-d64260, tg-d095da, tg-ec97aa | unblock |
| tg-d6a28b | Run full test suite (pnpm gate:full) and record result in ev… | Strategic Planning Implementation | tg-f4615b | keep |
| tg-25c014 | Add multi-project support to plan parser with backward-compa… | Strategic Planning Implementation | tg-0de4c4 | keep |
| tg-e99167 | Document multi-project export behavior and optionally implem… | Strategic Planning Implementation | tg-e5466e | keep |
| tg-f4615b | Add tests for parser multi-project and import multi-project … | Strategic Planning Implementation | tg-25c014, tg-e5466e | keep |
| tg-f8e2d9 | Add Strategic mode to plan skill with classification, produc… | Strategic Planning Implementation | tg-2b2e5c | keep |
| tg-e5466e | Implement import command and importer for multi-project pars… | Strategic Planning Implementation | tg-25c014 | keep |
| tg-a25458 | Run full test suite (pnpm gate:full) and record result in ev… | Verifier Agent and Orchestrator-Sub | tg-07ab99, tg-4c7ba8, tg-7f9858, tg-0b864e, tg-036f65 | keep |
| tg-4c7ba8 | Register verifier in .cursor/rules/available-agents.mdc | Verifier Agent and Orchestrator-Sub | tg-7f9858 | keep |
| tg-036f65 | Link agent-strategy to agent-dex-profile-checklist | Verifier Agent and Orchestrator-Sub | tg-07ab99, tg-0b864e | keep |

## 3. Suggested next actions

- **Unblock (1 task):** Blocker(s) are done/canceled. If your workflow syncs task status from edges, the task may already be runnable after a status refresh; otherwise remove the blocking edge (e.g. via DB or future unblock command) so the task can transition to todo.
- **Keep:** Remaining blocked tasks have at least one blocker still todo/doing; no action until blockers complete.
- **Cancel (human decision):** Use `tg cancel <taskId> --reason "..."` for tasks or plans no longer relevant.
