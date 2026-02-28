# Taskgraph

Inspired by [Beads](https://github.com/steveyegge/beads) and [Gastown.dev](https://gastown.dev) — Task Graph is for **Centaur Development** (human + agent).

## Why this repo

I wanted a small, local-first way to manage plans and tasks during agent-assisted coding without adopting full Beads/Gastown orchestration. Task-Graph borrows from Beads (atomic claims, structured notes, status visibility) but stays minimal: one working copy, no mayor/orchestrator, no swarms. It’s a Dolt-backed CLI that fits into Cursor workflows so agents and humans can share the same task graph and execution state.

## What this is

TaskGraph is a small CLI (`tg`) + Dolt-backed schema for managing **plans, tasks, dependencies, and execution state** during agent-assisted (“centaur”) development.

## Quick start

1. **Install Dolt** (required for the local DB): `brew install dolt`
2. **Install TaskGraph** in your repo:

   ```bash
   pnpm add -D @danalexilewis/taskgraph
   ```

3. **Run the CLI** with `pnpm tg` (pnpm runs the binary from `node_modules/.bin`; no script in `package.json` needed). Or use `npx tg` with npm.
4. **Initialize** from your repo root (creates `.taskgraph/` and Dolt DB):

   ```bash
   pnpm tg init
   ```

5. **Scaffold** (optional; domain docs, skill guides, Cursor rules). If `docs/` or `.cursor/` (including `.cursor/rules/`) already exist, setup adds template files alongside your existing ones and skips files that already exist:

   ```bash
   pnpm tg setup
   ```

## Development (this repo)

To work on TaskGraph itself:

1. **Prerequisites**
   - **Node** ≥18 (CLI runtime)
   - **Dolt** (local DB): `brew install dolt`
   - **Bun** (test runner; not an npm dependency): `curl -fsSL https://bun.sh/install | bash` or `brew install oven-sh/bun/bun`

2. **Install and build**

   ```bash
   git clone https://github.com/danalexilewis/taskgraph.git
   cd taskgraph
   pnpm install
   pnpm build
   ```

3. **Run tests**
   - Unit: `pnpm test`
   - Integration: `pnpm test:integration`
   - Full suite: `pnpm test:all` or `pnpm gate:full`
   - Validation pipeline (lint → typecheck on changed files → affected tests): `pnpm gate`. Use `pnpm typecheck:all` for full typecheck; see `.cursor/rules/changed-files-default.mdc`.

4. **Run the CLI** from the repo: `pnpm tg` (uses `dist/` from the last build).

## Conventions (domain + skill guides)

Tasks can optionally declare:

- `domain`: slug(s) that map to `docs/<domain>.md`
- `skill`: slug(s) that map to `docs/skills/<skill>.md`

Agents can read the docs printed by `tg context <taskId>` to load repo-specific conventions before making changes.
