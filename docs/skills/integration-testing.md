---
triggers:
  files: ["__tests__/integration/**"]
  change_types: ["create", "modify", "test"]
  keywords: ["integration test", "test-utils", "runTgCli"]
---

# Skill: Integration testing

## Purpose

Integration tests with temp Dolt repo; runTgCli, test-utils.

## Inputs

- Temporary database instance
- Test utilities (`runTgCli`, `test-utils`)

## Steps

1. Use `runTgCli` to execute CLI commands against a temp Dolt repo.
2. Assert expected outputs and side effects.

## Gotchas

- Clean up temp repos to avoid stale state.
- Use `beforeEach`/`afterEach` hooks for isolation.
- For read-only state assertions, prefer `doltSql` or domain APIs to avoid extra CLI process spawns; use `runTgCli` for the CLI behavior under test.

## Task IDs

When a test needs a task ID from the repo (e.g. to call `tg context <taskId>` or to query the DB by task_id), use **`tg next --json`** (or equivalent) and take **`task_id`** from the parsed JSON. Do **not** parse the human-readable "ID: ..." line, so tests stay robust when the display format changes (e.g. hash_id vs UUID). See [docs/research/integration-test-next-output-format.md](../research/integration-test-next-output-format.md).
