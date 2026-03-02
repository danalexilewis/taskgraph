---
triggers:
  files: ["package.json", "scripts/**", ".taskgraph/**"]
  change_types: ["create", "modify"]
  keywords: ["build", "gate", "dolt", "publish", "npm"]
---

# Infra

Domain guide for build tooling, CI validation, package publishing, and Dolt database management.

## Purpose

- Build system (TypeScript, template copy, pnpm)
- Validation pipeline (lint, typecheck, affected tests)
- Dolt repository lifecycle and auto-migrate
- npm package publishing

## Build system

- **TypeScript**: Compiled with `tsc`. Output in `dist/`. Entrypoint: `dist/cli/index.js`.
- **Template**: `src/template/` is copied to `dist/template/` by the build (see `package.json` scripts). At runtime the CLI resolves templates from `path.join(__dirname, '..', 'template')` so `dist/cli` → `dist/template`.
- **Package manager**: pnpm. Use `pnpm tg` to run the CLI from the repo; `pnpm build` to compile.
- **Output format**: Current build emits CommonJS. **CLI version:** Reading version from `package.json` via `createRequire(import.meta.url)` in the CLI entrypoint causes the emitted CJS to reference `import.meta.url`, which is undefined in CommonJS. Use a hardcoded version string (e.g. in `package.json` or a version module) until the build is ESM or a CJS-safe method is used.

## Validation pipeline

- **Lint**: `pnpm lint` (Biome check). `pnpm lint:fix` to apply fixes.
- **Typecheck**: `pnpm typecheck` runs on **changed** `src/**/*.ts` only; `pnpm typecheck:all` for full `tsc --noEmit`. See `.cursor/rules/changed-files-default.mdc`.
- **Gate**: `pnpm gate` runs `scripts/cheap-gate.sh` (lint + typecheck changed + affected tests). `pnpm gate:full` runs full test suite.
- **Integration tests**: Require built CLI; run `pnpm build` before `pnpm test:integration` if `src/` changed. Golden template and Dolt identity are configured in `__tests__/integration/global-setup.ts`.

## Doctor script

Run `pnpm doctor` (or `bash scripts/doctor.sh`) to check that required and optional tooling is installed. For any missing tool it prints the Homebrew install command:

| Tool       | Required | Brew install |
| ---------- | -------- | ------------ |
| pnpm       | Yes      | `brew install pnpm` |
| bun        | Yes      | `brew install bun` |
| dolt       | Yes      | `brew install dolt` |
| worktrunk (wt) | No (optional) | `brew install worktrunk && wt config shell install` |

Without `wt`, `tg` uses raw git worktrees; with `wt`, it uses Worktrunk for worktree management.

## Dolt Binary Setup

The `tg` CLI requires `dolt` to be installed and available on PATH.

