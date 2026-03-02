---
name: stale
description: Finds doing tasks that are stale (in progress longer than threshold) and have no agent assigned, then dispatches one investigator per such task to determine cause and recommend or apply recovery. Use when the user says /stale, "stale", "stale tasks", "investigate stale", or "stale unassigned tasks".
---

# Stale — Investigate Stale Unassigned Tasks

Dispatches **one investigator per** outstanding task that is **stale** (doing longer than threshold, default 2h) and has **no agent assigned** (owner null or empty). Each investigator investigates why the task is stale and recommends or applies recovery.

## When to use

- User says `/stale`, "stale", "stale tasks", "investigate stale", or "stale unassigned tasks".
- After a session to clean up forgotten doing tasks with no owner.

## Workflow

1. **Get stale doing tasks with owner**
   - Run: `pnpm tg status --json`
   - Parse the JSON output. Read the `stale_tasks` array (alias for `staleDoingTasks`). Each entry has: `task_id`, `hash_id`, `title`, `owner`, `age_hours`.

2. **Filter to unassigned**
   - Keep only tasks where `owner` is null, undefined, or empty string (no agent assigned).

3. **If none**
   - Reply: "No stale unassigned tasks." and stop.

4. **TodoWrite (required before dispatch)**
   - Call TodoWrite with the list of stale unassigned tasks: `id` = task_id, `content` = title (or short label), `status` = `"in_progress"` for the batch. If only one task, add a second todo (e.g. "Collect investigator report") so the panel has ≥2 items.

5. **Dispatch one investigator per task in the same turn**
   - Emit one Task or mcp_task call **per** stale unassigned task, all in the same message so they run in parallel.
   - Use **investigator** sub-agent (read-write). Omit `model` so the investigator inherits the session model (Sonnet).
   - Pass the **stale-task investigator prompt** (see below) with placeholders filled per task.

6. **Collect reports**
   - When all investigators complete, summarize: per-task STATUS and any FIX_APPLIED or ESCALATION_REASON. If any investigator applied recovery (e.g. note or reset), say what was done.

## Stale-task investigator prompt

Use this prompt variant when dispatching an investigator for a **stale task** (not for gate:full failures). Replace the placeholders per task.

```
You are the Investigator sub-agent. This is a **stale-task** investigation, not a test-failure investigation.

**Task**
- Task ID: {{TASK_ID}}
- Title: {{TITLE}}
- In "doing" for: {{AGE_HOURS}} hours
- Owner: none (no agent assigned)

**Directive**
This task has been in "doing" for over the threshold with no agent assigned. Investigate why it is stale (e.g. abandoned, stuck, or never picked up). Then either:
- Recommend recovery: e.g. add a note with `tg note {{TASK_ID}} --msg "..."`, or suggest the orchestrator run `tg done {{TASK_ID}} --force --evidence "..."` or use `tg recover` to reset to todo; or
- Apply recovery yourself: if appropriate, run `tg note {{TASK_ID}} --msg "Stale-task investigation: ..."` and, if the task is clearly abandoned, you may run `tg done {{TASK_ID}} --force --evidence "Stale; recovered by investigator"` from the repo root (no worktree required for recovery).

Do not run gate:full or make code changes unless the task itself requires it. Focus on task-graph state and recovery.

Return a short report: STATUS (FIXED | PARTIAL | ESCALATE), ROOT_CAUSE (why it was stale), FIX_APPLIED or RECOMMENDATION, ESCALATION_REASON (if any).
```

## Stale threshold

- Default: 2 hours. The `stale_tasks` array from `tg status --json` uses the default 2h threshold.
- To use a different threshold, run status with `--stale-threshold <hours>` (e.g. `pnpm tg status --json --stale-threshold 3`) and parse the same `stale_tasks` array.

## Constraints

- Only **doing** tasks can be stale (started > threshold ago). Todo/blocked/done are not in `stale_tasks`.
- "No agent assigned" means `owner` is null or empty. Tasks with an owner (e.g. "implementer", "human") are **not** dispatched for this skill; they are assumed to have someone responsible.
- Investigator count: one per stale unassigned task; dispatch all in the same turn for parallelism.
