# Glossary — Naming Conventions and Definitions

This document is the single source of truth for terminology used in Task Graph: naming conventions, definitions, and how terms relate. When adding or changing concepts, update the glossary and keep other docs aligned.

---

## Plan vs project

| Term        | Definition                                                                                                                                           | Where it lives                                                        | CLI / API                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------ |
| **Plan**    | A pre-execution strategic document: analysis, risks, dependency graph, and task breakdown. Written before work is tracked in the task graph.         | Markdown files in `plans/` (e.g. `plans/yy-mm-dd_feature_name.md`).   | N/A (file-based).                                      |
| **Project** | The task-graph entity created when a plan is imported. Holds the same identity (title, intent, tasks, status) and is the unit of execution tracking. Project status is **active** (not draft) when it has any task in `doing` or `done`; the CLI sets this automatically on first `tg start` or on import when tasks are already doing/done. | Dolt table `project` (view `plan` exists for backward compatibility). | `tg project list`, `tg project new`, `--project <id>`. |

**Rule of thumb:** If it’s in a markdown file in `plans/`, it’s a **plan**. Once it’s in the task graph (after `tg import`), it’s a **project**. Use “project” in CLI commands, flags, and code when referring to the entity in the graph.

**Note:** During the plan→project rename, some CLI and docs may still say “plan” where they mean “project”; the glossary reflects the target convention.

---

## Execution and workflow

| Term             | Definition                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Wave**         | A group of work that can be executed together. Used for planning and execution ordering: “Wave 1” = unblocked tasks that can start in parallel; “Wave 2” = tasks that depend on Wave 1; etc. Prefer “wave” over “phase” in docs and plans. |
| **Task**         | A single unit of work in the task graph. Has status (todo, doing, blocked, done, canceled), optional blockers, and events (started, done, note, etc.).                                                                                     |
| **Blocked**      | A task that cannot run until one or more other tasks (its blockers) are done.                                                                                                                                                              |
| **Evidence**     | Text supplied when marking a task done (`tg done --evidence "..."`). Describes what was done (commands run, git ref, test outcome).                                                                                                        |
| **Sub-agent**    | A specialized agent (implementer, reviewer, planner-analyst, etc.) dispatched by the orchestrator to do a single task or analysis. See [docs/leads/](leads/) and `.cursor/agents/`.                                                        |
| **Orchestrator** | The main agent session that owns planning, dispatch, and coordination; does not implement tasks itself.                                                                                                                                    |

---

## Task graph and data

| Term            | Definition                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task graph**  | The persisted store of projects, tasks, edges, and events. Backed by Dolt.                                                  |
| **Edge**        | A dependency or relationship between two tasks (e.g. “blocks”, “relates”).                                                  |
| **Event**       | An immutable record of something that happened (started, done, note, etc.). Stored in the `event` table with a body (JSON). |
| **Cycle**       | A time-bounded planning period (e.g. 2 weeks) bounding one or more Initiatives. Created with `tg cycle new`.                 |
| **Initiative**  | A strategic goal/theme bounded by a Cycle, grouping one or more Projects. See schema and `tg initiative` for current support. |
| **Soft-delete** | Canceling or abandoning instead of deleting. Use `tg cancel <projectId                                                      | taskId> --reason "..."`; never run DELETE/DROP/TRUNCATE on the task graph. See [no-hard-deletes.mdc](../.cursor/rules/no-hard-deletes.mdc). |

---

## Validation and quality

| Term                      | Definition                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gate**                  | The validation pipeline: lint (biome) → typecheck → tests. `pnpm gate` = changed-files scope; `pnpm gate:full` = full repo.                                                                             |
| **Cheap gate**            | Same as gate; implemented by `scripts/cheap-gate.sh`.                                                                                                                                                   |
| **Changed-files default** | Typecheck and tests default to only changed files (from git). Use `pnpm typecheck:all` or `pnpm gate:full` for full scope. See [changed-files-default.mdc](../.cursor/rules/changed-files-default.mdc). |

---

## Other conventions

| Term              | Definition                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cursor format** | The recommended plan file format: YAML frontmatter (`name`, `overview`, `todos`, etc.) plus markdown body. See [plan-format.md](plan-format.md) and [plan-import.md](plan-import.md). |
| **Worktree**      | An isolated working directory for a task (e.g. via Worktrunk). Used so implementers don’t collide; `tg start --worktree` creates one.                                                 |
| **MCP**           | Model Context Protocol. The Task Graph MCP server exposes tools (e.g. status, next) for other agents and IDEs. See [mcp.md](mcp.md).                                                  |

---

## Updating this glossary

- **New term or convention:** Add an entry and cross-link from relevant docs (AGENT.md, agent-contract, cli-reference, schema).
- **Renamed concept:** Update the glossary first, then docs and code per the rename plan.
- **Ambiguous usage:** Prefer the definition here; if the codebase still uses the old term, note it in the entry (e.g. “CLI flag may still be `--plan` during migration”).
