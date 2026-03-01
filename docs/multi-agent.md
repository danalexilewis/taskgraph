---
triggers:
  files: ["src/cli/**", ".cursor/rules/**", "docs/multi-agent.md"]
  change_types: ["create", "modify"]
  keywords: ["worktree", "multi-agent", "tg start", "tg done", "plan branch"]
---

# Multi-Agent Centaur Model

This document describes how Task-Graph supports 2–3 simultaneous agents working alongside the human. The model is **centaur-first**: the human plans, audits, and routes; agents execute with shared visibility.

## What It Is

- **Publish + observe**: Agents broadcast intent (`tg start --agent`, `tg note`) and observe state (`tg status`). They do not negotiate with each other.
- **Append-only coordination**: Notes and events are append-only. Claims are idempotent check-then-set.
- **Zero config for single agent**: All multi-agent features are additive. A single agent ignoring `--agent` still works.

## What It Isn't

- **Not Gastown-style orchestration**: No mayor/coordinator agent. The human is the coordinator.
- **No convoys/swarms**: Overkill for 2–3 agents. We share one working copy.

## Worktrunk — sub-agent worktree backend

Task-Graph uses a **per-plan worktree model**: each plan gets a shared branch and worktree, and individual task worktrees branch from it. This allows parallel tasks in the same plan to accumulate their work on a single plan branch before it is merged to main.

### Per-plan branch and worktree

When `tg start <taskId> --worktree` is called and the plan has a `hash_id`, the CLI:

1. **Creates or reuses a plan branch and worktree.** The branch is named `plan-<hash_id>` (e.g. `plan-p-a1b2c3`). If a row already exists in `plan_worktree` and the path is live, the existing worktree is reused. Otherwise a new worktree is created from `main` and recorded in the `plan_worktree` table.
2. **Creates a per-task worktree branching from the plan branch** (not from main). Each task gets its own isolated directory (`tg/<taskId>` or `tg-<hash_id>` with Worktrunk).
3. **Records `plan_branch` and `plan_worktree_path`** in the started event body alongside the task's `worktree_path` and `worktree_branch`.

### Merge target is the plan branch

When `tg done <taskId> --merge` is called on a task that was started with `--worktree`:

- If the task's plan has an entry in `plan_worktree`, the task branch is merged into the **plan branch**, not into `main`.
- If no plan worktree exists (e.g. the plan had no `hash_id`), the merge target falls back to `main` (or `mainBranch` from config).
- The **plan worktree is never removed** by `tg done`. It accumulates merged task work and is cleaned up separately when the plan is complete.

### Parallel task handling

Multiple implementers working on tasks in the same plan each get their own task worktree (all branching from the plan branch). As each task finishes, `tg done --merge` merges the task branch into the plan branch. Because they all target the same plan branch, their changes accumulate there without touching main until the plan is ready to merge.

### Backend selection

Task-Graph uses **Worktrunk (wt)** as the standard backend when available: set `"useWorktrunk": true` in `.taskgraph/config.json`, or ensure the `wt` CLI is on PATH (auto-detect). Raw git worktrees are supported when `useWorktrunk` is false or `wt` is not installed. The orchestrator passes the worktree path (from `tg worktree list --json` or the started event) to implementers as **WORKTREE_PATH** so they `cd` there and run all work and `tg done` from that directory.

See [cli-reference.md](cli-reference.md) (worktree section) and `.cursor/rules/subagent-dispatch.mdc`.

## CLI Additions

| Command                                                | Purpose                                                                           |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `tg start <taskId> --agent <name> [--worktree]`        | Claim a task; with `--worktree` create isolated worktree (Worktrunk when enabled) |
| `tg start <taskId> --force`                            | Override claim when task is already being worked (human override)                 |
| `tg worktree list [--json]`                            | List active worktrees; use to get path for implementer dispatch                   |
| `tg note <taskId> --msg <text> [--agent <name>]`       | Append a note event; visible in `tg show`                                         |
| `tg status`                                            | Shows "Active work" section with doing tasks, agent_id, plan title, started_at    |
| `tg stats [--agent <name>] [--plan <planId>] [--json]` | Derive agent metrics from events: tasks_done, review pass/fail, avg elapsed time  |

