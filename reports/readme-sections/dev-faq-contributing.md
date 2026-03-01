## Development

To work on TaskGraph itself:

- **Prerequisites**: Node ≥18, [Dolt](https://docs.dolthub.com/introduction/getting-started) (`brew install dolt`), [Bun](https://bun.sh) (test runner).
- **Setup**: `git clone` → `pnpm install` → `pnpm build`.
- **Tests**: `pnpm test` (unit), `pnpm test:integration` (integration), `pnpm gate` (lint → typecheck on changed files → affected tests), `pnpm gate:full` (full suite).
- **CLI from repo**: `pnpm tg` (uses `dist/` from the last build).

See [docs/testing.md](docs/testing.md) for test conventions.

## FAQ

**Do I need Dolt?**  
Yes. Dolt is the backing store for the task graph. Install with `brew install dolt`.

**Does this work without Cursor?**  
The CLI works standalone. Agent features (skills, sub-agents, rules) are Cursor-specific; the task graph and CLI are tool-agnostic.

**Can multiple agents work at once?**  
Yes. Use `--agent <name>` on `tg start` and `tg note`, and optionally `--worktree` for file isolation. See [docs/multi-agent.md](docs/multi-agent.md).

**How do I sync the task graph across machines?**  
The graph lives in `.taskgraph/dolt/`. Use Dolt remotes: from `.taskgraph/dolt/`, run `dolt remote add origin <url>` once, then `dolt pull` / `dolt push`. A `tg sync` command is planned.

**What’s the difference between gates and blocks?**  
**Gates** block a task on an _external_ condition (human approval, CI, webhook). **Blocks** are task-on-task dependencies (`tg block` or `edge add ... blocks`).

**Can I use this with Claude Code or other AI tools?**  
The MCP server (`tg-mcp`) works with any MCP-compatible client. The CLI runs from any terminal.

## Contributing

Contributions that improve clarity, behavior, or docs are welcome. Before committing, run `pnpm gate` (lint, typecheck on changed files, affected tests). When you change user- or agent-facing behavior, update the relevant docs (see `.cursor/rules/docs-sync.mdc`).

## Acknowledgments

- [Beads](https://github.com/steveyegge/beads) — atomic claims, structured notes.
- [Gastown.dev](https://gastown.dev) — centaur development model.
- [oh-my-cursor](https://github.com/tmcfarlane/oh-my-cursor) — README structure inspiration.

## License

MIT. See [LICENSE](LICENSE).
