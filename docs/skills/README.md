# Skill guides

Each skill guide now includes a YAML frontmatter `triggers` block specifying file patterns, change types, and keywords to enable auto-discovery and matching.

Tasks can set a `skill` that maps to a guide here. The agent reads `docs/skills/<skill>.md` before starting work.

## Available skills

| Skill | Purpose |
|-------|---------|
| [taskgraph-lifecycle-execution](taskgraph-lifecycle-execution.md) | Execute tasks with correct status transitions; prevent desync |
| [dolt-schema-migration](dolt-schema-migration.md) | Add/change columns safely; idempotent migrations via init |
| [cli-command-implementation](cli-command-implementation.md) | Add `tg` subcommands; config, escaping, JSON output |
| [plan-authoring](plan-authoring.md) | Write Cursor-format plans; dependencies, stable keys, domain/skill |
| [integration-testing](integration-testing.md) | Integration tests with temp Dolt repo; runTgCli, test-utils |
| [neverthrow-error-handling](neverthrow-error-handling.md) | Result/ResultAsync, buildError, CLI boundary; no throw for expected failures |
| [documentation-sync](documentation-sync.md) | Keep AGENT.md, cli-reference, schema in sync with code |
| [refactoring-safely](refactoring-safely.md) | Behavior-preserving changes; test before/after, small steps |
| [sql-migration](sql-migration.md) | Dolt schema changes; `information_schema` checks |
| [cli-command](cli-command.md) | Commander patterns; quick reference |
| [yaml-parsing](yaml-parsing.md) | Parse YAML frontmatter; type guards, neverthrow |
| [rule-authoring](rule-authoring.md) | Write/update Cursor rules |

Use the slug (e.g. `taskgraph-lifecycle-execution`) as the task's `skill` in plan YAML.
