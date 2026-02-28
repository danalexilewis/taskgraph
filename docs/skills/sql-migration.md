---
triggers:
  files: ["src/db/**"]
  change_types: ["create", "modify"]
  keywords: ["migration", "schema", "SQL"]
---

# Skill: SQL migration

## Purpose

Dolt schema changes; `information_schema` checks.

## Inputs

- SQL migration scripts
- Database connection

## Steps

1. Write SQL for `ALTER TABLE`, `CREATE TABLE`, etc.
2. Test against `information_schema` for expected structure.

## Gotchas

- Avoid destructive operations without backups.
- Confirm SQL compatibility across Dolt versions.
