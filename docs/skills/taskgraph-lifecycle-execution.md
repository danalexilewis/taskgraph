---
triggers:
  files: ["src/cli/**"]
  change_types: ["create", "modify"]
  keywords: ["tg start", "tg done", "lifecycle", "status transition"]
---

# Skill: Taskgraph lifecycle execution

## Purpose

Execute tasks from a taskgraph plan with correct status transitions so the graph stays in sync. Prevents desync (tasks left `doing`, forgotten `done`), cross-plan confusion, and invalid transitions (e.g. `todo` → `done` without `start`).

When the orchestrator dispatches sub-agents for tg tasks, call TodoWrite with the task list before dispatching and emit N Task/mcp_task calls in the same turn when batching. See `.cursor/rules/subagent-dispatch.mdc` for the TodoWrite and batch-in-one-turn protocol.

...
