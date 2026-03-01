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

| Variable | Type | Default | Description |
|---|---|---|---|
| `TG_QUERY_CACHE_TTL_MS` | number (optional) | `0` | Query result cache TTL in milliseconds. `0` = disabled (default). Dashboard mode uses a `1500 ms` floor regardless of this setting. |
| `TG_DOLT_SERVER_PORT` | number (optional) | unset | Port of a running `dolt sql-server`. When set with `TG_DOLT_SERVER_DATABASE`, activates mysql2 pool mode for all queries. |
| `TG_DOLT_SERVER_DATABASE` | string (optional) | unset | Database name to use with the mysql2 pool. Must be non-empty to enable pool mode. |
| `TG_DOLT_SERVER_HOST` | string (optional) | `127.0.0.1` | Host for the Dolt SQL server (pool mode). |
| `TG_DOLT_SERVER_USER` | string (optional) | `root` | MySQL user for the Dolt SQL server (pool mode). |
| `TG_DOLT_SERVER_PASSWORD` | string (optional) | unset | MySQL password for the Dolt SQL server (pool mode). |
| `TG_SKIP_MIGRATE` | flag (optional) | unset | When set, skips `ensureMigrations` in the CLI preAction hook. Intended for test environments where migrations have already been applied. CLI prints a warning when this flag is active. |

## Decisions / gotchas

- **CLI version in CJS**: `import.meta.url` is undefined in CommonJS. Do not use `createRequire(import.meta.url)` in the CLI entrypoint for reading `package.json`; use a hardcoded version or read from a path derived from `__dirname` in CJS.

## Related projects

- Restructure package — src at root, standard npm layout
- Publish TaskGraph to npm
- Migrate to Bun Test, Add Biome, Targeted Test Execution
