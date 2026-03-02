# Review Report — Sub-agent batching and task granularity

**Date:** 2026-03-02  
**Scope:** Sub-agent dispatch patterns, task granularity, and batching strategy for the Hivemind initiative and similar plans.  
**Produced by:** Review skill (orchestrator); code/process and system health via investigator sub-agents (read-only).

---

## Code health (dispatch and task granularity)

### Current rule: 1:1 task per implementer

The 1:1 rule is explicit in:

| Location                              | Section                       | Wording                                                                                                                                     |
| ------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `.cursor/rules/subagent-dispatch.mdc` | Task orchestration UI, step 3 | "When dispatching a batch of N runnable tasks, emit **N Task (or mcp_task) invocations** in the SAME message/turn — **one call per task**." |
| `.cursor/rules/subagent-dispatch.mdc` | Pattern 1 step 5              | "Dispatch all tasks in the batch **in the same response** (one Task or mcp_task call **per task** in the batch)."                           |
| `docs/leads/execution.md`             | Pattern (step 2)              | "Send up to **5** implementers in parallel (**one task per implementer**)."                                                                 |
| `.cursor/agents/implementer.md`       | Purpose                       | "Execute **a single task** from the task graph."                                                                                            |

So today: N runnable tasks → N implementer invocations. No rule or template describes one agent handling multiple tasks in one session.

### Task size signals available to the lead

The orchestrator can infer “small / file-edity” vs “large / thinking” from:

| Signal              | Where                                | When batching?                                     |
| ------------------- | ------------------------------------ | -------------------------------------------------- |
| `risk`              | `tg next --json` (per runnable task) | Yes                                                |
| `estimate_mins`     | `tg next --json`                     | Yes                                                |
| `change_type`       | `tg context <taskId> --json`         | Yes (after context per task)                       |
| `file_tree`         | `tg context --json` (plan-level)     | Yes                                                |
| `suggested_changes` | `tg context --json`                  | Yes                                                |
| `token_estimate`    | `tg context --json`                  | Yes (context size)                                 |
| File count          | Not first-class                      | Only via parsing `file_tree` / `suggested_changes` |

So the lead already has enough to form a policy: e.g. batch only when `risk=low`, `estimate_mins ≤ 15`, and `change_type` in `[modify, fix, test]`; otherwise 1:1.

### Batching feasibility (one agent, multiple tasks)

**Current pattern:** Each implementer gets one `TASK_ID`, one worktree, one `tg start` / work / `tg done --merge`.

**Multi-task-per-agent (sequential in one session):**

- **CLI:** No change needed. The implementer can run, for each task: `tg start <id> --worktree` → `cd` to worktree → work → `tg done <id> --merge`, then repeat for the next task. Each task keeps its own worktree and branch.
- **Prompt/template:** Need a variant (or extended template) that receives 2+ task IDs and 2+ context blobs, with instructions: “For each task in order: start → work → done; do not mix scope between tasks.”
- **Worktree model:** Unchanged. One worktree per task; one merge per task. A design where one worktree serves N tasks would require new merge/DB semantics.

**Conclusion:** Batching is feasible as “one implementer invocation, N tasks executed **sequentially** in one session.” It requires orchestrator logic to (1) decide batch size from task size signals and (2) build one prompt with N tasks and N context blocks, plus an implementer template (or variant) for the N-task loop.

---

## System health (task graph and Hivemind usage)

### Task graph snapshot (from session and reports)

- **Status output (this session):** Many projects (AgentDex and Agents, Benchmark Schema and Import, Breadcrumbs, etc.) with tasks in todo/doing/done. Full list in `tg status --tasks`.
- **From prior reports:** ~33 runnable across plans at reprioritise time; 21+ prioritised projects; per-project todo/doing/blocked/done counts available from meta/crossplan reports.

### Hivemind plan structure

**Plan:** `plans/26-03-02_hivemind_initiative.md`

| Aspect                 | Value                           |
| ---------------------- | ------------------------------- |
| Total tasks            | 7                               |
| First wave (unblocked) | 3                               |
| Agent mix              | 4 × documenter, 3 × implementer |
| Typical scope per task | One area or 1–3 files/sections  |

**Wave structure:**

- **Wave 1:** `create-hivemind-initiative`, `plan-skill-follow-up-options`, `hive-context-alignment`
- Then: `initiative-in-plan-frontmatter`, `initiative-scoped-status-crossplan` (blocked on first)
- Then: `crossplan-dependency-visibility-docs`, then `docs-and-skill-updates`

**Scope per task:** Each task is a bounded unit (e.g. “add initiative to plan frontmatter and import”, “add --initiative to status and crossplan”, “add Phase 3 follow-up to plan skill”). Several touch 2–3 files or 1–2 doc sections. So Hivemind tasks are **medium granularity** — coherent feature/doc chunks, not single-file micro-tasks.

### Runnable batch size

- For Hivemind: 1–3 tasks per wave (3 in first wave).
- Rules say: feed all runnable, non-conflicting tasks from `tg next`; Cursor decides concurrency; no artificial cap.

