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

When delegating to implementer sub-agents, use worktree isolation so each task runs in its own directory. Task-Graph uses **Worktrunk (wt)** as the standard backend when available: set `"useWorktrunk": true` in `.taskgraph/config.json`, or ensure the `wt` CLI is on PATH (tg auto-detects). With Worktrunk, `tg start <taskId> --agent <name> --worktree` creates a wt-managed worktree; the orchestrator passes the worktree path to implementers (from `tg worktree list --json` or the started event) so they `cd` there and run all work and `tg done` from that directory. Raw git worktrees remain supported when `useWorktrunk` is false or wt is not installed. See [cli-reference.md](cli-reference.md) (worktree section) and `.cursor/rules/subagent-dispatch.mdc`.

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

## Using stats for dispatch

`tg stats` shows tasks completed, review pass/fail counts, and average elapsed time per agent. Use it to inform dispatch: rebalance workload (e.g. assign more to faster or less-loaded agents), spot agents with high review fail rates (consider re-dispatch or different reviewer), or choose which agent to assign follow-up tasks.
