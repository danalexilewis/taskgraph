---
name: tg plan list
overview: "Add tg plan list (or tg plan ls) to list all plans with title, ID, status—enabling discovery of plan IDs for tg next --plan, tg export, and other commands."
todos:
  - id: plan-list-command
    content: Add planListCommand to plan.ts — subcommand 'list' or 'ls' that SELECTs plan_id, title, status, created_at from plan table ordered by created_at DESC
    status: pending
  - id: plan-list-output
    content: Format human output as table or lines (plan_id, title, status); support --json for machine output
    status: pending
  - id: plan-list-docs
    content: Update docs/cli-reference.md with tg plan list section
    status: pending
isProject: false
---

# tg plan list

## Goal

Allow users to discover existing plans. Right now you need a plan ID for `tg next --plan`, `tg export --plan`, etc., but there is no way to list plans.

## Behavior

- **Command**: `tg plan list` or `tg plan ls`
- **Output (human)**: List each plan with `plan_id`, `title`, `status` (and optionally `created_at`)
- **Output (--json)**: JSON array of plan objects for scripting
- **Order**: By `created_at` DESC (newest first)

## Implementation

- Add `planListCommand()` in `tools/taskgraph/src/cli/plan.ts`
- Use `q.select("plan", { columns: ["plan_id", "title", "status", "created_at"], orderBy: "created_at DESC" })`
- Follow existing patterns from `next`, `show` for output formatting and `--json` support
