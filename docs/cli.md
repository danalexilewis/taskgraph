---
triggers:
  files: ["src/cli/**"]
  change_types: ["create", "modify"]
  keywords: ["command", "CLI"]
---

# CLI overview

The Task Graph CLI (`tg`) is the primary interface for plans, tasks, and the execution loop.

- **Quick reference**: See [cli-reference.md](cli-reference.md) for all commands and options.
- **Workflow**: See repo root [AGENT.md](../AGENT.md) and [agent-contract.md](agent-contract.md) for the agent loop (status → next → show → start → context → work → done).

Common commands: `tg status`, `tg next`, `tg show <id>`, `tg start <id>`, `tg context <id>`, `tg done <id>`.
