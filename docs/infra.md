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

## Publishing

- **Package**: `@danalexilewis/taskgraph` on npm. Publish from a clean build and version bump.

## Environment variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `TG_QUERY_CACHE_TTL_MS` | number (optional) | `0` | Query result cache TTL in milliseconds. `0` = disabled (default). Dashboard mode uses a `1500 ms` floor regardless of this setting. |

## Decisions / gotchas

- **CLI version in CJS**: `import.meta.url` is undefined in CommonJS. Do not use `createRequire(import.meta.url)` in the CLI entrypoint for reading `package.json`; use a hardcoded version or read from a path derived from `__dirname` in CJS.

## Related projects

- Restructure package — src at root, standard npm layout
- Publish TaskGraph to npm
- Migrate to Bun Test, Add Biome, Targeted Test Execution
