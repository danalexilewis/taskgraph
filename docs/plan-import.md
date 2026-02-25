# Plan Import

The Task Graph system supports importing tasks and dependencies directly from markdown files, allowing for a seamless transition from narrative planning to structured task management. This feature is particularly useful for initial plan creation or for incorporating plans drafted externally.

## Markdown Conventions

Markdown plan files (`.md`) follow a lightweight convention to define plans, tasks, and their relationships. These conventions are designed to be human-readable while providing enough structure for automated parsing.

### Plan Definition

-   **Plan Title**: The main heading (`#`) of the document is treated as the plan's title.
    ```markdown
    # My Feature Plan
    ```

-   **Plan Intent**: A line starting with `INTENT:` is parsed as the plan's intent.
    ```markdown
    INTENT: To implement a new user authentication system with OAuth support.
    ```

### Task Definition

Tasks are defined using specific keywords. Each task block starts with `TASK:` and contains its metadata.

-   **Task Key**: `TASK: <stable-key>`
    -   **Required**: A unique, stable identifier for the task within the plan (e.g., `auth-api-login`). This maps to `task.external_key` in the database and is used for upserting and referencing dependencies.

-   **Task Title**: `TITLE: <title>`
    -   The human-readable title of the task.

-   **Feature Key**: `FEATURE: <feature>`
    -   Associates the task with a feature for portfolio analysis (e.g., `auth`, `billing`).

-   **Area**: `AREA: <area>`
    -   Specifies the functional area the task belongs to (e.g., `frontend`, `backend`, `db`, `infra`).

-   **Blocked By**: `BLOCKED_BY: <stable-key>, <stable-key>, ...`
    -   A comma-separated list of `stable-key`s of other tasks that *this* task is blocked by. These will be translated into `blocks` edges in the database.

-   **Acceptance Criteria**: `ACCEPTANCE:` followed by a bulleted list.
    -   Lists the conditions that must be met for the task to be considered complete.

#### Example Task Block:

```markdown
TASK: auth-api-endpoint
TITLE: Implement User Authentication API Endpoint
FEATURE: authentication
AREA: backend
BLOCKED_BY: db-schema-users
ACCEPTANCE:
- Endpoint `/auth/login` exists and accepts POST requests.
- Valid credentials return JWT.
- Invalid credentials return 401 error.
```

## Importer Rules

The `tg import` command processes the markdown file based on these rules:

-   **Plan Association**: The imported tasks are associated with an existing plan by its ID or title. If no matching plan is found, a new plan is created with the markdown's title and intent (or provided defaults).
-   **Task Upsertion**: Tasks are upserted into the `task` table based on their `external_key` (the `stable-key` from the markdown).
    -   If a task with the same `external_key` exists for the plan, its mutable fields (`title`, `feature_key`, `area`, `acceptance`) are updated.
    -   If not, a new task is created.
-   **Edge Creation**: `blocks` edges are created in the `edge` table based on the `BLOCKED_BY` references.
    -   The importer attempts to resolve `stable-key`s to `task_id`s. If a blocker task is not found (either existing or newly created in the same import run), a warning is logged, and the edge is skipped.
-   **Event Logging**: A `created` event is automatically logged for each newly created task.
-   **Dolt Commits**: All changes (plan creation, task upserts, edge creations) are committed to Dolt with a descriptive commit message.

## CLI Usage

To import a markdown plan file:

```bash
tg import <filePath> --plan "<planTitleOrId>"
```

-   `<filePath>`: The path to your markdown plan file (e.g., `plans/my-new-feature.md`).
-   `--plan <planTitleOrId>`: **(Required)** Specify the title or ID of the plan to which these tasks should belong. If the plan doesn't exist, it will be created using the markdown's title and intent, or fallback values.

**Example:**

```bash
tg import plans/onboarding-flow.md --plan "User Onboarding Flow"
# Assuming 'User Onboarding Flow' plan exists or is created.
# Output: Successfully imported tasks and edges from plans/onboarding-flow.md to plan <plan_id>.
```