- **macOS**: `brew install dolt`
- **Linux**: `bash -c "$(curl -fsSL https://github.com/dolthub/dolt/releases/latest/download/install.sh)"`
- **Docker**: Add `dolt` to your image (see [DoltHub Docker](https://docs.dolthub.com/introduction/installation/docker))
- **Custom path**: Set `DOLT_PATH=/path/to/dolt` in your environment

### tg server commands

- `pnpm tg server start` — start a background Dolt SQL server (improves query performance)
- `pnpm tg server stop` — stop the background server
- `pnpm tg server status` — check server health and clean up stale state

The server state is tracked in `.taskgraph/tg-server.json`. On ungraceful shutdown, `tg` automatically detects and removes stale server state on next invocation.

### Multi-user / Docker notes

If the Dolt server is started by a different OS user than the one running `tg`, set `TG_DOLT_SERVER_PORT` and `TG_DOLT_SERVER_DATABASE` environment variables manually to bypass automatic server detection.

### Optimising gate:full

- **Lint + typecheck in parallel**: `gate:full` runs Biome and full typecheck in parallel to reduce wall time.
- **Test phases**: db/ and mcp/ run first in isolation (mock bleed); then cli, domain, e2e, export, integration, plan-import, skills. These phases are sequential by design; do not parallelise db/mcp/rest or mock isolation breaks.
- **Faster integration runs**: For the "rest" group you can try `bun test ... --concurrency 4`; see [testing.md](testing.md) and `bunfig.toml`. Some integration tests are serial/flaky under concurrency; if you see flakiness, remove the flag.
- **Reusing golden template**: After one full run, you can avoid re-running global setup for ad-hoc test runs by setting `TG_GOLDEN_TEMPLATE` to the path printed in setup (and skipping teardown). Not used by the gate script itself.

## Dolt

- **Install**: `brew install dolt` (or from [dolthub](https://github.com/dolthub/dolt)).
- **Repo location**: `.taskgraph/dolt/` by default. Config in `.taskgraph/config.json` (`doltRepoPath`).
- **Auto-migrate**: Every CLI command (except `init` and `setup`) runs idempotent migrations at startup. See [schema.md](schema.md).
- **Writable sessions**: All Dolt invocations use `--data-dir <repoPath>` and `DOLT_READ_ONLY=false` in env when the repo allows writes.

### Dolt sql-server mode

TaskGraph supports an optional **sql-server mode** that replaces the default `dolt --data-dir ... sql -q` execa calls with a persistent mysql2 connection pool. This eliminates per-query process spawn overhead (~150 ms/query) and is recommended for integration tests and production use.

**Activation**: Set both `TG_DOLT_SERVER_PORT` and `TG_DOLT_SERVER_DATABASE`. When both are set, the CLI uses the pool instead of execa for all queries.

**Commit behavior**: `doltCommit` uses `CALL DOLT_ADD('-A')` + `CALL DOLT_COMMIT(...)` via the pool when it is active; otherwise falls back to `dolt add` + `dolt commit` subprocess calls.

**Pool key**: The pool is keyed by `host:port:database`. Each unique combination gets its own pool instance. Call `closeServerPool(port, host, database)` during teardown to release connections.

**When pool is null**: `getServerPool()` returns `null` if `TG_DOLT_SERVER_DATABASE` is empty, even when `TG_DOLT_SERVER_PORT` is set. In that case `doltSql()` falls back to the execa path automatically.

**Integration tests**: `global-setup.ts` starts a Dolt sql-server per test suite and sets `TG_DOLT_SERVER_PORT` + `TG_DOLT_SERVER_DATABASE` so all test queries use the pool. `teardownIntegrationTest` calls `closeServerPool(port, host, database)` to release the pool before killing the server process.

## Publishing

- **Package**: `@danalexilewis/taskgraph` on npm. Publish from a clean build and version bump.

## Environment variables

| Variable                  | Type              | Default     | Description                                                                                                                                                                             |
| ------------------------- | ----------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DOLT_PATH`               | string (optional) | `dolt`      | Path to the `dolt` binary. Set when `dolt` is not on PATH.                                                                                                                              |
| `TG_QUERY_CACHE_TTL_MS`   | number (optional) | `0`         | Query result cache TTL in milliseconds. `0` = disabled (default). Dashboard mode uses a `1500 ms` floor regardless of this setting.                                                     |
| `TG_DOLT_SERVER_PORT`     | number (optional) | unset       | Port of a running `dolt sql-server`. When set with `TG_DOLT_SERVER_DATABASE`, activates mysql2 pool mode for all queries.                                                               |
| `TG_DOLT_SERVER_DATABASE` | string (optional) | unset       | Database name to use with the mysql2 pool. Must be non-empty to enable pool mode.                                                                                                       |
| `TG_DOLT_SERVER_HOST`     | string (optional) | `127.0.0.1` | Host for the Dolt SQL server (pool mode).                                                                                                                                               |
| `TG_DOLT_SERVER_USER`     | string (optional) | `root`      | MySQL user for the Dolt SQL server (pool mode).                                                                                                                                         |
| `TG_DOLT_SERVER_PASSWORD` | string (optional) | unset       | MySQL password for the Dolt SQL server (pool mode).                                                                                                                                     |
| `TG_SKIP_MIGRATE`         | flag (optional)   | unset       | When set, skips `ensureMigrations` in the CLI preAction hook. Intended for test environments where migrations have already been applied. CLI prints a warning when this flag is active. |
| `TG_ASCII_DASHBOARD`      | flag (optional)   | unset       | When the dashboard looks garbled (box-drawing or symbols as replacement glyphs), set to `1` for ASCII-only borders and symbols. |

## Decisions / gotchas

- **CLI version in CJS**: `import.meta.url` is undefined in CommonJS. Do not use `createRequire(import.meta.url)` in the CLI entrypoint for reading `package.json`; use a hardcoded version or read from a path derived from `__dirname` in CJS.

## Related projects

- Restructure package — src at root, standard npm layout
- Publish TaskGraph to npm
- Migrate to Bun Test, Add Biome, Targeted Test Execution
