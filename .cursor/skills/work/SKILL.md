---
name: work
description: Autonomous task execution loop. Grinds through plan tasks using sub-agent dispatch without stopping for human confirmation. Use when the user says "work", "go", "execute", "grind", or wants tasks completed autonomously.
---

# Work — Autonomous Task Execution

**Lead documentation:** See [docs/leads/execution.md](docs/leads/execution.md).

When this skill is invoked, enter an autonomous execution loop. Do not stop to ask the human unless a sub-agent fails twice or you hit an ambiguity you cannot resolve.

## Architecture

- **You (orchestrator / execution lead)**: Coordinates the execution loop. Dispatches implementers, reviews results, escalates failures.
- **Sub-agents**:

  | Agent                                          | Purpose                                 | Permission |
  | ---------------------------------------------- | --------------------------------------- | ---------- |
  | implementer                                    | Execute task (code, tests, docs)        | read-write |
  | reviewer (or spec-reviewer + quality-reviewer) | Evaluate implementation                 | read-only  |
  | fixer                                          | Escalation after 2 implementer failures | read-write |

## Permissions

- **Lead**: read-write (orchestrates task execution, writes to task graph)
- **Propagation**: Mixed. Implementer and fixer are read-write. Reviewers are read-only.
- **Sub-agents**:

  | Agent                                       | Permission |
  | ------------------------------------------- | ---------- |
  | implementer                                 | read-write |
  | reviewer / spec-reviewer / quality-reviewer | read-only  |
  | fixer                                       | read-write |

## Decision tree

```mermaid
flowchart TD
    A[Start: check for plan to import] --> B{Import needed?}
    B -->|Yes| C[tg import plan]
    B -->|No| D[tg next --json]
    C --> D
    D --> E{Tasks empty?}
    E -->|Yes| F[Plan complete - report summary]
    E -->|No| G[File conflict check - build batch]
    G --> H[TodoWrite + dispatch N implementers]
    H --> I[Wait for batch]
    I --> J{Each task outcome}
    J -->|SUCCESS| K[Check notes and evidence]
    J -->|FAIL 1| L[Re-dispatch with feedback]
    J -->|FAIL 2| M{Escalation ladder}
    M -->|Fixer| N[Dispatch fixer agent]
    M -->|Direct| O[Orchestrator does task]
    M -->|Human| P[Stop + present options]
    K --> D
    L --> I
    N --> I
    O --> D
```

## Task orchestration UI — ALWAYS use when running tg tasks

When executing tasks from tg, **always structure work so Cursor surfaces the "Task orchestration for autonomous execution" panel.** This gives the human a single place to see which sub-agents are doing what (meta todo + sub-agent management). Assume there will always be one or more tasks; use the same orchestration flow whether it's 1 or 5.

**Before each batch:**

1. Get runnable tasks: `tg next [--plan <planId>] --json --limit 20` (feed all; Cursor decides concurrency)
2. **Call TodoWrite with the task list** (see subagent-dispatch.mdc TodoWrite protocol) — pass the tasks from step 1 before dispatching any sub-agents. TodoWrite is the progress report for the orchestration panel; it surfaces the batch in Cursor's "Task orchestration for autonomous execution" UI.
3. Keep `.cursor/agents/implementer.md` in context when starting the loop — the orchestration panel is often tied to that agent context.
4. Dispatch sub-agents via the Task tool or mcp_task; **emit all Task/mcp_task calls for the current batch in the same turn** so the batch runs as intended. Cursor will populate the orchestration panel with task status as work progresses.

## Before the loop — plan import (context)

**Context matters.** If the conversation implies a plan that should be executed (e.g. a plan was just created or the user said "proceed" / "execute" after a plan was presented, or the user attached or referenced a plan file), ensure that plan is in the task graph before starting the loop:

1. **Identify the plan** — From the same thread: a plan file path (e.g. `plans/26-02-27_blocked_status_materialized.md`), the plan name (e.g. from the plan’s `name` frontmatter), or a plan that was just approved for execution.
2. **Import if needed** — Run:
   ```bash
   pnpm tg import plans/<filename> --plan "<Plan Name>" --format cursor
   ```
   Use the plan’s filename and the exact `name` from its frontmatter. If the plan is already imported, the command will still succeed (upsert behavior).
