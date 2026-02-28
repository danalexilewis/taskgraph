---
triggers:
  files: ["src/db/migrate.ts", "src/db/**"]
  change_types: ["create", "modify"]
  keywords: ["migration", "schema", "column", "table", "ALTER"]
---

# Skill: Dolt schema migration

## Purpose

Add/change columns safely; idempotent migrations via init.

## Inputs

- Migration spec (columns, types)
- Existing Dolt schema and manifest

## Steps

1. Create migration script in `src/db/migrate.ts`.
2. Use Dolt's `noms` APIs for idempotent operations.
3. Validate changes against `information_schema`.

## Gotchas

- Ensure migrations are idempotent; re-runnable without errors.
- Use `dolt sql` only for non-destructive operations; avoid raw deletes.
