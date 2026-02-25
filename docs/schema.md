# Dolt Schema Reference

The Task Graph system leverages Dolt as its underlying data store, providing version control capabilities for all stored data. The schema consists of five main tables: `plan`, `task`, `edge`, `event`, and `decision`.

All UUIDs (e.g., `plan_id`, `task_id`) are stored as `CHAR(36)`. Enumerated types are used for status fields to ensure data integrity. JSON columns are utilized for flexible data storage where schema is less rigid, such as `acceptance` criteria or event `body`.

## Table: `plan`

Represents a high-level plan, which can contain multiple tasks. Corresponds to a Cursor Plan document.

| Column        | Type                     | Constraints           | Description                                    |
| :------------ | :----------------------- | :-------------------- | :--------------------------------------------- |
| `plan_id`     | `CHAR(36)`               | `PRIMARY KEY`         | Unique identifier for the plan                 |
| `title`       | `VARCHAR(255)`           | `NOT NULL`            | Title of the plan                              |
| `intent`      | `TEXT`                   | `NOT NULL`            | Detailed intent or goal of the plan            |
| `status`      | `ENUM('draft','active','paused','done','abandoned')` | `DEFAULT 'draft'`     | Current status of the plan                     |
| `priority`    | `INT`                    | `DEFAULT 0`           | Priority level of the plan                     |
| `source_path` | `VARCHAR(512)`           | `NULL`                | Path to the source Cursor Plan document (e.g., `plans/feature-x.md`) |
| `source_commit` | `VARCHAR(64)`            | `NULL`                | Git commit hash of the source document         |
| `created_at`  | `DATETIME`               | `NOT NULL`            | Timestamp when the plan was created            |
| `updated_at`  | `DATETIME`               | `NOT NULL`            | Timestamp when the plan was last updated       |

## Table: `task`

Represents an individual task within a plan, which can have dependencies and events.

| Column        | Type                                 | Constraints                        | Description                                    |
| :------------ | :----------------------------------- | :--------------------------------- | :--------------------------------------------- |
| `task_id`     | `CHAR(36)`                           | `PRIMARY KEY`                      | Unique identifier for the task                 |
| `plan_id`     | `CHAR(36)`                           | `NOT NULL`, `FK -> plan.plan_id`   | Foreign key to the parent plan                 |
| `feature_key` | `VARCHAR(64)`                        | `NULL`                             | Key for portfolio analysis (e.g., `auth`, `billing`) |
| `title`       | `VARCHAR(255)`                       | `NOT NULL`                         | Title of the task                              |
| `intent`      | `TEXT`                               | `NULL`                             | Detailed intent or goal of the task            |
| `scope_in`    | `TEXT`                               | `NULL`                             | In-scope considerations for the task           |
| `scope_out`   | `TEXT`                               | `NULL`                             | Out-of-scope considerations for the task       |
| `acceptance`  | `JSON`                               | `NULL`                             | Array of acceptance criteria checks            |
| `status`      | `ENUM('todo','doing','blocked','done','canceled')` | `DEFAULT 'todo'`                   | Current status of the task                     |
| `owner`       | `ENUM('human','agent')`              | `DEFAULT 'agent'`                  | Who is responsible for the task                |
| `area`        | `VARCHAR(64)`                        | `NULL`                             | Functional area (e.g., `frontend`, `backend`, `db`) |
| `risk`        | `ENUM('low','medium','high')`        | `DEFAULT 'low'`                    | Risk level associated with the task            |
| `estimate_mins` | `INT`                                | `NULL`                             | Estimated time to complete in minutes          |
| `created_at`  | `DATETIME`                           | `NOT NULL`                         | Timestamp when the task was created            |
| `updated_at`  | `DATETIME`                           | `NOT NULL`                         | Timestamp when the task was last updated       |
| `external_key`| `VARCHAR(128)`                       | `NULL`, `UNIQUE`                   | Stable key for markdown import                 |

## Table: `edge`

Represents dependencies and relationships between tasks as a directed graph.

| Column         | Type         | Constraints                                  | Description                                    |
| :------------- | :----------- | :------------------------------------------- | :--------------------------------------------- |
| `from_task_id` | `CHAR(36)`   | `NOT NULL`, `FK -> task.task_id`             | ID of the blocking/relating task               |
| `to_task_id`   | `CHAR(36)`   | `NOT NULL`, `FK -> task.task_id`             | ID of the blocked/related task                 |
| `type`         | `ENUM('blocks','relates')` | `DEFAULT 'blocks'`                           | Type of relationship (e.g., `blocks`, `relates`) |
| `reason`       | `TEXT`       | `NULL`                                       | Reason for the dependency                      |
| `PRIMARY KEY`  |              | `(from_task_id, to_task_id, type)` | Composite primary key to ensure unique edges   |

## Table: `event`

An append-only log of operational events related to tasks, providing historical context and auditability.

| Column       | Type                                         | Constraints                        | Description                                    |
| :----------- | :------------------------------------------- | :--------------------------------- | :--------------------------------------------- |
| `event_id`   | `CHAR(36)`                                   | `PRIMARY KEY`                      | Unique identifier for the event                |
| `task_id`    | `CHAR(36)`                                   | `NOT NULL`, `FK -> task.task_id`   | Foreign key to the associated task             |
| `kind`       | `ENUM('created','started','progress','blocked','unblocked','done','split','decision_needed','note')` | `NOT NULL`                         | Type of event                                  |
| `body`       | `JSON`                                       | `NOT NULL`                         | JSON payload containing event-specific details |
| `actor`      | `ENUM('human','agent')`                      | `DEFAULT 'agent'`                  | Who performed the event                        |
| `created_at` | `DATETIME`                                   | `NOT NULL`                         | Timestamp when the event occurred              |

## Table: `decision`

Optional but high-leverage table for recording key decisions made during development.

| Column         | Type           | Constraints                        | Description                                    |
| :------------- | :------------- | :--------------------------------- | :--------------------------------------------- |
| `decision_id`  | `CHAR(36)`     | `PRIMARY KEY`                      | Unique identifier for the decision             |
| `plan_id`      | `CHAR(36)`     | `NOT NULL`, `FK -> plan.plan_id`   | Foreign key to the associated plan             |
| `task_id`      | `CHAR(36)`     | `NULL`, `FK -> task.task_id`       | Optional foreign key to the associated task    |
| `summary`      | `VARCHAR(255)` | `NOT NULL`                         | Brief summary of the decision                  |
| `context`      | `TEXT`         | `NOT NULL`                         | Context or background leading to the decision  |
| `options`      | `JSON`         | `NULL`                             | JSON array of options considered               |
| `decision`     | `TEXT`         | `NOT NULL`                         | The decision that was made                     |
| `consequences` | `TEXT`         | `NULL`                             | Anticipated consequences of the decision       |
| `source_ref`   | `VARCHAR(512)` | `NULL`                             | Reference to external documentation (e.g., PR link) |
| `created_at`   | `DATETIME`     | `NOT NULL`                         | Timestamp when the decision was recorded       |

## Invariants

The following business logic invariants are enforced by the application to maintain graph integrity:

-   A `done` task cannot have any blocking inbound edges from tasks that are not `done` or `canceled`.
-   A `doing` task must have an active "started" event as its latest terminal state.
-   `blocked` tasks must have at least one unmet blocker (or a "blocked" event with a reason).
-   Edges of `type='blocks'` must not create cycles in the task graph. This is enforced by application logic (DFS cycle detection).