3. **Scope the run (optional)** — If you imported or identified a single plan to run, use it for the loop: `tg next --plan "<Plan Name>" --json --limit 20` so work focuses on that plan’s tasks first. Otherwise proceed in multi-plan mode (see below).

If no plan is indicated by context or the user, skip import and use multi-plan mode.

## Loop

**Orchestrator state:** Maintain a map `plan_id -> { worktree_path, plan_branch }` for every plan that uses worktrees. Populate it on the first `tg start --worktree` per plan; use it for `{{PLAN_BRANCH}}` and for the plan-merge step when the plan completes.

```
while true:
  1. tasks = tg next [--plan <planId|planName>] --json --limit 20
  2. if tasks is empty → for each plan that completed this session, run **Plan-merge step** (below); then report summary, then run **Final action — commit .taskgraph/dolt**; stop
  3. batch = all non-conflicting tasks from tasks (no file overlap); do not cap size — Cursor decides concurrency
  4. TodoWrite with the task list (from step 1) before dispatching — this is the orchestration panel progress report.
  5. Emit all Task/mcp_task calls for this batch in the same turn (batch-in-one-turn).
  6. for each task in batch:
       a. context = tg context <taskId> --json
       b. (Worktrunk) Run tg start <taskId> --agent <name> --worktree from repo root. Get worktree path from tg worktree list --json (or started event). On the first tg start --worktree for a plan, capture the plan branch from the started event or from tg worktree list --json and store it in the plan_id map. Inject {{WORKTREE_PATH}} and {{PLAN_BRANCH}} in the implementer prompt (so the implementer has plan branch context even though each task has its own worktree). After obtaining the worktree path: `touch <worktree_path>/.tg-dispatch-marker` to set a baseline timestamp for the overseer's staleness detection.
       c. build implementer prompt from .cursor/agents/implementer.md + context + {{WORKTREE_PATH}} + {{PLAN_BRANCH}}
       d. dispatch sub-agent (Task tool or mcp_task, model=fast)
  7. wait for all sub-agents to complete
  8. for each completed sub-agent:
       a. TodoWrite merge=true to update progress (e.g. mark that task complete in the todo list).
       b. if SUCCESS → check return message and task notes (including after the final task in a plan, e.g. full-suite run); if implementer reported environment/gate issues or follow-up, run **Follow-up from notes/evidence** (subagent-dispatch.mdc): orchestrator decides whether to create task(s) with `tg task new ... --plan <planId>` and delegate.
       c. if FAIL → re-dispatch once with feedback
       d. if FAIL again → apply **escalation ladder** (see subagent-dispatch.mdc “Escalation decision tree”): consider **fixer agent** (stronger model), **direct execution** (orchestrator does the task), or **escalate to human**; see Escalation below.
  9. loop back to step 1
```

## Plan-merge step

When a plan completes (after the run-full-suite task passes and `tg next` returns no tasks for that plan), run this **before** the Final action (commit .taskgraph/dolt).

> **Optionally run `/evolve` before plan-merge** — reads the plan branch's diffs to surface implementation anti-patterns before the branch is deleted. Invoke if the plan had reviewer FAIL events, follow-up fix tasks, or you want to capture learnings from this execution. Syntax: read `.cursor/skills/evolve/SKILL.md` and follow the workflow with the just-completed plan as input. Must run BEFORE the plan-merge step. In multi-plan mode, run it for **each plan that completed in this session**, using the stored `plan_id -> worktree_path` (and plan branch) from the orchestrator map.

1. **Preferred (Worktrunk available):**

   ```bash
   wt merge main -C <plan-worktree-path> --no-verify -y
   ```

   This squash-merges the plan branch into main from the plan worktree.

2. **Fallback (wt not on PATH):**
   ```bash
   git checkout main && git merge --squash <plan-branch> && git commit -m "plan: <plan-name>"
   ```
   Run from repo root; use the plan branch name from the orchestrator map and the plan's display name for the commit message.

Order: run plan-merge for all completed plans first, then **Final action — commit .taskgraph/dolt** (so the dolt commit runs after plan-merge, not before).

## Sub-Agent Watchdog Protocol

