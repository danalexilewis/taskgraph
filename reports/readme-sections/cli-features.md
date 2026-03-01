## CLI features

Commands are grouped by purpose:

| Group | Commands |
|-------|----------|
| **Setup** | `init`, `setup` |
| **Planning** | `plan new` / `plan list`, `import`, `template apply` |
| **Tasks** | `task new`, `start`, `done`, `cancel`, `split`, `block` |
| **Dependencies** | `edge add` |
| **Navigation** | `next`, `show`, `context`, `status` |
| **Dashboard** | `dashboard`, `status --tasks` / `status --projects` |
| **Export** | `export mermaid` / `export dot` / `export markdown` |
| **Analytics** | `stats`, `portfolio`, `crossplan` |
| **Gates** | `gate create` / `gate resolve` / `gate list` |
| **Multi-agent** | `start --agent` / `start --worktree`, `worktree list`, `note` |
| **MCP** | `tg-mcp` (MCP server) |

**Key features**

- **Worktrees** — isolate agent sessions per worktree; `worktree list` and `start --worktree`.
- **Dolt branching** — plans and tasks live in a Dolt repo; branch and sync with `tg branch`, `tg sync`.
- **Rich plan format** — YAML frontmatter, todos, and optional agent/skill metadata; see [Plan format](docs/plan-format.md).
- **Cross-plan analysis** — `crossplan` and portfolio views across plans and initiatives.
- **External gates** — `gate create` / `resolve` / `list` for gating releases or deployments.
- **Template system** — `template apply` and scaffolded plans/tasks from templates.
- **Live dashboard** — `dashboard` and `status --tasks` / `--projects` for live task and project views.

Full command and option reference: [docs/cli-reference.md](docs/cli-reference.md).
