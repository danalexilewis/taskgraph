---
triggers:
  files: ["src/plan-import/**"]
  change_types: ["create", "modify"]
  keywords: ["import", "parser", "cursor format"]
---

# Plan Import

The Task Graph system supports importing tasks and dependencies directly from markdown files, allowing for a seamless transition from narrative planning to structured task management. This feature is particularly useful for initial plan creation or for incorporating plans drafted externally.

Two formats are supported: **Cursor** (YAML frontmatter with todos) and **Legacy** (TASK:/TITLE:/BLOCKED_BY:). Use `--format cursor` for Cursor plans.

## Cursor Format (Recommended)

Plans produced by Cursor planning mode use YAML frontmatter with a `todos` array. Use `--format cursor` when importing:

```bash
tg import plans/feature-x.md --plan "Feature X" --format cursor
```

### Structure

```yaml
---
name: Plan Name
overview: "Brief description."
todos:
  - id: task-1
    content: "Task title"
    status: pending
  - id: task-2
    content: "Depends on task-1"
    blockedBy: [task-1]
    status: completed
isProject: false
---
```

### Todo Fields

| Field | Description |
|-------|-------------|
| `id` | Stable key → `external_key` in DB |
| `content` | Task title |
| `status` | `pending` → todo, `completed` → done |
| `blockedBy` | Array of todo `id`s that block this task |
| `domain` | Single domain slug or array of slugs → `docs/<domain>.md` (stored in `task_domain`) |
| `skill` | Single skill slug or array of slugs → `docs/skills/<skill>.md` (stored in `task_skill`) |

## Multi-project file import behavior

When the plan file uses the **multi-project format** (top-level `projects` array in Cursor frontmatter), import behaves as follows:

- **N project rows:** The importer creates or updates one **project** row per element in `projects`. Each project gets its `name` and `overview` (and optional plan-level fields such as `fileTree`, `risks`, `tests`) from that element.
- **Initiative:** If the file has a top-level `initiative` (ID or title), or the user passes `--initiative`, the importer assigns `project.initiative_id` for each created/updated project when the initiative can be resolved (e.g. single row match by ID or unique title).
- **Tasks per project:** Tasks from each project’s `todos` are upserted with the **correct plan_id** for that project. Task `blockedBy` and edges are scoped to the same project; cross-project dependencies are not represented in the imported edges.
- **Backward compatibility:** If the file has **no** `projects` key, import treats it as a single plan (one project). Existing single-project behavior is unchanged: one project created or matched by `--plan`, all todos upserted to that project.

Implementation note: multi-project parsing and import are added in stages; see the Strategic Planning Implementation plan. Until the parser and importer support the `projects` array, use one plan file per project and link them to an initiative via `tg initiative assign-project` after import.

## Legacy Format (Markdown Conventions)

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

-   **Domain**: `DOMAIN: <domain>` or multiple `DOMAIN:` lines (or comma-separated values).
    -   Knowledge area(s) → `docs/<domain>.md`. Stored in `task_domain`.

-   **Skill**: `SKILL: <skill>` or multiple `SKILL:` lines (or comma-separated values).
    -   Technique(s) → `docs/skills/<skill>.md`. Stored in `task_skill`.

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

## Re-import and ID stability

Tasks are matched to the plan by **stable keys**: in Cursor format the todo `id` maps to `external_key`; in Legacy format the `TASK:` stable-key does. Re-importing the same plan (or an updated version) **upserts** by these keys: existing tasks are updated, new keys create new tasks.

If you **change todo ids** (or stable keys) between imports, existing tasks in the plan no longer match any task in the file. The importer treats them as **unmatched existing tasks**. In that case the command **fails** unless you pass:

- **`--force`**: Proceed anyway. The import runs and upserts/creates tasks from the file. Existing tasks that no longer match any key are left unchanged. You may end up with **duplicates** (old tasks plus new ones from the file).
- **`--replace`**: Cancel all existing tasks that would not be matched by this import (soft-delete to `canceled`), then run the upsert. Afterward the plan’s tasks are exactly those from the file (matched ones updated, new ones created; no leftover unmatched tasks).

Use **`--replace`** when you have rewritten the plan and want the graph to reflect only the new task set. Use **`--force`** only when you intentionally want to keep existing tasks and add new ones (e.g. one-off extra tasks from a variant file).

