---
triggers:
  files: ["src/cli/**"]
  change_types: ["create", "modify"]
  keywords: ["command", "option", "flag", "CLI"]
---

# CLI Reference

The Task Graph Command Line Interface (`tg`) provides a comprehensive set of commands for managing plans, tasks, dependencies, events, and portfolio views. This document details each command, its options, and examples.

## Task IDs

All commands that accept `<taskId>` (or similar task ID arguments such as `<fromTaskId>`, `<toTaskId>`, `<blockerTaskId>`) accept both:

- **Full UUID**: e.g., `b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`
- **Short hash**: e.g., `tg-XXXXXX` (from the task's `hash_id` column)

## Global Options

All `tg` commands support the following global options:

- `--json`: Output machine-readable JSON instead of human-readable text. Useful for scripting.
- `--no-commit`: Perform a dry run; do not commit changes to the Dolt repository. (Applies only to commands that modify data.)
- `--commit-msg <msg>`: Override the default commit message for data-modifying commands.

## Commands

### `tg init`

Initializes the Task Graph system in the current directory. This command sets up the Dolt repository and applies necessary database migrations.

```bash
tg init
```

**Options:**

- `--no-commit`: Do not commit changes to Dolt.

**Output:**

- Repository path.
- Instructions on how to run a Dolt SQL server (if applicable).

**Example:**

```bash
tg init
# Output:
# Creating Dolt repository at /path/to/project/.taskgraph/dolt...
# Dolt repository created.
# Applying Dolt migrations...
# Dolt migrations applied.
# Configuration written to .taskgraph/config.json
# Task Graph initialized successfully.
```

### `tg setup`

Scaffolds recommended repo conventions used by agents:

- Example domain docs in `docs/` (e.g. `docs/backend.md`)
- Skill guides in `docs/skills/`
- (Optional) Cursor rules in `.cursor/rules/` plus `.cursor/memory.md`

```bash
tg setup
```

**Options:**

- `--no-docs`: Do not scaffold `docs/` and `docs/skills/`.
- `--no-cursor`: Do not scaffold `.cursor/` (rules + memory).
- `--force`: Overwrite existing files (default is to skip).

**Example:**

```bash
tg setup --force
```

### `tg plan new <title>`

Creates a new high-level plan.

```bash
tg plan new "<title>"
```

**Arguments:**

- `<title>`: The title of the new plan.

**Options:**

- `--intent <intent>`: A detailed intent or goal of the plan.
- `--source <path>`: Path to the source Cursor Plan document (e.g., `plans/feature-x.md`).

**Example:**

```bash
tg plan new "User Onboarding Flow" --intent "Streamline the process for new users signing up."
# Output:
# Plan created with ID: a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11
```

### `tg plan list` / `tg plan ls`

Lists all plans with their ID, title, and status. Use to discover plan IDs for `tg next --plan`, `tg export --plan`, and other commands.

```bash
tg plan list
# or
tg plan ls
```

**Output (human-readable):**

- One line per plan: `plan_id  title  (status)`
- Ordered by `created_at` DESC (newest first)

**Options:**

- `--json`: Output as JSON array of `{ plan_id, title, status, created_at }`.

**Example:**

```bash
tg plan list
# Output:
# Plans:
#   6dbadd46-a0a6-4033-897d-e259cecb8af1  Export Markdown and tg status  (draft)
#   3cf8e2e2-7cbc-4d07-95a0-bf4871e780bf  tg plan list  (draft)
```

### `tg task new <title>`

Creates a new task within an existing plan.

```bash
tg task new "<title>" --plan <planId>
```

**Arguments:**

- `<title>`: The title of the new task.

**Options:**

- `--plan <planId>`: **(Required)** The ID of the parent plan.
- `--feature <featureKey>`: A key for portfolio analysis (e.g., `auth`, `billing`).
- `--area <area>`: The functional area of the task (e.g., `frontend`, `backend`, `db`, `infra`).
- `--acceptance <json>`: A JSON array of acceptance criteria checks for the task.

**Example:**

```bash
tg task new "Develop Signup Form" --plan a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 --feature onboarding --area frontend --acceptance '["Form renders", "Submits data"]'
# Output:
# Task created with ID: b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 for Plan ID: a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11
```

### `tg edge add <fromTaskId> <type> <toTaskId>`

Adds a dependency edge between two tasks.

```bash
tg edge add <fromTaskId> blocks|relates <toTaskId>
```

**Arguments:**

- `<fromTaskId>`: The ID of the blocking or relating task.
- `<type>`: The type of edge, either `blocks` (indicating a hard dependency) or `relates` (indicating a softer relationship).
- `<toTaskId>`: The ID of the blocked or related task.

**Options:**

- `--reason <reason>`: A reason for establishing this dependency.

**Example:**

```bash
tg edge add b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 blocks c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 --reason "Frontend needs API"
# Output:
# Edge added: b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 blocks c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11
```

### `tg next`

Lists tasks that are currently runnable (status is `todo` and have no unmet blockers).

```bash
tg next
```

**Options:**

- `--plan <planId|title>`: Optional filter by plan ID or title.
- `--domain <domain>`: Filter by task domain (maps to `docs/<domain>.md`).
- `--skill <skill>`: Filter by task skill (maps to `docs/skills/<skill>.md`).
- `--change-type <type>`: Filter by change type: `create`, `modify`, `refactor`, `fix`, `investigate`, `test`, `document`.
- `--limit <limit>`: Limit the number of tasks returned (default: 10).

**Output fields (human-readable):**

- `task_id`, `title`, `plan title`, `risk`, `estimate`, `blockers count`.

**Example:**

```bash
tg next --plan "User Onboarding Flow"
# Output:
# Runnable Tasks:
#   ID: b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11, Title: Develop Signup Form, Plan: User Onboarding Flow, Risk: low, Estimate: N/A
```

### `tg note <taskIds...> --msg <text>`

Appends a note event to one or more tasks. Useful for breadcrumbs between agents (e.g., "Changed parser signature, heads up"). Same message and agent apply to all IDs. Exit code is 1 if any task fails. With `--json`, outputs an array of `{ id, status? }` or `{ id, error? }`.

```bash
tg note <taskIds...> --msg "<text>" [--agent <name>]
```

**Arguments:**

- `<taskIds...>`: One or more task IDs (space- or comma-separated).

**Options:**

- `--msg <text>`: **(Required)** The note message.
- `--agent <name>`: Agent identifier (default: "default").

**Example:**

```bash
tg note b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 --msg "Schema in flux, support both until migration lands" --agent alice
# Output:
# Note added to task b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.

tg note id1,id2 id3 --msg "Heads up" --json
# Output: [{"id":"id1","status":"ok"},{"id":"id2","status":"ok"},{"id":"id3","status":"ok"}]
```

### `tg show <taskId>`

Displays detailed information about a specific task, including its blockers, dependents, recent notes, and recent events.

```bash
tg show <taskId>
```

**Arguments:**

- `<taskId>`: The ID of the task to display.

**Example:**

```bash
tg show b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11
# Output:
# Task Details (ID: b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11):
#   Title: Develop Signup Form
#   Plan: User Onboarding Flow (ID: a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11)
#   Status: todo
#   Owner: agent
#   Area: frontend
#   Risk: low
#   Estimate: N/A minutes
#   Intent: N/A
#   Scope In: N/A
#   Scope Out: N/A
#   Acceptance: ["Form renders","Submits data"]
#   Created At: 2026-02-25 10:00:00
#   Updated At: 2026-02-25 10:00:00
#
# Blockers:
#   - Task ID: c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11, Title: Implement Auth API, Status: doing, Reason: API must be designed first
#
# Recent Events:
#   - Kind: created, Actor: agent, Created: 2026-02-25 10:00:00, Body: {"title":"Develop Signup Form"}
```

### `tg start <taskIds...>`

Moves one or more tasks from `todo` to `doing` status, indicating active work has begun. Each task is only allowed if runnable (no unmet blockers). If a task is already `doing`, returns `TASK_ALREADY_CLAIMED` unless `--force` is used. Options (e.g. `--agent`, `--force`) apply to all IDs. Exit code is 1 if any task fails. With `--json`, outputs an array of `{ id, status? }` or `{ id, error? }`.

```bash
tg start <taskIds...> [--agent <name>] [--force]
```

**Arguments:**

- `<taskIds...>`: One or more task IDs (space- or comma-separated in one token).

**Options:**

- `--agent <name>`: Agent identifier for multi-agent visibility. Recorded in the started event body. Applies to all IDs.
- `--force`: Override claim when a task is already being worked by another agent (human override). Applies to all IDs.

**Example:**

```bash
tg start b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 --agent alice
# Output:
# Task b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 started.

tg start id1 id2 --agent bob --json
# Output: [{"id":"id1","status":"doing"},{"id":"id2","status":"doing"}]
```

### `tg done <taskIds...> --evidence <text>`

Marks one or more tasks as `done`. Requires evidence of completion. Multiple IDs can be passed space-separated or comma-separated in one token. Options (e.g. `--evidence`, `--checks`) apply to all IDs. Exit code is 1 if any operation fails. With `--json`, outputs an array of `{ id, status? }` or `{ id, error? }`.

```bash
tg done <taskIds...> --evidence "<text>"
```

**Arguments:**

- `<taskIds...>`: One or more task IDs (space- or comma-separated).

**Options:**

- `--evidence <text>`: **(Required)** A description of the evidence of completion (e.g., tests run, commands output summary, git commit hash). Applies to all IDs.
- `--checks <json>`: An optional JSON array of acceptance checks that were verified. Applies to all IDs.
- `--force`: Force the task to `done` status even if it's not currently `doing` (discouraged). Applies to all IDs.

**Example:**

```bash
tg done b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 --evidence "All frontend components implemented and reviewed, tests passed." --checks '["UI looks good", "API integrated"]'
# Output:
# Task b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 marked as done.

tg done id1 id2 --evidence "batch" --json
# Output: [{"id":"id1","status":"done"},{"id":"id2","status":"done"}]
```

### `tg block <taskId> --on <blockerTaskId> --reason <text>`

Blocks a task on another existing task, changing its status to `blocked` if it's not already.

```bash
tg block <taskId> --on <blockerTaskId>
```

**Arguments:**

- `<taskId>`: The ID of the task that will be blocked.

**Options:**

- `--on <blockerTaskId>`: **(Required)** The ID of the task that is currently blocking `<taskId>`.
- `--reason <reason>`: The reason why `<taskId>` is blocked by `<blockerTaskId>`.

**Example:**

```bash
tg block d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 --on c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 --reason "Requires API to be deployed"
# Output:
# Task d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 blocked by c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.
```

### `tg cancel <ids...> [--type plan|task] [--reason <text>]`

Soft-deletes one or more plans (sets status to `abandoned`) or tasks (sets status to `canceled`). IDs can be space- or comma-separated. Each ID is resolved by trying plan first (by `plan_id` or `title`), then task by `task_id`. Use `--type plan` or `--type task` to force resolution. Refuses to cancel plans in `done` or `abandoned`, or tasks in `done` or `canceled`. For tasks, inserts a `note` event with body `{ type: 'cancel', reason }`. Exit code is 1 if any ID fails.

**Arguments:** `<ids...>` — One or more plan or task IDs (space- or comma-separated).

**Options:** `--type <plan|task>`, `--reason <reason>`.

**Output:** Human: one line per ID (e.g. `Plan <id> abandoned.` or `Task <id> canceled.`). With `--json`: array of `{ id, type?, status?, error? }`.

### `tg split <taskId> --into <t1>|<t2>|...`

Decomposes a single task into multiple new subtasks. The original task can optionally be kept as a parent or marked as canceled.

```bash
tg split <taskId> --into "<title1>|<title2>|..."
```

**Arguments:**

- `<taskId>`: The ID of the task to split.

**Options:**

- `--into <titles>`: **(Required)** A pipe-separated list of titles for the new subtasks (e.g., `"Subtask A|Subtask B"`).
- `--keep-original`: If `true` (default), the original task remains as a parent `umbrella` task. If `false`, the original task is set to `canceled`.
- `--link-direction <direction>`: Direction of the new 'relates' edges. `original-to-new` (default) creates edges from the original task to the new subtasks. `new-to-original` creates edges from the new subtasks to the original task.

**Example:**

```bash
tg split b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 --into "Subtask A|Subtask B" --keep-original false
# Output:
# Task b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 split into new tasks.
#   - Subtask A (ID: e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11)
#   - Subtask B (ID: f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11)
```

### `tg export mermaid`

Outputs the task graph in Mermaid `graph TD` format to stdout, suitable for visualization.

```bash
tg export mermaid
```

**Options:**

- `--plan <planId>`: Filter the graph to include tasks only from a specific plan ID.
- `--feature <featureKey>`: Filter the graph to include tasks only related to a specific feature key.

**Example:**

```bash
tg export mermaid --plan a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11
# Output:
# graph TD
#   task1[\"Design Signup API (done)\"]
#   task2[\"Develop Signup Form (doing)\"]
#   task1 --> task2
```

### `tg export dot`

Outputs the task graph in Graphviz DOT format to stdout, suitable for visualization.

```bash
tg export dot
```

**Options:**

- `--plan <planId>`: Filter the graph to include tasks only from a specific plan ID.
- `--feature <featureKey>`: Filter the graph to include tasks only related to a specific feature key.

**Example:**

```bash
tg export dot --feature auth
# Output:
# digraph TaskGraph {
#   rankdir=LR;
#   node [shape=box];
#   "task1" [label="Design Signup API (done)"];
#   "task2" [label="Develop Signup Form (doing)"];
#   "task1" -> "task2" [label="blocks"];
# }
```

### `tg export markdown`

Exports a plan and its tasks in Cursor format (YAML frontmatter with todos) to **exports/** by default. Never writes into `plans/` (blocked to avoid overwriting plan files).

```bash
tg export markdown --plan <planId> [--out <path>]
```

**Options:**

- `--plan <planId>`: **(Required)** Plan ID to export.
- `--out <path>`: Write to this path. Default: `exports/<planId>.md`. Cannot be under `plans/`.

**Output:**

- Writes to `exports/<planId>.md` when `--out` is omitted (creates `exports/` if needed).
- YAML frontmatter with `name`, `overview`, `todos` (id, content, status, blockedBy). Suitable for re-import via `tg import --format cursor`.
- Prints the destination path to stdout (unless `--json`).

### `tg context <taskId>`

Outputs domain doc path, skill guide path, related done tasks, and (when present) task suggested changes and plan file tree/risks. Run after `tg start` to load the right docs before doing work.

```bash
tg context <taskId>
```

**Arguments:**

- `<taskId>`: The ID of the task.

**Options:**

- `--json`: Output as JSON: `domains`, `skills` (arrays), `domain_docs`, `skill_docs` (paths), `related_done_by_domain`, `related_done_by_skill`, and when present: `suggested_changes`, `file_tree`, `risks` (plan-level).

**Output (human):** Task title and ID; change type; domain doc path(s) (`docs/<domain>.md`); skill guide path(s) (`docs/skills/<skill>.md`); up to 5 related done tasks by domain; up to 5 by skill. If the task has `suggested_changes`, the plan has `file_tree`, or the plan has `risks`, those are printed as well.

### `tg crossplan`

Cross-plan analysis for domains, skills, file overlaps, and proposed cross-plan edges. Skills and tooling can use these subcommands to order or relate work across plans.

```bash
tg crossplan <subcommand> [options]
# Subcommands: domains | skills | files | edges | summary
tg crossplan domains [--json]
tg crossplan skills [--json]
tg crossplan files [--json]
tg crossplan edges [--dry-run] [--json]
tg crossplan summary [--json]
```

**Subcommands:**

- **`domains`**: Domains shared by more than one plan, with task counts and which plans each domain appears in.
- **`skills`**: Skills shared across multiple plans, with task counts and plan list.
- **`files`**: Files touched by more than one plan (parsed from each plan’s `file_tree`). Useful for ordering: if Plan A and Plan B both modify the same file, one should typically go first.
- **`edges`**: Proposes new cross-plan edges. **(1) Domain overlap:** tasks in different plans that share a domain → **relates**. **(2) File overlap:** plans that share `file_tree` entries → **blocks** between one representative task per plan (earliest task by `created_at`). Cycle check is applied before adding `blocks`. Use **`--dry-run`** to print proposals without writing; without it, writes edges to Dolt. When writing, the global **`--no-commit`** applies (no Dolt commit).
- **`summary`**: Single JSON object combining `domains`, `skills`, `files`, and `proposed_edges` (same as `edges --dry-run`).

**Options:**

- `--json`: Machine-readable JSON (all subcommands).
- `--dry-run`: (`edges` only) Show proposed edges without inserting into the database.

**Output (human-readable when not `--json`):**

- **domains** / **skills**: One block per domain/skill: name, plan count, task count, list of plan titles.
- **files**: One block per file: path, plan count, list of plan titles.
- **edges**: List of proposed edges (type, from_task_id, to_task_id, reason); if not `--dry-run`, also "Added to DB" with inserted edges.
- **summary**: Always JSON (object with `domains`, `skills`, `files`, `proposed_edges`).

**Example:**

```bash
tg crossplan domains
# Output (example):
# api: 2 plans, 5 tasks
#   Plans: Plan A, Plan B

tg crossplan edges --dry-run
# Output (example):
# Proposed edges:
#   relates: task-1 -> task-2 (domain: api)
#   blocks: task-1 -> task-3 (file overlap)
```

### `tg status`

Quick overview: plans count, task counts by status, next runnable tasks. By default shows the dashboard (Completed, Active Plans, Active Work, Next Runnable). Use `--tasks` for a single-table tasks view, `--projects` for a projects (plans) table, or `--initiatives` for an initiatives table (when the initiative table exists). Only one of `--tasks`, `--projects`, or `--initiatives` may be used at a time.

```bash
tg status [--plan <planId>] [--domain <domain>] [--skill <skill>] [--change-type <type>] [--tasks] [--projects] [--initiatives] [--filter active|upcoming] [--dashboard]
```

**Options:**

- `--plan <planId>`: Filter by plan ID or title.
- `--domain <domain>`: Filter by task domain.
- `--skill <skill>`: Filter by task skill.
- `--change-type <type>`: Filter by change type.
- `--all`: Include canceled tasks and abandoned plans.
- `--tasks`: Show a single table of tasks: columns Id (hash or task_id), Title, Plan, Status, Owner. Reuses `--plan`, `--domain`, `--skill`, `--change-type`, `--all`. With `--filter active`, restrict to task status in (todo, doing, blocked). One-shot or with `--dashboard` (refreshes every 2s).
- `--projects`: Show a single table of projects (plans): columns Project, Status, Todo, Doing, Blocked, Done. Uses the `plan` table; filters `--plan`, `--domain`, `--skill`, `--all` apply.
- `--initiatives`: Show initiatives table (Initiative, Status, Cycle Start, Cycle End, Projects). Requires the `initiative` table; if it does not exist, prints a stub message and exits 0. One-shot or with `--dashboard`.
- `--filter <filter>`: For `--projects`, use `active` to show only plans whose status is not `done` or `abandoned`. For `--tasks`, use `active` to show only tasks with status todo, doing, or blocked. For `--initiatives`, use `upcoming` to show initiatives with status `draft` or `cycle_start` &gt; today.
- `--dashboard`: Open status dashboard (live-updating TUI; 2s refresh, q or Ctrl+C to quit). When no other view is selected, runs the full dashboard live path (OpenTUI when available, else setInterval + ANSI clear + boxen sections). With `--tasks`, `--projects`, or `--initiatives`, the table refreshes every 2s.
- `--json`: Output as JSON object (one-shot only; not supported with `--dashboard`).

**Output (human):**

- **Dashboard (default):** Section boxes (via boxen): each logical section (Completed, Active Plans, Active Work, Next Runnable) is wrapped in a rounded box. Inner text uses chalk for colors.
- **Tasks view (`--tasks`):** A single boxen-wrapped table with columns Id, Title, Plan, Status, Owner. One-shot or with `--dashboard` (refreshes every 2s).
- **Projects view (`--projects`):** A single boxen-wrapped table with columns Project, Status, Todo, Doing, Blocked, Done. One-shot or with `--dashboard` (refreshes every 2s).
- **Initiatives view (`--initiatives`):** If the `initiative` table does not exist, prints a stub message (e.g. "Initiatives view requires the Initiative-Project hierarchy...") and exits 0. If it exists, a single boxen-wrapped table with columns Initiative, Status, Cycle Start, Cycle End, Projects; one-shot or with `--dashboard` (refreshes every 2s).
- Plans: count
- Tasks: summary line with counts **not done**, **in progress**, **blocked**, **actionable** (e.g. `Tasks: 12 not done (3 in progress, 2 blocked, 4 actionable)`)
- Task counts by status: todo, doing, blocked, done, canceled (each only if &gt; 0). The **blocked** count shows tasks with `task.status = 'blocked'`, which is materialized from the dependency graph (see [schema](schema.md)).
- Active work: doing tasks with agent_id, plan title, started_at (when multiple agents may be active)
- Next runnable: up to 2 tasks with ID, title, plan

With `--json`, the payload includes a `summary` object: `not_done`, `in_progress`, `blocked`, `actionable`.

**Live mode behavior** (`--dashboard`):

- **Same sections as one-shot.** The same sections are shown (in boxen boxes): Completed, Active Plans, Active Work, Next Runnable. Terminal resize is reflected on the next refresh.
- **OpenTUI when available.** When the runtime supports it (e.g. Bun), the live view may use OpenTUI (`@opentui/core`, `createCliRenderer`) for rendering. When OpenTUI is not available or init fails (e.g. Node), the implementation falls back to Node only: `setInterval`, ANSI clear (e.g. `\x1b[2J\x1b[H`), and the existing human status printer (with boxen section boxes).
- **Polling.** The status query chain is re-run every 2 seconds. Dolt is invoked via execa per call. File watching is out of scope.
- **Raw mode and exit.** On entering live mode, `process.stdin.setRawMode(true)` is set so that the "q" key can quit. On **SIGINT**, **SIGTERM**, or key **"q"**: clear the refresh interval, call `setRawMode(false)`, then `process.exit(0)`. **Ctrl+C** and **"q"** both quit live mode.
- **`--json` with `--dashboard` unsupported.** If `--json` is passed with `--dashboard`, the CLI prints to stderr: `tg status --dashboard does not support --json`, then `process.exit(1)`.

### `tg portfolio overlaps`

Identifies tasks that show overlap or commonality across multiple features or areas.

```bash
tg portfolio overlaps
```

**Options:**

- `--min <count>`: Minimum number of features for a task to be considered overlapping (default: 2).

**Output:**

- Lists tasks explicitly linked by `relates` edges across features.
- Highlights areas where tasks from multiple features reside.

**Example:**

```bash
tg portfolio overlaps --min 3
# Output:
# Tasks with explicit 'relates' overlaps (min 3 features):
#   - Task ID: task_shared_api, Title: Shared API Endpoint, Features: auth,billing,reporting
#
# Areas with tasks from multiple features (min 3 features):
#   - Area: backend, Tasks: 5, Features: auth,billing,reporting
```

### `tg portfolio hotspots`

Provides a summary of task distribution, counting tasks per area and identifying tasks touched by multiple features.

```bash
tg portfolio hotspots
```

**Output:**

- Counts of tasks grouped by `area`.
- Lists tasks that are associated with more than one `feature_key`.

**Example:**

```bash
tg portfolio hotspots
# Output:
# Tasks per Area:
#   - Area: backend, Tasks: 10
#   - Area: frontend, Tasks: 7
#
# Tasks touched by multiple features:
#   - Task ID: task_shared_component, Title: Reusable UI Component, Features: auth,onboarding
```

### `tg import <filePath>`

Imports tasks and edges from a markdown plan file into the Dolt database. This command will upsert tasks based on their stable keys and create blocking edges as defined in the markdown.

```bash
tg import <filePath> --plan "<planTitleOrId>" [--format cursor|legacy]
```

**Arguments:**

- `<filePath>`: The path to the markdown plan file (e.g., `plans/feature-auth.md`).

**Options:**

- `--plan <planTitleOrId>`: **(Required)** The title or ID of the plan to associate the imported tasks with. If a plan with the given title/ID does not exist, a new one will be created.
- `--format <format>`: Plan format. `cursor` for Cursor plans (YAML frontmatter with todos); `legacy` for TASK:/TITLE:/BLOCKED_BY: format (default).
- `--no-suggest`: Disable auto-suggestion of docs/skills from plan file tree and task file patterns. When enabled (default), tasks with no docs/skills get suggestions and a console warning is printed.

**Example:**

```bash
tg import plans/new-feature.md --plan "New Feature Development"
# Output:
# Created new plan 'New Feature Development' with ID: a1b2c3d4-e5f6-7890-1234-567890abcdef
# Successfully imported tasks and edges from plans/new-feature.md to plan a1b2c3d4-e5f6-7890-1234-567890abcdef.
```
