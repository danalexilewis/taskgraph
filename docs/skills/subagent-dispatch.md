---
triggers:
  files: [".cursor/agents/**", ".cursor/rules/subagent*"]
  change_types: ["create", "modify"]
  keywords: ["sub-agent", "dispatch", "implementer", "reviewer"]
---

# Skill: Sub-agent dispatch

## Purpose

Execute task-graph work by dispatching fast sub-agents instead of doing every task yourself. Sub-agents can be run via the Cursor Task tool, the `agent` CLI, or mcp_task (when in an environment that provides it); same prompt and workflow. See docs/cursor-agent-cli.md for options.

**Task orchestration UI**: When running tg tasks, call TodoWrite with the task list from `tg next` before dispatching and update statuses as tasks complete; when dispatching a batch, emit N Task (or mcp_task) calls in the same turn. See `.cursor/rules/subagent-dispatch.mdc` for the full TodoWrite and batch-in-one-turn protocol.

**Concurrency**: Feed all runnable, non-conflicting tasks (no file overlap); Cursor decides how many run in parallel. Do not cap the batch size yourself.

...