**Template apply** (`tg template apply`) uses the same logic when applying to an **existing** plan that already has tasks: it runs the same unmatched check before upserting. Use `--force` or `--replace` with `tg template apply` the same way as with `tg import` when the template’s task set would leave existing tasks unmatched.

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
tg import <filePath> --plan "<planTitleOrId>" [--format cursor|legacy] [--force] [--replace]
```

-   `<filePath>`: The path to your markdown plan file (e.g., `plans/my-new-feature.md`).
-   `--plan <planTitleOrId>`: **(Required)** Specify the title or ID of the plan to which these tasks should belong. If the plan doesn't exist, it will be created using the markdown's title and intent, or fallback values.
-   `--format <format>`: Plan format. `cursor` for YAML frontmatter with todos; `legacy` for TASK:/TITLE:/BLOCKED_BY: (default).
-   `--force`: Proceed with import even when some existing tasks would be unmatched (e.g. todo ids changed). May create duplicates; unmatched tasks are left as-is.
-   `--replace`: Cancel existing tasks that would not be matched by this import, then upsert. Use when the plan file is the new source of truth and you want no leftover unmatched tasks.

**Example:**

```bash
tg import plans/onboarding-flow.md --plan "User Onboarding Flow"
# Assuming 'User Onboarding Flow' plan exists or is created.
# Output: Successfully imported tasks and edges from plans/onboarding-flow.md to plan <plan_id>.
```

## Gotchas / implementation notes

- **Task title**: Stored in `task.title` as `VARCHAR(255)`. Keep plan todo titles (YAML `content`) under 255 characters or import will fail.
- **Task external_key**: Plan-scoped. Import appends a 6-char hex hash of `plan_id` to the todo `id` (e.g. `wt-integration-tests-a1b2c3`) so the same todo id in different plans does not violate the unique constraint. Re-import of the same plan upserts by this stable key; export strips the suffix so round-trip YAML uses stable ids.
- **INSERT/UPDATE plan data**: After the plan→project rename migration, `plan` is a view. Dolt does not allow INSERT into a view. Use table **`project`** (not `plan`) for writes in import and template apply. See `src/cli/import.ts` and `src/cli/template.ts`.
- **Initiative**: When the `project` table exists, initiative is resolved by ID or title (single row match). Frontmatter `initiative` and CLI `--initiative` both accept either; use a unique initiative title when referring by title.

## Export and multi-project / initiative

Export produces Cursor-format markdown (YAML frontmatter + todos) suitable for re-import. How it behaves for single vs multiple projects and initiatives:

### Current behavior (single-project export)

- **`tg export markdown --plan <planId>`** exports exactly one project: its title, overview (from `project.intent`), and all tasks for that project. Output is one file (default `exports/<planId>.md`). Task `external_key` values have the plan-scoped 6-char suffix stripped so round-trip YAML uses stable todo `id`s.
- **Mermaid and DOT** (`tg export mermaid`, `tg export dot`) support optional `--plan <planId>` or `--feature <featureKey>` to filter the graph; markdown export requires `--plan` and does not support feature-based export.

### Multi-project and strategic plans

- There is **no single-command export of multiple projects** into one file. Strategic or multi-project plans (e.g. several projects under one initiative) are exported **one project at a time**: run `tg export markdown --plan <planId>` for each project ID. Each output file is a single Cursor-format plan; re-import is also per-file with `tg import ... --plan "<name>"`.
- **Cross-project dependencies**: Task `blockedBy` and `edge` rows are plan-scoped in the sense that export only includes edges between tasks of the exported project. Dependencies that cross projects are not represented in the exported YAML (they live in the DB only). For round-trip of a multi-project setup, export each project to its own file and re-import each; cross-project blocks are not round-tripped.

### Initiative

- There is **no export-by-initiative** today. To get markdown for all projects under an initiative, list projects (e.g. via `tg status --projects --json` or DB) and run `tg export markdown --plan <planId>` for each. A future extension could add `--initiative <initiativeId>` to export all projects in that initiative (e.g. one file per project, or a single multi-section file, depending on design).

## Related

- **Plan creation** (mode classification, product analyst, checklist) is defined by the [plan skill](.cursor/skills/plan/SKILL.md), not by import. Import consumes the resulting plan file.

## Related projects

- Import pre-flight and duplicate prevention
- Plan Import Robustness for Simple Models
- Cursor Plan Import and Agent Workflow
