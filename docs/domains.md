# Domain slugs

Tasks can set a `domain` that maps to a docs page. The agent reads `docs/<domain>.md` before starting work.

| Domain slug | Doc |
|-------------|-----|
| `architecture` | [architecture.md](architecture.md) — Data store, CLI, repo layout, data flow |
| `schema` | [schema.md](schema.md) — Dolt tables, columns, invariants |
| `cli-reference` | [cli-reference.md](cli-reference.md) — Full CLI reference |
| `cli` | [cli.md](cli.md) — CLI overview and quick reference |
| `plan-import` | [plan-import.md](plan-import.md) — Cursor and legacy plan import |
| `error-handling` | [error-handling.md](error-handling.md) — Error types and handling |
| `testing` | [testing.md](testing.md) — Test structure and practices |
| `agent-contract` | [agent-contract.md](agent-contract.md) — Agent workflow and contract |

Use the slug (e.g. `schema`, `plan-import`) as the task’s `domain` in plan YAML.

Domain docs now include YAML frontmatter with a `triggers` block to assist automated assignment. The frontmatter uses the following format:

```yaml
---
triggers:
  files: ["<glob patterns>"]
  change_types: ["<types>"]
  keywords: ["<terms>"]
---
```

