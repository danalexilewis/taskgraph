# Domain slugs

Docs in this folder form a **DDD-inspired domain knowledge base**. Each doc covers a bounded context: what the subsystem owns, key design decisions, implementation gotchas, and (where applicable) links to related projects in the task graph. Use the slug as the task’s `domain` in plan YAML so the agent reads `docs/<domain>.md` before starting work.

| Domain slug | Doc | Description |
|-------------|-----|--------------|
| `architecture` | [architecture.md](architecture.md) | Data store, CLI, repo layout, data flow |
| `schema` | [schema.md](schema.md) | Dolt tables, columns, invariants, decisions |
| `cli-reference` | [cli-reference.md](cli-reference.md) | Full CLI reference |
| `cli` | [cli.md](cli.md) | CLI overview and quick reference |
| `cli-tables` | [cli-tables.md](cli-tables.md) | CLI table rendering, boxen layout, column config |
| `plan-import` | [plan-import.md](plan-import.md) | Cursor and legacy plan import |
| `plan-format` | [plan-format.md](plan-format.md) | Plan file structure and YAML conventions |
| `error-handling` | [error-handling.md](error-handling.md) | Error types and handling |
| `testing` | [testing.md](testing.md) | Test structure and practices |
| `infra` | [infra.md](infra.md) | Build, validation, publishing, Dolt management |
| `agent-contract` | [agent-contract.md](agent-contract.md) | Agent workflow and contract |
| `agent-strategy` | [agent-strategy.md](agent-strategy.md) | Agent patterns, communication model |
| `multi-agent` | [multi-agent.md](multi-agent.md) | Multi-agent coordination, worktrees, notes |
| `mcp` | [mcp.md](mcp.md) | MCP server tools and configuration |
| `glossary` | [glossary.md](glossary.md) | Naming conventions and definitions |
| `backend` | [backend.md](backend.md) | Template stub (project-specific content not added) |
| `recommended-packages` | [recommended-packages.md](recommended-packages.md) | Recommended dependencies |
| `performance` | [performance.md](performance.md) | System requirements, tg stats interpretation, optimization patterns |
| `agent-context` | [agent-context.md](agent-context.md) | SQLite event store for cross-agent state visibility |

Use the slug (e.g. `schema`, `plan-import`) as the task’s `domain` in plan YAML.

Domain docs can include YAML frontmatter with a `triggers` block to assist automated assignment:

```yaml
---
triggers:
  files: ["<glob patterns>"]
  change_types: ["<types>"]
  keywords: ["<terms>"]
---
```