**Optional: Start the overseer daemon** before the first wave of dispatches:
```bash
bash scripts/overseer.sh /tmp/tg-overseer-status.json &
```
The daemon runs in the background, writing filesystem staleness data every 180s for active worktrees. No action needed if the script is absent or Dolt is unavailable — it degrades to an empty status file.

Implementers run with a soft 10-minute budget (set `block_until_ms: 600000` when dispatching via Task tool).

**Important:** `block_until_ms` backgrounds the Task call but does NOT kill the agent process. The agent keeps running in its terminal. Background = monitoring trigger, not kill signal.

**Fast-path check (if overseer is running):** Before reading individual terminal files, check `cat /tmp/tg-overseer-status.json 2>/dev/null` — if the file exists and is under 6 minutes old, review it. Any worktree with `"stale": true` is a candidate for the watchdog protocol below. If the file is missing or stale (>6 min), proceed directly to terminal-file reads.

**When a Task call backgrounds (exceeded block_until_ms):**

1. Read the terminal file for that agent (last 60 lines). Terminal files are at `~/.cursor/projects/<project>/terminals/<id>.txt`; the PID is in the file header (`pid:` field).
2. Evaluate stall heuristics — any one is sufficient to declare stall:
   - a. 5+ consecutive reads of the same file path with no intervening file write between them
   - b. 3+ consecutive `sleep` or `wait` calls with no other tool call between them
   - c. Same error message repeated 3+ times without a different tool call between repeats
3. **If stall confirmed:** kill the agent:
   ```bash
   kill -TERM <pid>
   sleep 5
   kill -KILL <pid> 2>/dev/null || true
   ```
4. Log the kill: `pnpm tg note <taskId> --msg "WATCHDOG: killed at $(date -u +%Y-%m-%dT%H:%M:%SZ), stall pattern: <pattern>"`
5. **Reassignment routing** — check `git status` in the task's worktree:
   - Uncommitted file changes exist → dispatch **fixer** with partial work context and the stall note
   - No file changes at all, first kill → **re-dispatch implementer** once with note "prior attempt stalled on <pattern>, avoid this approach"
   - No file changes, already re-dispatched → dispatch **investigator** to determine if the task itself is problematic

## File Conflict Check

Before dispatching tasks in parallel, check if any tasks in the batch touch the same files (compare `file_tree`, `suggested_changes`, or intent references). If overlap exists, run those tasks sequentially, not in parallel.

## Escalation — Escalation ladder and when to stop for the human

When a sub-agent has **failed twice** on the same task, use the **escalation decision tree** in `.cursor/rules/subagent-dispatch.mdc`: choose among (1) **fixer agent** — dispatch the fixer sub-agent (stronger model; see `.cursor/agents/fixer.md`) with task context and failure feedback; (2) **direct execution** — orchestrator does the task and logs with `tg note <taskId> --msg "Direct execution: 2 sub-agent failures"`; (3) **escalate to human** — stop the loop and present summary + options (below). Do not default only to direct execution; prefer the fixer when the failure is implementation/review and the task is well-scoped.

Stop the loop and present a summary + options when:

- After applying the ladder, you chose **escalate to human** (e.g. credentials, ambiguous intent, safety, or repeated direct-execution failure).
- A task's intent is **ambiguous** — you cannot determine what to do without a design decision.
- A task requires **credentials, secrets, or external access** you don't have.
- More than **5 tasks** have failed in a single loop run (systemic issue).

When escalating to the human, provide:

1. **Summary**: What was completed, what failed, what remains.
2. **Diagnosis**: Why the failure happened (error message, diff, context).
3. **Options**: Concrete choices (e.g. "I can retry with X approach", "Skip this task and continue", "This needs your input on Y").

## Progress Reporting

After each batch completes, emit a brief status line:

```
[work] Batch N: completed 5/5 tasks. Remaining: 7 tasks across 2 plans.
```

At the end of the loop (plan complete or all tasks done), emit a full summary:

```
[work] Plan "<name>" complete.
  Done: 10 tasks
  Failed: 1 task (escalated)
  Skipped: 0
  Duration: ~4 min
```

## Final action — commit task graph state

After the full summary and **after** the **Plan-merge step** has run for all completed plans, commit the Dolt task graph state so the DB is tracked in git alongside the code changes it describes. This runs **once per work session**, after all tasks are done, plan-merge has been run, and the full test suite has passed (or was skipped).

**Steps:**

