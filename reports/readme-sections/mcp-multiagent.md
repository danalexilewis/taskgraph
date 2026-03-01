## MCP server

TaskGraph provides an **MCP (Model Context Protocol) server** (`tg-mcp`) so AI assistants can read task and plan data without using the CLI.

- **Read-only tools**: `tg_status`, `tg_context`, `tg_next`, `tg_show` — same data as the equivalent `tg` commands.
- **Clients**: Works with Cursor, Claude Desktop, and other MCP-compatible clients.
- **Setup**: Run from the project root (directory containing `.taskgraph/`); the server reads `.taskgraph/config.json`.

For setup, tool parameters, and Cursor/Claude configuration, see [docs/mcp.md](docs/mcp.md).

## Multi-agent support

TaskGraph is designed for **2–3 agents** working alongside a human.

- **Publish + observe** — Agents broadcast intent (`tg start --agent`, `tg note`) and observe state (`tg status`). No negotiation; append-only coordination.
- **Agent identity** — Use the `--agent` flag on `start` and `note` so `tg status` shows who is doing what.
- **File isolation** — Use `tg start <taskId> --worktree` so each task gets an isolated git worktree and agents don’t clash on the same files.
- **Notes** — Notes are the boundary between one-task (implementer) and cross-task (orchestrator) perspectives; use `tg note` when changing shared interfaces or discovering issues beyond the current task.
- **Metrics** — `tg stats` shows tasks completed, review pass/fail, and average elapsed time per agent.

For the full model and event conventions, see [docs/multi-agent.md](docs/multi-agent.md).
