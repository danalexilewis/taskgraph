# CLI Reference

The Task Graph Command Line Interface (`tg`) provides a comprehensive set of commands for managing plans, tasks, dependencies, events, and portfolio views. This document details each command, its options, and examples.

## Global Options

All `tg` commands support the following global options:

-   `--json`: Output machine-readable JSON instead of human-readable text. Useful for scripting.
-   `--no-commit`: Perform a dry run; do not commit changes to the Dolt repository. (Applies only to commands that modify data.)
-   `--commit-msg <msg>`: Override the default commit message for data-modifying commands.

## Commands

### `tg init`

Initializes the Task Graph system in the current directory. This command sets up the Dolt repository and applies necessary database migrations.

```bash
tg init
```

**Options:**
-   `--no-commit`: Do not commit changes to Dolt.

**Output:**
-   Repository path.
-   Instructions on how to run a Dolt SQL server (if applicable).

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

### `tg plan new <title>`

Creates a new high-level plan.

```bash
tg plan new "<title>"
```

**Arguments:**
-   `<title>`: The title of the new plan.

**Options:**
-   `--intent <intent>`: A detailed intent or goal of the plan.
-   `--source <path>`: Path to the source Cursor Plan document (e.g., `plans/feature-x.md`).

**Example:**
```bash
tg plan new "User Onboarding Flow" --intent "Streamline the process for new users signing up."
# Output:
# Plan created with ID: a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11
```

### `tg task new <title>`

Creates a new task within an existing plan.

```bash
tg task new "<title>" --plan <planId>
```

**Arguments:**
-   `<title>`: The title of the new task.

**Options:**
-   `--plan <planId>`: **(Required)** The ID of the parent plan.
-   `--feature <featureKey>`: A key for portfolio analysis (e.g., `auth`, `billing`).
-   `--area <area>`: The functional area of the task (e.g., `frontend`, `backend`, `db`, `infra`).
-   `--acceptance <json>`: A JSON array of acceptance criteria checks for the task.

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
-   `<fromTaskId>`: The ID of the blocking or relating task.
-   `<type>`: The type of edge, either `blocks` (indicating a hard dependency) or `relates` (indicating a softer relationship).
-   `<toTaskId>`: The ID of the blocked or related task.

**Options:**
-   `--reason <reason>`: A reason for establishing this dependency.

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
-   `--plan <planId|title>`: Optional filter by plan ID or title.
-   `--limit <limit>`: Limit the number of tasks returned (default: 10).

**Output fields (human-readable):**
-   `task_id`, `title`, `plan title`, `risk`, `estimate`, `blockers count`.

**Example:**
```bash
tg next --plan "User Onboarding Flow"
# Output:
# Runnable Tasks:
#   ID: b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11, Title: Develop Signup Form, Plan: User Onboarding Flow, Risk: low, Estimate: N/A
```

### `tg show <taskId>`

Displays detailed information about a specific task, including its blockers, dependents, and recent events.

```bash
tg show <taskId>
```

**Arguments:**
-   `<taskId>`: The ID of the task to display.

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

### `tg start <taskId>`

Moves a task from `todo` to `doing` status, indicating active work has begun. This is only allowed if the task is runnable (i.e., it has no unmet blockers).

```bash
tg start <taskId>
```

**Arguments:**
-   `<taskId>`: The ID of the task to start.

**Example:**
```bash
tg start b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11
# Output:
# Task b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 started.
```

### `tg done <taskId> --evidence <text>`

Marks a task as `done`. Requires evidence of completion.

```bash
tg done <taskId> --evidence "<text>"
```

**Arguments:**
-   `<taskId>`: The ID of the task to mark as done.

**Options:**
-   `--evidence <text>`: **(Required)** A description of the evidence of completion (e.g., tests run, commands output summary, git commit hash).
-   `--checks <json>`: An optional JSON array of acceptance checks that were verified.
-   `--force`: Force the task to `done` status even if it's not currently `doing` (discouraged).

**Example:**
```bash
tg done b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 --evidence "All frontend components implemented and reviewed, tests passed." --checks '["UI looks good", "API integrated"]'
# Output:
# Task b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 marked as done.
```

### `tg block <taskId> --on <blockerTaskId> --reason <text>`

Blocks a task on another existing task, changing its status to `blocked` if it's not already.

```bash
tg block <taskId> --on <blockerTaskId>
```

**Arguments:**
-   `<taskId>`: The ID of the task that will be blocked.

**Options:**
-   `--on <blockerTaskId>`: **(Required)** The ID of the task that is currently blocking `<taskId>`.
-   `--reason <reason>`: The reason why `<taskId>` is blocked by `<blockerTaskId>`.

**Example:**
```bash
tg block d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 --on c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 --reason "Requires API to be deployed"
# Output:
# Task d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 blocked by c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.
```

### `tg split <taskId> --into <t1>|<t2>|...`

Decomposes a single task into multiple new subtasks. The original task can optionally be kept as a parent or marked as canceled.

```bash
tg split <taskId> --into "<title1>|<title2>|..."
```

**Arguments:**
-   `<taskId>`: The ID of the task to split.

**Options:**
-   `--into <titles>`: **(Required)** A pipe-separated list of titles for the new subtasks (e.g., `"Subtask A|Subtask B"`).
-   `--keep-original`: If `true` (default), the original task remains as a parent `umbrella` task. If `false`, the original task is set to `canceled`.
-   `--link-direction <direction>`: Direction of the new 'relates' edges. `original-to-new` (default) creates edges from the original task to the new subtasks. `new-to-original` creates edges from the new subtasks to the original task.

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
-   `--plan <planId>`: Filter the graph to include tasks only from a specific plan ID.
-   `--feature <featureKey>`: Filter the graph to include tasks only related to a specific feature key.

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
-   `--plan <planId>`: Filter the graph to include tasks only from a specific plan ID.
-   `--feature <featureKey>`: Filter the graph to include tasks only related to a specific feature key.

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

### `tg portfolio overlaps`

Identifies tasks that show overlap or commonality across multiple features or areas.

```bash
tg portfolio overlaps
```

**Options:**
-   `--min <count>`: Minimum number of features for a task to be considered overlapping (default: 2).

**Output:**
-   Lists tasks explicitly linked by `relates` edges across features.
-   Highlights areas where tasks from multiple features reside.

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
-   Counts of tasks grouped by `area`.
-   Lists tasks that are associated with more than one `feature_key`.

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
tg import <filePath> --plan "<planTitleOrId>"
```

**Arguments:**
-   `<filePath>`: The path to the markdown plan file (e.g., `plans/feature-auth.md`).

**Options:**
-   `--plan <planTitleOrId>`: **(Required)** The title or ID of the plan to associate the imported tasks with. If a plan with the given title/ID does not exist, a new one will be created.

**Example:**
```bash
tg import plans/new-feature.md --plan "New Feature Development"
# Output:
# Created new plan 'New Feature Development' with ID: a1b2c3d4-e5f6-7890-1234-567890abcdef
# Successfully imported tasks and edges from plans/new-feature.md to plan a1b2c3d4-e5f6-7890-1234-567890abcdef.
```