## Conventions

1. **Always pass `--agent`** when multiple agents may be active.
2. **Read Active work** before picking a task. Avoid overlap.
3. **Leave notes** when changing shared interfaces or discovering anything relevant beyond the current task's scope. Notes are the transmission vehicle between an agent focused introspectively on one task and agents working connectively across many tasks. See [agent-strategy.md](agent-strategy.md#communication-notes-as-cross-dimensional-transmission) for the architectural framing.
4. **Do not pick** tasks in the same area as another doing task without human approval.

## Event Body Conventions

- **started**: `{ agent, timestamp }`
- **note**: `{ message, agent, timestamp }`. For review verdicts (orchestrator records after spec/quality reviewer), use **review event convention**: record with `tg note <taskId> --msg '<JSON>'` where the message body is JSON containing `"type": "review"`, e.g. `{ "type": "review", "verdict": "PASS" | "FAIL", "reviewer": "<agent_name>", "stage": "spec" | "quality" }`. This enables `tg stats` to count pass/fail by stage and by reviewer.

Missing `agent` is treated as `"unknown"`.

## Heartbeat Events

Agents emit heartbeat notes at key transition points during task execution. Heartbeats reuse the existing structured-note pattern (same `kind = "note"` event) with `message.type = "heartbeat"` as the discriminator.

### Body shape

```json
{
  "message": {
    "type": "heartbeat",
    "agent": "<agent-name>",
    "phase": "start" | "mid-work" | "pre-done",
    "files": ["src/path/to/file.ts"]
  },
  "agent": "<agent-name>",
  "timestamp": "<ISO datetime>"
}
```

The outer `agent` and `timestamp` fields match the existing note body convention. The `message` object is the structured payload.

### Phase values

| Phase | When to emit | `files` value |
| ----------- | ------------------------------------ | ------------------------------------------ |
| `start` | Immediately after `tg start` | `[]` (no files touched yet) |
| `mid-work` | Before touching files | List of files about to be modified |
| `pre-done` | Just before calling `tg done` | Final list of files modified |

### Command template

```bash
pnpm tg note <taskId> --msg '{"type":"heartbeat","agent":"<AGENT_NAME>","phase":"<PHASE>","files":["path/to/file.ts"]}' --agent <AGENT_NAME>
```

The `--msg` value must be valid JSON. List only files being **actively modified**, not every file read.

### Notes

- `tg agents` queries heartbeat events using `JSON_UNQUOTE(JSON_EXTRACT(...))` on `message.type` — the same double-extract approach used for review events. **Do not change the body shape without also updating `src/cli/agents.ts`.**
- `files` should be a minimal list of files the agent is writing, not an exhaustive read list.

## Decisions / gotchas

- **Verify plan branch exists before dispatching Wave 1.** After the first `tg start --worktree` for a new plan, run `tg worktree list --json` and confirm a `plan-p-XXXXXX` entry appears. If only task branches (`tg-XXXXXX`) are visible but no `plan-p-*` worktree, the plan branch was not created. When sub-agents subsequently call `tg done` from their worktrees, the task worktrees are cleaned up without merging — all commits are silently destroyed. Root cause: `plan_worktree` row was not written (possible Dolt server startup timing, missing `hash_id` on the plan, or `tg start` error that was swallowed). Fix: create the plan branch manually before dispatching, or investigate why the row is missing.

- **Task branches from a missing plan branch will target `main` as fallback** (per the merge-target logic above) — but only when `tg done --merge` explicitly passes the merge flag. Without `--merge`, `tg done` marks the task done and cleans up the worktree with no merge at all.

## Using stats for dispatch

`tg stats` shows tasks completed, review pass/fail counts, and average elapsed time per agent. Use it to inform dispatch: rebalance workload (e.g. assign more to faster or less-loaded agents), spot agents with high review fail rates (consider re-dispatch or different reviewer), or choose which agent to assign follow-up tasks.
