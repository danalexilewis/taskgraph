# Persistent Memory

Transient dev context. Durable knowledge belongs in `docs/`. See `.cursor/rules/memory.mdc` for the learnings routing system.

## Plan import

- Task **title** is VARCHAR(255). Keep plan todo titles under 255 characters.
- **Task external_key** is plan-scoped: import appends a 6-char hex hash of `plan_id`. Re-import upserts by stable key; export strips the suffix.
- **INSERT/UPDATE plan data**: After plan→project rename, `plan` is a view. Use table **`project`** for writes. See `src/cli/import.ts`.

## tg context

- Context reads doc/skill from **task_doc** and **task_skill** junction tables. Older repos may have `task_domain` or `task.domain` / `task.skill` columns.

## CLI version (build)

- `createRequire(import.meta.url)` in CJS emits undefined `import.meta.url`. Use hardcoded version string until ESM build.

## CLI scaffolding (`tg setup`)

- Commander `--no-<flag>` defaults to `true`; don't pass `false` as default.
- **.cursor is opt-in:** `tg setup` defaults to `docs/` only. Use `--cursor` for `.cursor/` scaffolding.
- `tg setup` resolves templates from `path.join(__dirname, '..', 'template')`.

## Dolt JSON columns

- `event.body` may be returned as object or string. Handle both: `typeof raw === 'string' ? JSON.parse(raw) : raw`.

## DAL writable (read-only errors)

- All Dolt invocations use `--data-dir <repoPath>` and `DOLT_READ_ONLY=false` in env.

## Plan → project table

- After schema migration, all app code queries/inserts/updates `project` table. `plan` is a view. PROTECTED_TABLES includes both.

## .env.local for integration tests

- `DOLT_ROOT_PATH` and `TG_GOLDEN_TEMPLATE` must be **empty** in `.env.local` (not set to path files). Bun auto-loads `.env.local`.

## Worktrunk (wt) remove in tg done

- Run `wt remove` with **no branch argument** and **cwd = worktree path**. Pass `worktreePathOverride` from done into `removeWorktree()`.
