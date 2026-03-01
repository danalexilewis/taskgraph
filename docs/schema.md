---
triggers:
  files: ["src/db/**", "src/domain/types.ts"]
  change_types: ["create", "modify"]
  keywords: ["schema", "column", "table", "migration"]
---

# Dolt Schema Reference

The Task Graph system leverages Dolt as its underlying data store, providing version control capabilities for all stored data. The schema consists of core tables (`plan`/`project`, `task`, `edge`, `event`, `decision`, `gate`) and optional strategic tables (`cycle`, `initiative`).

**Auto-migrate**: Every CLI command (except `init` and `setup`) runs idempotent migrations at startup. Agents never encounter a stale schema. See [multi-agent](multi-agent.md) for event body conventions.

All UUIDs (e.g., `plan_id`, `task_id`) are stored as `CHAR(36)`. Enumerated types are used for status fields to ensure data integrity. JSON columns are utilized for flexible data storage where schema is less rigid, such as `acceptance` criteria or event `body`.

## Table: `plan`

Represents a high-level plan, which can contain multiple tasks. Corresponds to a Cursor Plan document.

| Column          | Type           | Constraints       | Description                                                                                                                                                                                                                                                                                                                                           |
| --------------- | -------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan_id`       | `CHAR(36)`     | `PRIMARY KEY`     | Unique identifier for the plan                                                                                                                                                                                                                                                                                                                        |
| `title`         | `VARCHAR(255)` | `NOT NULL`        | Title of the plan                                                                                                                                                                                                                                                                                                                                     |
| `intent`        | `TEXT`         | `NOT NULL`        | Detailed intent or goal of the plan                                                                                                                                                                                                                                                                                                                   |
| `status`        | `ENUM`         | `DEFAULT 'draft'` | Current status of the plan (values: see [ENUM reference](#enum-reference) below). **Semantics:** When any task in the plan is `doing` or `done`, the project should be `active`, not `draft`. The CLI transitions `draft` → `active` on the first `tg start` for a task in that plan, and on import when the plan has any task already in doing/done. |
| `priority`      | `INT`          | `DEFAULT 0`       | Priority level of the plan                                                                                                                                                                                                                                                                                                                            |
| `source_path`   | `VARCHAR(512)` | `NULL`            | Path to the source Cursor Plan document (e.g., `plans/feature-x.md`)                                                                                                                                                                                                                                                                                  |
| `source_commit` | `VARCHAR(64)`  | `NULL`            | Git commit hash of the source document                                                                                                                                                                                                                                                                                                                |
| `created_at`    | `DATETIME`     | `NOT NULL`        | Timestamp when the plan was created                                                                                                                                                                                                                                                                                                                   |
| `updated_at`    | `DATETIME`     | `NOT NULL`        | Timestamp when the plan was last updated                                                                                                                                                                                                                                                                                                              |
| `file_tree`     | `TEXT`         | `NULL`            | Tree of files affected (rich planning)                                                                                                                                                                                                                                                                                                                |
| `risks`         | `JSON`         | `NULL`            | Array of `{description, severity, mitigation}` (rich planning)                                                                                                                                                                                                                                                                                        |
| `tests`         | `JSON`         | `NULL`            | Array of test descriptions to create (rich planning)                                                                                                                                                                                                                                                                                                  |
| `hash_id`       | `VARCHAR(20)`  | `NULL`            | Short identifier for the plan; basis for the plan branch name (`plan-<hash_id>`). Format: `p-XXXXXX` (6 hex chars). Added by `applyPlanHashIdMigration`.                                                                                                                                                                                              |

## Table: `task`

Represents an individual task within a plan, which can have dependencies and events.

| Column              | Type           | Constraints                      | Description                                                                      |
| ------------------- | -------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| `task_id`           | `CHAR(36)`     | `PRIMARY KEY`                    | Unique identifier for the task                                                   |
| `hash_id`           | `VARCHAR(10)`  | `NULL`, `UNIQUE`                 | Short form for CLI (e.g., `tg-XXXXXX`)                                           |
| `plan_id`           | `CHAR(36)`     | `NOT NULL`, `FK -> plan.plan_id` | Foreign key to the parent plan                                                   |
| `feature_key`       | `VARCHAR(64)`  | `NULL`                           | Key for portfolio analysis (e.g., `auth`, `billing`)                             |
| `title`             | `VARCHAR(255)` | `NOT NULL`                       | Title of the task                                                                |
| `intent`            | `TEXT`         | `NULL`                           | Detailed intent or goal of the task                                              |
| `scope_in`          | `TEXT`         | `NULL`                           | In-scope considerations for the task                                             |
| `scope_out`         | `TEXT`         | `NULL`                           | Out-of-scope considerations for the task                                         |
| `acceptance`        | `JSON`         | `NULL`                           | Array of acceptance criteria checks                                              |
| `status`            | `ENUM`         | `DEFAULT 'todo'`                 | Current status of the task (values: see [ENUM reference](#enum-reference) below) |
| `owner`             | `ENUM`         | `DEFAULT 'agent'`                | Who is responsible for the task (`human`, `agent`)                               |
| `area`              | `VARCHAR(64)`  | `NULL`                           | Functional area (e.g., `frontend`, `backend`, `db`)                              |
| `risk`              | `ENUM`         | `DEFAULT 'low'`                  | Risk level (`low`, `medium`, `high`)                                             |
| `estimate_mins`     | `INT`          | `NULL`                           | Estimated time to complete in minutes                                            |
| `created_at`        | `DATETIME`     | `NOT NULL`                       | Timestamp when the task was created                                              |
| `updated_at`        | `DATETIME`     | `NOT NULL`                       | Timestamp when the task was last updated                                         |
| `external_key`      | `VARCHAR(128)` | `NULL`, `UNIQUE`                 | Stable key for markdown import                                                   |
| `change_type`       | `ENUM`         | `NULL`                           | How to approach the work (values: see [ENUM reference](#enum-reference) below)   |
| `suggested_changes` | `TEXT`         | `NULL`                           | Proposed code snippets as starting point (rich planning)                         |

A task may have multiple domains and skills, stored in junction tables below.

## Table: `task_domain`

Junction table: many-to-many between tasks and domains (knowledge areas → `docs/<domain>.md`).

| Column        | Type          | Constraints                      | Description            |
| ------------- | ------------- | -------------------------------- | ---------------------- |
| `task_id`     | `CHAR(36)`    | `NOT NULL`, `FK -> task.task_id` | Task reference         |
| `domain`      | `VARCHAR(64)` | `NOT NULL`                       | Domain slug            |
| `PRIMARY KEY` |               | `(task_id, domain)`              | Unique per task/domain |

## Table: `task_skill`

Junction table: many-to-many between tasks and skills (techniques → `docs/skills/<skill>.md`).

| Column        | Type          | Constraints                      | Description           |
| ------------- | ------------- | -------------------------------- | --------------------- |
| `task_id`     | `CHAR(36)`    | `NOT NULL`, `FK -> task.task_id` | Task reference        |
| `skill`       | `VARCHAR(64)` | `NOT NULL`                       | Skill slug            |
| `PRIMARY KEY` |               | `(task_id, skill)`               | Unique per task/skill |

## Table: `edge`

Represents dependencies and relationships between tasks as a directed graph.

| Column         | Type       | Constraints                        | Description                                  |
| -------------- | ---------- | ---------------------------------- | -------------------------------------------- |
| `from_task_id` | `CHAR(36)` | `NOT NULL`, `FK -> task.task_id`   | ID of the blocking/relating task             |
| `to_task_id`   | `CHAR(36)` | `NOT NULL`, `FK -> task.task_id`   | ID of the blocked/related task               |
| `type`         | `ENUM`     | `DEFAULT 'blocks'`                 | Type of relationship (`blocks`, `relates`)   |
| `reason`       | `TEXT`     | `NULL`                             | Reason for the dependency                    |
| `PRIMARY KEY`  |            | `(from_task_id, to_task_id, type)` | Composite primary key to ensure unique edges |

## Table: `event`

An append-only log of operational events related to tasks, providing historical context and auditability.

| Column       | Type       | Constraints                      | Description                                                                                                                                                        |
| ------------ | ---------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `event_id`   | `CHAR(36)` | `PRIMARY KEY`                    | Unique identifier for the event                                                                                                                                    |
| `task_id`    | `CHAR(36)` | `NOT NULL`, `FK -> task.task_id` | Foreign key to the associated task                                                                                                                                 |
| `kind`       | `ENUM`     | `NOT NULL`                       | Type of event (values: see [ENUM reference](#enum-reference) below)                                                                                                |
| `body`       | `JSON`     | `NOT NULL`                       | JSON payload. Conventions: `started` → `{ agent, timestamp }`; `note` → `{ message, agent, timestamp }`; `done` → may include evidence (e.g. gate or test result). |
| `actor`      | `ENUM`     | `DEFAULT 'agent'`                | Who performed the event (`human`, `agent`)                                                                                                                         |
| `created_at` | `DATETIME` | `NOT NULL`                       | Timestamp when the event occurred                                                                                                                                  |

## Table: `decision`

Optional but high-leverage table for recording key decisions made during development.

| Column         | Type           | Constraints                      | Description                                         |
| -------------- | -------------- | -------------------------------- | --------------------------------------------------- |
| `decision_id`  | `CHAR(36)`     | `PRIMARY KEY`                    | Unique identifier for the decision                  |
| `plan_id`      | `CHAR(36)`     | `NOT NULL`, `FK -> plan.plan_id` | Foreign key to the associated plan                  |
| `task_id`      | `CHAR(36)`     | `NULL`, `FK -> task.task_id`     | Optional foreign key to the associated task         |
| `summary`      | `VARCHAR(255)` | `NOT NULL`                       | Brief summary of the decision                       |
| `context`      | `TEXT`         | `NOT NULL`                       | Context or background leading to the decision       |
| `options`      | `JSON`         | `NULL`                           | JSON array of options considered                    |
| `decision`     | `TEXT`         | `NOT NULL`                       | The decision that was made                          |
| `consequences` | `TEXT`         | `NULL`                           | Anticipated consequences of the decision            |
| `source_ref`   | `VARCHAR(512)` | `NULL`                           | Reference to external documentation (e.g., PR link) |
| `created_at`   | `DATETIME`     | `NOT NULL`                       | Timestamp when the decision was recorded            |

## Table: `gate`

Represents external gates that block a task until an external condition is satisfied (e.g., human approval, CI pass, webhook). Unlike task-on-task blocking (see `edge` with `type='blocks'`), gates model dependencies on conditions outside the task graph.

| Column        | Type           | Constraints                  | Description                                                                       |
| ------------- | -------------- | ---------------------------- | --------------------------------------------------------------------------------- |
| `gate_id`     | `CHAR(36)`     | `PRIMARY KEY`                | Unique identifier for the gate                                                    |
| `name`        | `VARCHAR(255)` | `NOT NULL`                   | Human-readable name for the gate (e.g., "QA sign-off", "CI green")                |
| `gate_type`   | `ENUM`         | `NOT NULL`                   | Kind of gate (`human`, `ci`, `webhook`)                                           |
| `status`      | `ENUM`         | `DEFAULT 'pending'`          | Current status (`pending`, `resolved`, `expired`); resolved when condition is met |
| `task_id`     | `CHAR(36)`     | `NULL`, `FK -> task.task_id` | Optional task that is blocked until this gate is resolved                         |
| `resolved_at` | `DATETIME`     | `NULL`                       | Timestamp when the gate was resolved                                              |
| `created_at`  | `DATETIME`     | `NOT NULL`                   | Timestamp when the gate was created                                               |

**Gates vs blocks:** A **gate** blocks a task on an _external_ condition (human, CI, webhook). The **block** command and `edge` table with `type='blocks'` model a task blocked on _another task_ in the graph. Use gates when the dependency is outside the task graph; use blocks for task-on-task dependencies.

## Table: `cycle`

A time-bounded planning period (e.g. a sprint or quarter) that groups one or more initiatives. Created with `tg cycle new`.

| Column       | Type           | Constraints   | Description                               |
| ------------ | -------------- | ------------- | ----------------------------------------- |
| `cycle_id`   | `CHAR(36)`     | `PRIMARY KEY` | Unique identifier for the cycle           |
| `name`       | `VARCHAR(255)` | `NOT NULL`    | Display name (e.g. "Sprint 1")            |
| `start_date` | `DATE`         | `NOT NULL`    | Start of the cycle                        |
| `end_date`   | `DATE`         | `NOT NULL`    | End of the cycle                          |
| `created_at` | `DATETIME`     | `NOT NULL`    | Timestamp when the cycle was created      |
| `updated_at` | `DATETIME`     | `NOT NULL`    | Timestamp when the cycle was last updated |

**Migration order:** Create `cycle` first (e.g. `applyCycleMigration`), then add `initiative.cycle_id` (e.g. `applyInitiativeCycleIdMigration`).

## Table: `initiative`

A strategic goal or theme bounded by a cycle, grouping one or more projects. Optional; created and managed via `tg initiative`.

| Column          | Type           | Constraints                    | Description                                         |
| --------------- | -------------- | ------------------------------ | --------------------------------------------------- |
| `initiative_id` | `CHAR(36)`     | `PRIMARY KEY`                  | Unique identifier for the initiative                |
| `title`         | `VARCHAR(255)` | `NOT NULL`                     | Title of the initiative                             |
| `description`   | `TEXT`         | `NOT NULL`                     | Description                                         |
| `status`        | `ENUM`         | `DEFAULT 'draft'`              | Status (draft, active, paused, done, abandoned)     |
| `cycle_start`   | `DATE`         | `NULL`                         | Inline start (or from cycle)                        |
| `cycle_end`     | `DATE`         | `NULL`                         | Inline end (or from cycle)                          |
| `cycle_id`      | `CHAR(36)`     | `NULL`, `FK -> cycle.cycle_id` | Optional link to a cycle (prefer over inline dates) |
| `created_at`    | `DATETIME`     | `NOT NULL`                     | Timestamp when created                              |
| `updated_at`    | `DATETIME`     | `NOT NULL`                     | Timestamp when last updated                         |

## Table: `plan_worktree`

Tracks the per-plan git worktree created by `tg start --worktree` when the plan has a `hash_id`. One row per plan. The plan branch (`plan-<hash_id>`) is the merge target for all task worktrees belonging to that plan. The plan worktree is never removed by `tg done`; it accumulates merged task work until the plan is complete.

| Column            | Type           | Constraints                         | Description                                                  |
| ----------------- | -------------- | ----------------------------------- | ------------------------------------------------------------ |
| `plan_id`         | `CHAR(36)`     | `PRIMARY KEY`, `FK -> plan.plan_id` | Plan this worktree belongs to                                |
| `worktree_path`   | `VARCHAR(512)` | `NOT NULL`                          | Absolute path to the plan worktree directory                 |
| `worktree_branch` | `VARCHAR(128)` | `NOT NULL`                          | Git branch name for the plan worktree (e.g. `plan-p-a1b2c3`) |
| `created_at`      | `DATETIME`     | `NOT NULL`                          | Timestamp when the plan worktree was created                 |

## Invariants

The following business logic invariants are enforced by the application to maintain graph integrity:

- A `done` task cannot have any blocking inbound edges from tasks that are not `done` or `canceled`.
- A `doing` task must have an active "started" event as its latest terminal state.
- **Materialized `blocked`**: `task.status = 'blocked'` is a materialized view of the blocks graph. It is set when the task has at least one _unmet_ blocker—i.e., an edge of type `blocks` from a task that is not `done` or `canceled`. It is cleared to `todo` when all such blockers are `done` or `canceled`. This materialization is kept in sync on: plan import, `tg block`, `tg edge add` (for type `blocks`), `tg done`, `tg cancel`, and when adding cross-plan edges via `tg crossplan edges`.
- Edges of `type='blocks'` must not create cycles in the task graph. This is enforced by application logic (DFS cycle detection).

## Decisions / gotchas

- **cachedQuery raw writes**: For cache invalidation, `extractWriteTable` must recognize not only `INSERT INTO table` but also `UPDATE table` and `DELETE FROM table`; otherwise raw DELETE/UPDATE do not invalidate the affected table cache.
- **SELECT COUNT(\*) with mysql2**: When using the server pool (mysql2), result column names can differ from the execa/JSON path. Use an alias (e.g. `SELECT COUNT(*) AS cnt`) and read `Number(row.cnt)` so the same code works for both paths.
- **Dolt JSON columns**: `event.body` may be returned as object or string by doltSql depending on driver. Handle both: `typeof raw === 'string' ? JSON.parse(raw) : raw`.
- **DAL writable**: All Dolt invocations use `--data-dir <repoPath>` and `DOLT_READ_ONLY=false` in env so Dolt treats the session as writable when the repo allows it.
- **Plan → project table**: After the schema migration renames `plan` to `project`, all application code must query/insert/update the `project` table (not `plan`). The view `plan` exists for backward compatibility. PROTECTED_TABLES includes both `plan` (view) and `project`.

## ENUM reference

Columns whose Type is `ENUM` in the tables above have the following value lists (exact SQL enum literals):

| Table.Column       | Values                                                                             |
| ------------------ | ---------------------------------------------------------------------------------- |
| `plan.status`      | draft, active, paused, done, abandoned                                             |
| `task.status`      | todo, doing, blocked, done, canceled                                               |
| `task.owner`       | human, agent                                                                       |
| `task.risk`        | low, medium, high                                                                  |
| `task.change_type` | create, modify, refactor, fix, investigate, test, document                         |
| `edge.type`        | blocks, relates                                                                    |
| `event.kind`       | created, started, progress, blocked, unblocked, done, split, decision_needed, note |
| `event.actor`      | human, agent                                                                       |
| `gate.gate_type`   | human, ci, webhook                                                                 |
| `gate.status`      | pending, resolved, expired                                                         |

## Related projects

- Task Graph Implementation
- Thin SQL Query Builder
- Restructure package — src at root, standard npm layout