### Observation: “One tiny todo at a time”

For **Hivemind**, tasks are **not** “one tiny todo” (one file edit). They are small multi-file or multi-doc chunks. So the concern (“agents on one tiny todo at a time”) may apply more to **other plans** that are authored with finer granularity, or to the **overhead** of spinning up one agent per task even when each task is small (e.g. one doc subsection). The analysis still supports reusing one agent for several such small tasks when they are atomic and file-edit-heavy.

---

## Batching and task granularity (recommendations)

### Good number of atomic tasks per agent

- **File-edit-heavy (small, clear scope):** **2–3 tasks per implementer** is a reasonable default. Use: low `risk`, low `estimate_mins` from `tg next`; `change_type` in `[modify, fix, test]` and small `suggested_changes` / `file_tree` from context. Cap by total context (e.g. sum of `token_estimate` under a limit) and by total estimated time (e.g. sum `estimate_mins` &lt; 30–45) so the session stays focused.

- **Thinking/design-heavy:** **1 task per implementer.** Use: high `risk` or high `estimate_mins`, or `change_type` like `investigate` / `refactor`, or large `suggested_changes` / broad `file_tree`. These benefit from full context and no extra scope in the same session.

**Rule of thumb for the lead:**  
Batch only when `risk=low`, `estimate_mins` small (e.g. ≤ 15 per task), and `change_type` in `[modify, fix, test]`; otherwise 1:1. Optionally fetch `tg context` for runnable tasks and use `token_estimate` to avoid overloading a single prompt.

### Is it worth spinning up an agent per tiny task?

- **Current:** One agent per task regardless of size. For very small tasks (e.g. one file, one doc subsection), the fixed cost of start/worktree/done and review can dominate.
- **Improvement:** Reuse one agent for 2–3 atomic, file-edit-heavy tasks in one session (sequential start → work → done per task). Reduces orchestration and review overhead while keeping worktrees and merges correct.
- **Lead setup:** The lead/orchestrator can use existing signals (`risk`, `estimate_mins` from `tg next`; `change_type`, `token_estimate` from `tg context`) to decide batch size. No new CLI fields are strictly required; optional improvements could be a `task_size` or `batch_with` hint in the plan for author-driven batching.

### Hivemind-specific takeaway

Hivemind’s 7 tasks are already medium-grained (one area or 1–3 files per task). Wave 1 has 3 runnable tasks; with a batching policy, the lead could assign **one documenter** to the two doc-only Wave 1 tasks that don’t block others (`plan-skill-follow-up-options`, `hive-context-alignment`) and keep one implementer for `create-hivemind-initiative`, or run all 3 in parallel as today. Batching helps most when many runnable tasks are small and same-agent-type (e.g. several documenter tasks in one wave).

---

## Summary and next steps

### Overall health

- **Dispatch and rules:** Clear and consistent (1:1 task:agent; parallel batch in one turn; worktree per task).
- **Task size signals:** Present (`risk`, `estimate_mins`, `change_type`, `file_tree`, `token_estimate`); sufficient for the lead to batch by size.
- **Hivemind usage:** Plan is well-structured; tasks are bounded units, not micro-tasks; 1–3 runnable per wave.

### Top actionable items

1. **Document batching policy** — In `docs/leads/execution.md` or `.cursor/rules/subagent-dispatch.mdc`, add an optional “Task batching” section: when the lead may assign 2–3 tasks to one implementer (risk=low, small estimate, file-edit-heavy) and how to build the multi-task prompt (N task IDs + N context blobs; implementer does start→work→done per task in order).
2. **Implementer template variant** — Add (or extend) an implementer template for “N tasks in one session”: input `{{TASK_IDS}}` and `{{CONTEXT_BLOCKS}}`, instructions to run the start/work/done cycle once per task without mixing scope.
3. **Orchestrator logic** — In the work skill / execution lead flow, before dispatching: (a) get runnable tasks from `tg next --json`; (b) optionally fetch `tg context` for each; (c) group tasks by agent type and by size (file-edit vs thinking); (d) for small, same-agent groups with no file overlap, build one prompt with 2–3 tasks and dispatch one implementer (or documenter) for that group; (e) for the rest, keep 1:1.
4. **Plan authoring** — In plan-authoring or plan-format docs, note that tasks intended for batching should be atomic and same-agent (e.g. several documenter tasks in one wave); avoid blocking relationships within a batch.
5. **Validate on Hivemind** — When implementing batching, test on Hivemind’s Wave 1: e.g. one documenter for `plan-skill-follow-up-options` + `hive-context-alignment` (both doc-only, no file overlap) and compare overhead and outcome to two separate documenter runs.

### Optional: risk assessment

This review did not run the risk skill. If you treat “multi-task-per-agent batching” as a new feature, run the risk workflow (`.cursor/skills/risk/SKILL.md`) for cross-plan impact and mitigation (e.g. merge order, review granularity, evidence per task).
