# Skill: Plan authoring

## Purpose

Write Cursor-format plans in `plans/` that import cleanly into taskgraph: clear dependencies, stable keys, and useful metadata (domain, skill, changeType) so agents know what to read and how to approach each task.

## Inputs

- Feature or initiative to break down
- Reference: `.cursor/rules/plan-authoring.mdc` (YAML structure, todo fields)
- Existing docs/skills slugs if tasks map to them

## Steps

1. Create `plans/<name>.md` with YAML frontmatter: `name`, `overview`, `todos`.
2. For each task: set `id` (kebab-case, stable key), `content` (task title), and optionally `blockedBy`, `domain`, `skill`, `changeType`.
3. Design the dependency graph: use `blockedBy` with other todos' `id` values; avoid cycles.
4. Keep tasks scoped (~90 min or less); split large work into multiple todos.
5. Order todos so the list reflects dependency order where possible (helps readability).
6. Add domain when the task touches a specific area (e.g. `schema`, `cli`); add skill when a technique applies (e.g. `dolt-schema-migration`); add changeType when approach matters (`create`, `refactor`, `fix`, etc.).
7. Validate: run `tg import plans/<file> --plan "Test" --format cursor` in a test repo and confirm tasks and edges match expectations.

## Gotchas

- `id` must be unique and stable; it becomes `external_key` (import appends a 6-char plan hash so the same id in different plans does not collide). Changing it on re-import creates a new task instead of updating.
- `blockedBy` references are resolved at import time; only reference `id`s that exist in the same plan (or were previously imported with that external_key).
- Task titles are truncated at 255 characters in the DB; keep `content` concise.
- If the plan has many tasks, consider grouping by phase or feature in the overview so reviewers can follow.

## Definition of done

- Plan file has valid YAML frontmatter and a non-empty `todos` array.
- All `blockedBy` values reference existing todo `id`s in the plan.
- Import succeeds and `tg next` / `tg show` reflect the intended graph.
- Domain/skill/changeType set where they add value for the agent.
