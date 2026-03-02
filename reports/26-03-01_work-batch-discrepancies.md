# Work Batch Discrepancies — 2026-03-01

**Scope:** Discrepancies observed after two autonomous work batches (10 tasks across Integration Test, Initiative-Project, Perf Audit, Fix Sub-Agent Dispatch, Shared Agent Intelligence, Agent Context Sync, Inline Doc Content).

## Observed discrepancies

1. **tg done from main repo instead of worktree (fdeec822, 4215adea)**  
   Implementers reported running `tg done` from the **main repo** because the worktree had no `dist/` (CLI not built there). If `tg done --merge` is invoked from the main repo when the task used a worktree, the merge step can be skipped or use the wrong cwd, and worktree code may not be merged onto the plan branch correctly.  
   **Mitigation:** Implementer template and memory already state: run `tg done` from the **worktree directory**. Do not run `pnpm install` or `pnpm build` in the worktree unless the task added a dependency; the worktree has deps/build from the branch it was created from. Run `tg done` from the worktree path so the merge is not skipped.

2. **Worktree branch behind main (fce7b0cb)**  
   The implementer for the “5 secondary indexes” task worked in a worktree whose `migrate.ts` did not include the batch migration probe (BATCH_PROBE_SQL / MigrationProbeResult) that exists on main. So the worktree was an older revision. When this worktree is merged into the plan branch (and later into main), the migration chain may need reconciliation — e.g. index names or probe usage — so that main’s batched probe and the new indexes coexist.

3. **Worktree path not visible to subagent (0752e5e2)**  
   The implementer for “Create src/cli/agent-context.ts” reported that the shell could not see the worktree path (`/Users/dan/repos/Task-Graph.tg-e34cc6`), so commit and `tg done` could not be run from that directory. The task was later marked done (likely by another process or the orchestrator). This can happen when subagents run in an environment where only the main repo path exists or worktrees are on another host/path.

4. **Hypothesis: cross-agent “tailing” causing scope creep**  
   Different agents may be reading shared context (terminal output, agent-context hub, or each other’s task context) and then **acting on** other agents’ work — e.g. fixing another agent’s task, editing files that belong to another task, or running commands (like `tg done`) in the wrong cwd. That would explain: (a) merges run from main instead of worktree, (b) worktrees containing changes from more than one task, (c) “helpful” edits that belong to a different task.  
   **Mitigation (implemented):** Document **context-hub scope discipline**: agents may read from the SQLite context hub and use it to inform their **own** decisions; they must **not** start solving other agents’ problems; take others’ context under advisement only. Added to `docs/agent-context.md`, `docs/multi-agent.md`, and `.cursor/agents/implementer.md` and `documenter.md`.

## Recommendations

- **Orchestrator:** When an implementer reports “tg done from main” or “worktree path not visible”, verify task status and, if needed, run `tg done` from the correct worktree path (or note for human).
- **Implementer template:** Keep the "run tg done from worktree directory" rule. Do not run install/build in the worktree unless the task added a dependency (see implementer MUST NOT DO and agent-utility-belt § Worktree setup).
- **Context hub:** Treat the new scope-discipline text as the canonical rule; point reviewers and other subagents to it when they can read the hub.
