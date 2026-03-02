# Lead: Execution

Created by the **/work** skill. Autonomous task execution loop: grind through plan tasks using sub-agent dispatch without stopping for human confirmation.

## When

- **/work** (no args) — Self-orient via sitrep, then execute.
- **/work** (with plan context), **go**, **execute**, **grind** — Execute directly (skip sitrep).

## Self-Orientation (Phase 0)

When `/work` is invoked **without** a specific plan or directive:

1. Check for a recent sitrep (< 1h in `reports/sitrep-*.md`).
2. If none, generate one (dispatch sitrep-analyst, write to `reports/sitrep-YYYY-MM-DD-HHmm.md`); otherwise reuse the existing file.
3. Self-select lead role from the sitrep formation (see .cursor/rules/available-agents.mdc § Lead Roles and Formation).
4. Enter the role-specific workflow: execution-lead → existing loop; overseer → watchdog/monitor; investigator-lead → hunter-killer; planner-lead → /plan.

When a plan is specified (by context or user), skip Phase 0 and go straight to the loop.

## Agent files (workers)

- **implementer.md** — does the work (code, tests, docs).
- **reviewer.md** — evaluates implementation against the spec (quality check).
- **spec-reviewer**, **quality-reviewer** — two-stage review: spec compliance then quality.

## Pattern

**Phase 0** (only when no plan specified): Self-orient via sitrep, then enter the loop or another role workflow as above.

1. **Loop:** `tg next` (plan name or multi-plan) -> get runnable tasks.
2. **Dispatch:** Use **Worktrunk** for worktree isolation when available (config `useWorktrunk: true` or `wt` on PATH). Send up to **5** implementers in parallel (one task per implementer). **Default:** omit `WORKTREE_PATH` — each implementer runs its own `tg start --worktree` and self-starts in its Step 1. **Exception:** pre-start yourself (run `tg start <taskId> --agent <name> --worktree`, then `tg worktree list --json` to get the path) only when you need the started-event data before building prompts — for example, to capture `plan_branch` for injection into subsequent implementer prompts as `{{WORKTREE_PATH}}`.
3. **Review:** Two-stage — spec-reviewer then quality-reviewer (or reviewer when single-stage).
4. **Repeat** until no runnable tasks or plan complete.

Orchestrator coordinates; implementers and reviewers are workers.

### Task batching (optional)

The execution lead may assign **2–3 tasks to a single implementer or documenter** when all of the following hold:

- **risk** = low (from `tg next --json`: task risk field).
- **estimate_mins** small (e.g. ≤ 15 per task; from `tg next --json`).
- **change_type** in `[modify, fix, test, document]` (from `tg context <taskId> --json`).
- **Same agent type** for all tasks in the batch (e.g. all implementer or all documenter).
- **No file overlap** between tasks (compare file_tree, suggested_changes, or intent).

Build the **multi-task prompt** with N task IDs and N context blocks (one `tg context <taskId> --json` per task). Instruct the sub-agent to run **start → work → done per task in order**; the worktree remains **one per task** (the agent starts a worktree for the first task, does work and `tg done --merge`, then starts the next task’s worktree and repeats). Use task size signals from `tg next` (risk, estimate_mins) and `tg context` (change_type, token_estimate when present) to decide whether to batch; when in doubt, dispatch one task per sub-agent.

## Safeguards

- **File conflict check** — avoid assigning tasks that touch the same files to different agents in the same batch.
- **Three-layer watchdog** — prevents stuck sub-agents from hanging the loop:
  - Layer 1: Implementer self-awareness (`implementer.md` loop budget — agent exits with VERDICT: FAIL on stuck-loop detection)
  - Layer 2: Orchestrator terminal-monitoring protocol (`work/SKILL.md -> Sub-Agent Watchdog Protocol` — `block_until_ms: 600000`, terminal read, stall heuristics, PID kill, route to fixer/re-dispatch/investigator)
  - Layer 3: Optional bash overseer daemon (`scripts/overseer.sh` — monitors worktree filesystem activity every 180s)
- **Follow-up from notes** — if implementer or notes mention env issues, gate failures, or suggested follow-up, orchestrator may create follow-up tasks and delegate.
- **Escalation after 2 failures** — if a reviewer fails the same task twice, fall back to direct execution (orchestrator does the work).

## Input

- **No input (default)** — Self-orient via sitrep, pick role and plan from formation; then run the loop.
- **Plan name** (single plan) — Skip sitrep, execute that plan.
- **Multi-plan** — Skip sitrep, work across all active plans.

## Output

- **Progress per batch** — which tasks were dispatched, completed, or failed each round.
- **Final summary** — plan(s) completed, tasks done, any follow-up or failures.

## See also

- `.cursor/skills/work/SKILL.md` — work skill definition.
- `.cursor/rules/subagent-dispatch.mdc` — dispatch patterns and task orchestration UI.
- `docs/leads/README.md` — lead registry.
