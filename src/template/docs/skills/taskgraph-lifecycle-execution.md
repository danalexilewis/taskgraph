# Skill: Taskgraph lifecycle execution

## Purpose

Execute tasks from a taskgraph plan with correct status transitions so the graph stays in sync. Prevents desync (tasks left `doing`, forgotten `done`), cross-plan confusion, and invalid transitions (e.g. `todo` → `done` without `start`).

When the orchestrator dispatches sub-agents for tg tasks, call TodoWrite with the task list before dispatching and emit N Task/mcp_task calls in the same turn when batching. See `.cursor/rules/subagent-dispatch.mdc` for the TodoWrite and batch-in-one-turn protocol.

## Inputs

- A plan imported into taskgraph (`tg import ... --format cursor`)
- `tg status` output showing current state
- A runnable task ID from `tg next`

## Steps

1. Run `pnpm tg status` to orient — note stale `doing` tasks and cleanup if needed (see Recovery in taskgraph-workflow.mdc).
2. Run `pnpm tg next --plan "<Plan>" --limit 20` and pick the top runnable task.
3. Run `pnpm tg show <taskId>` and restate: intent, scope in/out, acceptance checks.
4. Run `pnpm tg start <taskId>` — **must** run before any work.
5. Run `pnpm tg context <taskId>` — load domain doc and skill guide if output; read related done tasks.
6. Do the work (stay within scope).
7. Run `pnpm tg done <taskId> --evidence "..."` — **must** run immediately after work.
8. For multiple tasks: complete full start→work→done for each one individually; never batch-skip.

## Gotchas

- `tg done` without `tg start` fails: valid transitions are `todo` → `doing` → `done`. Use `tg done --force` only for legitimate out-of-band completion.
- If the task is `doing` and work is already done: `tg done <taskId> --evidence "completed previously"` (no `--force`).
- If blocked: `tg block <taskId> --on <blockerId> --reason "..."`. If blocker does not exist, create a task with owner=human, then block.
- After the last task in a plan, run `tg export markdown --plan <planId>`; output goes to `exports/<planId>.md` (plan files in `plans/` are never overwritten).

## Definition of done

- Task is `done` in taskgraph.
- Evidence includes: tests run, commands, git hashes.
- No orphaned `doing` tasks; `tg status` reflects reality.
- Plan file updated if this was the last task.
