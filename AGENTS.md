## Cursor Cloud specific instructions

### Overview

TaskGraph is a local-first CLI (`tg`) + Dolt-backed schema for managing plans, tasks, dependencies, and execution state. There is no web server or background service — it is entirely a CLI tool that shells out to the `dolt` binary.

### System dependencies (pre-installed by VM snapshot)

- **Node.js** >= 18 (runtime)
- **Dolt** (versioned SQL database backend) — installed to `/usr/local/bin/dolt`
- **Bun** (test runner, not an npm dependency) — installed to `~/.bun/bin/bun`
- **pnpm** (package manager)

### Running the CLI

The CLI runs from `dist/` (TypeScript compiled output). After `pnpm install && pnpm build`:

```bash
pnpm tg status          # show plans/tasks overview
pnpm tg --help          # full command reference
```

See `README.md` "Development (this repo)" section for standard commands.

### Key caveats

- **`.taskgraph/config.json`**: The `doltRepoPath` is stored as an absolute path. The VM snapshot sets it to `/workspace/.taskgraph/dolt`. If this path is wrong (e.g. pointing to a macOS path from the repo author), update it before running any `tg` commands.
- **Dolt global identity**: Dolt requires `user.name` and `user.email` to be configured globally before it can init repos or commit. The VM snapshot configures this. If you see "Author identity unknown" errors, run: `dolt config --global --add user.email "agent@cursor.dev" && dolt config --global --add user.name "Cursor Agent"`.
- **Golden template for integration tests**: Integration and some domain tests (e.g. `plan-completion`) require a golden Dolt template. Before running integration tests, create it with: `bun -e "const s = require('./__tests__/integration/global-setup.ts').default; s()"`. The template path is written to `/tmp/tg-golden-template-path.txt` and read by test-utils automatically.
- **Dashboard tests timeout in non-TTY**: Tests under `__tests__/integration/status-live.test.ts` that test SIGINT/dashboard behavior timeout in non-TTY environments. This is expected.
- **Query builder unit tests**: `__tests__/db/query.test.ts` has a pre-existing mock mismatch (doltSql called with 3 args, tests expect 2). These failures are in the repo, not caused by environment setup.
- **E2E tests**: `__tests__/e2e/core-flow.test.ts` has pre-existing migration failures related to `task_doc` table creation in fresh Dolt repos. These are existing issues.
- **Bun on PATH**: Bun is installed at `~/.bun/bin/bun`. If `bun` is not found, run `export PATH="$HOME/.bun/bin:$PATH"` or source `~/.bashrc`.
- **Build before integration/e2e tests**: Integration and e2e tests run the built CLI from `dist/`. Always `pnpm build` before running these tests.

### Validation commands

Per `README.md` and `AGENT.md`:

| Check | Command |
|-------|---------|
| Lint | `pnpm lint` |
| Typecheck (changed files) | `pnpm typecheck` |
| Typecheck (full) | `pnpm typecheck:all` |
| Unit tests | `pnpm test` |
| Integration tests | `pnpm test:integration` |
| E2E tests | `pnpm test:e2e` |
| All tests | `pnpm test:all` |
| Gate (lint + typecheck + affected) | `pnpm gate` |
| Full gate | `pnpm gate:full` |