1. **Collect context** for the commit message:

   ```bash
   # List all tasks completed in this work session (from plans that just finished)
   pnpm tg status --tasks --json 2>/dev/null | node -e "
     const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
     const done = (d.tasks||[]).filter(t=>t.status==='done');
     console.log(done.map(t=>'- '+t.title+' ('+t.task_id+')').join('\n'));
   " 2>/dev/null || echo "(task list unavailable)"

   # If gh is available, collect merged PR URLs for this session's branches
   gh pr list --state merged --limit 10 --json url,title 2>/dev/null || true
   ```

2. **Stage and commit:**

   ```bash
   git add .taskgraph/dolt
   git commit -m "$(cat <<'COMMITMSG'
   chore(taskgraph): persist task graph state after <plan-name>

   Completed <N> tasks in plan "<plan-name>":
   <paste bullet list from step 1>

   <If GitHub PRs exist, add a "Merged PRs:" section:>
   Merged PRs:
   - <PR title>: <URL>

   COMMITMSG
   )"
   ```

   Substitute real values: replace `<plan-name>` with the plan title, `<N>` with count of tasks done, and the bullet list with the output from step 1. If `gh pr list` returned URLs, include them under "Merged PRs:". If no PRs exist (no GitHub PR workflow), omit that section.

3. **Skip if nothing to commit:**

   ```bash
   git diff --cached --quiet .taskgraph/dolt && echo "[work] No dolt changes to commit." || git commit ...
   ```

   Use `git diff --staged .taskgraph/dolt` first; only run the commit if there are staged changes.

**Important:** Do NOT include other modified files in this commit — only `.taskgraph/dolt`. Code changes should have been committed separately (by implementers or as part of the plan's merge step).

## Multi-Plan Mode

If no plan was imported or scoped in **Before the loop**, work across all active plans. Use `tg next --json --limit 20` (no plan filter) and process all non-conflicting tasks; Cursor decides concurrency. The orchestrator maintains the map `plan_id -> { worktree_path, plan_branch }` for **all** active plans that use worktrees. When the loop exits (tasks empty), run the **Plan-merge step** for each plan that completed in this session, then the **Final action — commit .taskgraph/dolt**.

## Gate strategy — cheap gate per batch, gate:full once at plan end

**Never run `gate:full` after each batch.** The full integration suite is expensive and only meaningful as final QA across the whole plan's changes.

| When                              | Command                      | Who runs it                                                       |
| --------------------------------- | ---------------------------- | ----------------------------------------------------------------- |
| After each batch (optional, fast) | `bash scripts/cheap-gate.sh` | Orchestrator (optional lint+typecheck+affected tests only)        |
| At plan end (mandatory, once)     | `pnpm gate:full`             | Dedicated `run-full-suite` task — the **last** task in every plan |

The `run-full-suite` task is the gate before the plan is marked complete. **It is not optional.** All feature and test tasks must block on it; it must be the last task in the plan's dependency graph.

## When gate:full fails — hunter-killer dispatch

When the `run-full-suite` task runs `pnpm gate:full` and it fails:

1. **Mark the task done** with failure evidence: `tg done <taskId> --evidence "gate:full failed: <failure summary>"`. Add a `tg note` with the raw failing test output.
2. **Cluster the failures** — group by test suite or area (e.g. "worktree tests", "dolt-branch tests", "status tests").
3. **Dispatch one investigator per cluster** — in parallel, one `Task` call per cluster. Use the hunter-killer prompt from `.cursor/agents/investigator.md`:
   - `{{FAILURE_CLUSTER}}` = the specific test names / suite
   - `{{STACK_TRACES}}` = relevant error output
   - `{{PLAN_CONTEXT}}` = what this plan implemented (one line)
   - `{{CHANGED_FILES}}` = key files changed (from `git diff HEAD~N --name-only` or implementer evidence)
4. **Collect investigator reports.** Each reports `STATUS: FIXED | PARTIAL | ESCALATE`.
5. **Re-run gate:full** after all investigators complete. If it passes → proceed to plan completion (dolt commit etc.).
6. **If gate:full still fails** after investigator fixes:
   - For `ESCALATE` reports: create fix tasks with `tg task new` and re-enter the work loop.
   - For persistent failures across two rounds: stop and present to the human with a summary.
