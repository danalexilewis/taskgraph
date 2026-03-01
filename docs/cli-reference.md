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
- `--remote-url <url>`: Dolt remote URL; stored in `.taskgraph/config.json` for future sync (e.g. `tg sync`).
- `--remote <url>`: Alias for `--remote-url`.

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
tg start <taskIds...> [--agent <name>] [--force] [--branch] [--worktree]
```

**Arguments:**

- `<taskIds...>`: One or more task IDs (space- or comma-separated in one token).

**Options:**

- `--agent <name>`: Agent identifier for multi-agent visibility. Recorded in the started event body. Applies to all IDs.
- `--force`: Override claim when a task is already being worked by another agent (human override). Applies to all IDs.
- `--branch`: Create and checkout a Dolt agent branch for this task (e.g. `agent-<taskId-prefix>`). The branch name is stored in the started event; `tg done` will merge it into main (or `mainBranch` from config) and delete the branch. If merge conflicts occur, `tg done` reports an error and leaves the branch for manual resolution.
- `--worktree`: Create a git worktree for the task at `.taskgraph/worktrees/<taskId>/` on branch `tg/<taskId>`. The worktree path and branch are stored in the **started event body** as `worktree_path` and `worktree_branch`. Use this for parallel implementers so each works in an isolated directory; the orchestrator should pass `worktree_path` to implementers (e.g. in the dispatch prompt) so they run their work from that path.

**Example:**

```bash
tg start b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 --agent alice
# Output:
# Task b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 started.

tg start id1 id2 --agent bob --worktree --json
# Output: [{"id":"id1","status":"doing"},{"id":"id2","status":"doing"}]
```

### `tg done <taskIds...> --evidence <text>`

Marks one or more tasks as `done`. Requires evidence of completion. Multiple IDs can be passed space-separated or comma-separated in one token. Options (e.g. `--evidence`, `--checks`) apply to all IDs. Exit code is 1 if any operation fails. With `--json`, outputs an array of `{ id, status? }` or `{ id, error? }`. If the task was started with `tg start --branch`, `tg done` merges the agent branch into main (or `mainBranch` from `.taskgraph/config.json`); on merge conflict an error is reported and the branch is left for manual resolution. If the task was started with `tg start --worktree`, `tg done` removes the worktree; with `--merge` it first merges the worktree branch (`tg/<taskId>`) into the base branch (main or `mainBranch` from config), then removes the worktree and deletes the branch. Without `--merge`, only the worktree directory is removed and the branch is left.

```bash
tg done <taskIds...> --evidence "<text>" [--merge]
```

**Arguments:**

- `<taskIds...>`: One or more task IDs (space- or comma-separated).

**Options:**

- `--evidence <text>`: **(Required)** A description of the evidence of completion (e.g., tests run, commands output summary, git commit hash). Applies to all IDs.
- `--checks <json>`: An optional JSON array of acceptance checks that were verified. Applies to all IDs.
- `--force`: Force the task to `done` status even if it's not currently `doing` (discouraged). Applies to all IDs.
- `--merge`: When the task has an associated worktree (started with `--worktree`), merge the worktree branch into the base branch before removing the worktree and deleting the branch. If omitted, only the worktree directory is removed; the branch `tg/<taskId>` remains.

**Example:**

```bash
tg done b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 --evidence "All frontend components implemented and reviewed, tests passed." --checks '["UI looks good", "API integrated"]'
# Output:
# Task b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 marked as done.

tg done id1 id2 --evidence "batch" --json
# Output: [{"id":"id1","status":"done"},{"id":"id2","status":"done"}]
```

### `tg worktree list`

Lists active git worktrees (main working tree plus any linked worktrees, e.g. those created by `tg start --worktree`). Run from the repo root (directory containing `.git` and `.taskgraph/`).

```bash
tg worktree list [--json]
```

**Options:**

- `--json`: Output an array of objects with `path`, `commit`, and optional `branch`. Otherwise prints one line per worktree: path, commit, and branch in brackets.

**Output (human):** One line per worktree: `<path>  <commit> [<branch>]`.

**Example:**

```bash
tg worktree list
# /path/to/repo  abc1234 [main]
# /path/to/repo/.taskgraph/worktrees/55f51191-99a5-4688-8e2e-54115378c81e  def5678 [tg/55f51191-99a5-4688-8e2e-54115378c81e]
```

### Git worktree integration (parallel tasks)

When running **parallel implementers**, use `tg start --worktree` so each task gets an isolated git worktree at `.taskgraph/worktrees/<taskId>/` on branch `tg/<taskId>`. The **started event body** stores `worktree_path` (absolute path to the worktree) and `worktree_branch`; the **orchestrator** should pass `worktree_path` to implementers in the dispatch prompt (e.g. "Work in &lt;worktree_path&gt;" or "Run all commands from &lt;worktree_path&gt;") so they perform their work in that directory and avoid file conflicts. When the task is complete, run `tg done --evidence "..."`; add `--merge` to merge the worktree branch into the base branch before removing the worktree. Use `tg worktree list` to see active worktrees.

### `tg gate create <name>`

Creates an external gate and blocks the given task until the gate is resolved (e.g., human approval, CI pass, webhook). Gates represent dependencies on conditions *outside* the task graph; use `tg block` for task-on-task dependencies.

```bash
tg gate create <name> --task <taskId> [--type human|ci|webhook]
```

**Arguments:**

- `<name>`: Human-readable name for the gate (e.g., "QA sign-off", "CI green").

**Options:**

- `--task <taskId>`: **(Required)** Task ID to block until the gate is resolved.
- `--type <human|ci|webhook>`: Gate type (default: `human`). `human` = manual approval; `ci` = CI pipeline result; `webhook` = external webhook.

**Example:**

```bash
tg gate create "QA sign-off" --task b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 --type human
# Output: Gate created with ID: ...
```

### `tg gate resolve <gateId>`

Marks a gate as resolved, satisfying the external condition. If a task was associated with the gate, it may become unblocked (per application logic).

```bash
tg gate resolve <gateId>
```

**Arguments:**

- `<gateId>`: The ID of the gate to resolve.

**Example:**

```bash
tg gate resolve a1b2c3d4-e5f6-7890-abcd-ef1234567890
# Output: Gate resolved.
```

### `tg gate list`

Lists gates, optionally filtered to pending only.

```bash
tg gate list [--pending]
```

**Options:**

- `--pending`: Show only gates with status `pending`.

**Output:** Gate ID, name, type, status, task_id, created_at. With `--json`: array of gate objects.

**Example:**

```bash
tg gate list --pending
# Output: Lists all pending gates.
```

**Gates vs blocks:** **Gates** block a task on an *external* condition (human, CI, webhook). **Blocks** (`tg block`, `edge` with `type='blocks'`) block a task on *another task* in the graph. Use gates when the dependency is outside the task graph; use blocks for task-on-task dependencies.

### Multi-machine workflow and sync

The task graph is stored in a Dolt repo (`.taskgraph/dolt/`). To use the same graph on multiple machines:

-   **No `tg sync` yet**: Sync is done via Dolt. From the project root, run Dolt in the repo (e.g. `cd .taskgraph/dolt && dolt remote add origin <url>` once, then `dolt pull` / `dolt push`). See [architecture.md](architecture.md) for the full multi-machine sync and workflow section.
-   **Planned**: A future `tg sync` may wrap Dolt pull/push and support an optional remote in `.taskgraph/config.json`. Until then, use Dolt remotes and pull/push manually.

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

- `--json`: Output as JSON: `domains`, `skills` (arrays), `domain_docs`, `skill_docs` (paths), `related_done_by_domain`, `related_done_by_skill`, and when present: `suggested_changes`, `file_tree`, `risks` (plan-level). Includes `token_estimate` (approximate token count of the JSON).

**Configuration:** Optional `context_token_budget` in `.taskgraph/config.json` (number, e.g. `4000` or `8000`) sets a token limit for context output. When the full context exceeds this budget, the command compacts it by slimming `related_done_by_doc` and `related_done_by_skill` (fewer items, `task_id` and `title` only), then reducing further or clearing those lists if still over budget. Omitted or `null` means no limit.

**Output (human):** Task title and ID; change type; domain doc path(s) (`docs/<domain>.md`); skill guide path(s) (`docs/skills/<skill>.md`); up to 5 related done tasks by domain; up to 5 by skill. If the task has `suggested_changes`, the plan has `file_tree`, or the plan has `risks`, those are printed as well. Ends with approximate context size in tokens.

### `tg crossplan`

Cross-plan analysis for domains, skills, file overlaps, and proposed cross-plan edges. Skills and tooling can use these subcommands to order or relate work across plans.

```bash
tg crossplan <subcommand> [options]
# Subcommands: plans | domains | skills | files | edges | summary
tg crossplan plans [--json]
tg crossplan domains [--json]
tg crossplan skills [--json]
tg crossplan files [--json]
tg crossplan edges [--dry-run] [--json]
tg crossplan summary [--json]
```

**Subcommands:**

- **`plans`**: Summary of tasks by plan: task counts per plan with status breakdown (todo, doing, blocked, done, canceled). One line per plan in human output; with `--json`, array of `{ plan_id, title, status, task_count, todo, doing, blocked, done, canceled }`.
- **`domains`**: Domains shared by more than one plan, with task counts and which plans each domain appears in.
- **`skills`**: Skills shared across multiple plans, with task counts and plan list.
- **`files`**: Files touched by more than one plan (parsed from each plan’s `file_tree`). Useful for ordering: if Plan A and Plan B both modify the same file, one should typically go first.
- **`edges`**: Proposes new cross-plan edges. **(1) Domain overlap:** tasks in different plans that share a domain → **relates**. **(2) File overlap:** plans that share `file_tree` entries → **blocks** between one representative task per plan (earliest task by `created_at`). Cycle check is applied before adding `blocks`. Use **`--dry-run`** to print proposals without writing; without it, writes edges to Dolt. When writing, the global **`--no-commit`** applies (no Dolt commit).
- **`summary`**: Single JSON object combining `domains`, `skills`, `files`, and `proposed_edges` (same as `edges --dry-run`).

**Options:**

- `--json`: Machine-readable JSON (all subcommands).
- `--dry-run`: (`edges` only) Show proposed edges without inserting into the database.

**Output (human-readable when not `--json`):**

- **plans**: One line per plan: `Title (plan_id): N tasks [todo: x, doing: x, blocked: x, done: x, canceled: x]`.
- **domains** / **skills**: One block per domain/skill: name, plan count, task count, list of plan titles.
- **files**: One block per file: path, plan count, list of plan titles.
- **edges**: List of proposed edges (type, from_task_id, to_task_id, reason); if not `--dry-run`, also "Added to DB" with inserted edges.
- **summary**: Always JSON (object with `domains`, `skills`, `files`, `proposed_edges`).

**Example:**

```bash
tg crossplan plans
# Output (example):
# Plan A (6dbadd46-...): 8 tasks [todo: 3, doing: 1, blocked: 0, done: 4, canceled: 0]

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

### `tg dashboard`

Opens the status dashboard as a live-updating TUI (2s refresh; press **q** or **Ctrl+C** to quit). This is the preferred way to run the live dashboard; `tg status --dashboard` is deprecated in favor of `tg dashboard`.

```bash
tg dashboard [--tasks] [--projects]
```

**Options:**

- **Default (no options):** Full dashboard with sections: Completed, Active Plans, Active & next (same content as one-shot `tg status`, refreshed every 2s).
- `--tasks`: Live tasks view with three boxed sections — Active tasks, Next 7 runnable, Last 7 completed. Only one of `--tasks` or `--projects` is allowed.
- `--projects`: Live projects view with three boxed sections — Active plans, Next 7 upcoming, Last 7 completed.

**Output:** Live-updating terminal UI. When OpenTUI is available (e.g. Bun), the dashboard uses it; otherwise a Node fallback (setInterval + ANSI clear + boxen sections) is used. Polling interval is 2 seconds.

**Deprecation:** Use `tg dashboard` instead of `tg status --dashboard`. The latter prints a deprecation warning to stderr and then runs the same dashboard; it will be removed in a future version.

### `tg status`

Quick overview: plans count, task counts by status, next runnable tasks.

**Dashboard and focused views:** By default, `tg status` shows the **dashboard** (Completed, Active Plans, Active & next). Focused views: `--tasks` (single-table tasks: Id, Title, Plan, Status, Owner), `--projects` (single-table plans: Project, Status, Todo, Doing, Blocked, Done), `--initiatives` (initiatives table when the `initiative` table exists). Use `--filter active` with `--tasks` or `--projects` to restrict to active items (tasks: todo/doing/blocked; plans: not done/abandoned). Use `--filter upcoming` with `--initiatives` for draft or future cycles. Only one of `--tasks`, `--projects`, or `--initiatives` may be used at a time. Add `--dashboard` for a live-updating TUI (2s refresh) for any of these views.

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
- `--dashboard`: **(Deprecated.)** Open status dashboard (live-updating TUI; 2s refresh, q or Ctrl+C to quit). When no other view is selected, runs the full dashboard live path (OpenTUI when available, else setInterval + ANSI clear + boxen sections). With `--tasks`, `--projects`, or `--initiatives`, the table refreshes every 2s. **Deprecation:** `tg status --dashboard` is deprecated and will be removed in a future version; use `tg dashboard` instead. A warning is printed to stderr when this option is used.
- `--json`: Output as JSON object (one-shot only; not supported with `--dashboard`).

**Output (human):**

- **Dashboard (default):** Section boxes (via boxen): each logical section (Completed, Active Plans, Active & next) is wrapped in a rounded box. Inner text uses chalk for colors.
- **Tasks view (`--tasks`):** A single boxen-wrapped table with columns Id, Title, Plan, Status, Owner. One-shot or with `--dashboard` (refreshes every 2s).
- **Projects view (`--projects`):** A single boxen-wrapped table with columns Project, Status, Todo, Doing, Blocked, Done. One-shot or with `--dashboard` (refreshes every 2s).
- **Initiatives view (`--initiatives`):** If the `initiative` table does not exist, prints a stub message (e.g. "Initiatives view requires the Initiative-Project hierarchy...") and exits 0. If it exists, a single boxen-wrapped table with columns Initiative, Status, Cycle Start, Cycle End, Projects; one-shot or with `--dashboard` (refreshes every 2s).
- Plans: count
- Tasks: summary line with counts **not done**, **in progress**, **blocked**, **actionable** (e.g. `Tasks: 12 not done (3 in progress, 2 blocked, 4 actionable)`)
- Task counts by status: todo, doing, blocked, done, canceled (each only if &gt; 0). The **blocked** count shows tasks with `task.status = 'blocked'`, which is materialized from the dependency graph (see [schema](schema.md)).
- **Active & next:** Single section: doing tasks first (Id, Task, Plan, Status, Agent), then up to 3 runnable todo tasks (Agent "—"). Id column shows short id (hash_id or truncated), not full UUID.

With `--json` (one-shot only; not with `--dashboard`): default view outputs an object with `summary` (`not_done`, `in_progress`, `blocked`, `actionable`), `activePlans`, `nextTasks`, `activeWork`, etc. With `--tasks --json`, output is a JSON array of task rows: `task_id`, `hash_id`, `title`, `plan_title`, `status`, `owner`. With `--projects --json`, output is a JSON array of project rows: `plan_id`, `title`, `status`, `todo`, `doing`, `blocked`, `done`. With `--initiatives --json` and no initiative table, output is `{ "stub": true, "message": "..." }`.

**Live mode behavior** (`--dashboard`):

- **Deprecation.** Using `tg status --dashboard` prints a deprecation warning to stderr and then runs the same dashboard as `tg dashboard`. Prefer `tg dashboard`; `tg status --dashboard` will be removed in a future version.
- **Same sections as one-shot.** The same sections are shown (in boxen boxes): Completed, Active Plans, Active & next. Terminal resize is reflected on the next refresh.
- **OpenTUI when available.** When the runtime supports it (e.g. Bun), the live view may use OpenTUI (`@opentui/core`, `createCliRenderer`) for rendering. When OpenTUI is not available or init fails (e.g. Node), the implementation falls back to Node only: `setInterval`, ANSI clear (e.g. `\x1b[2J\x1b[H`), and the existing human status printer (with boxen section boxes).
- **Polling.** The status query chain is re-run every 2 seconds. Dolt is invoked via execa per call. File watching is out of scope.
- **Raw mode and exit.** On entering live mode, `process.stdin.setRawMode(true)` is set so that the "q" key can quit. On **SIGINT**, **SIGTERM**, or key **"q"**: clear the refresh interval, call `setRawMode(false)`, then `process.exit(0)`. **Ctrl+C** and **"q"** both quit live mode.
- **`--json` with `--dashboard` unsupported.** If `--json` is passed with `--dashboard`, the CLI prints to stderr: `tg status --dashboard does not support --json`, then `process.exit(1)`.

### `tg stats`

Derives agent metrics from the event table: tasks completed per agent (from done + started events), review pass/fail counts (from note events whose message body is JSON with `"type": "review"`; see [multi-agent.md](multi-agent.md) for the review event convention), and average elapsed time per task (started → done).

```bash
tg stats [--agent <name>] [--plan <planId>] [--json]
```

**Options:**

- `--agent <name>`: Restrict metrics to the given agent.
- `--plan <planId>`: Restrict to tasks that belong to the given plan (plan ID or title).
- `--json`: Output an array of objects: `agent`, `tasks_done`, `avg_seconds`, `review_pass`, `review_fail`.

**Output (human):** One line per agent: agent name, tasks_done, avg_elapsed (seconds or —), and review PASS/FAIL counts when present.

**Example:**

```bash
tg stats
# Agent metrics (from event data):
#   implementer-1  tasks_done: 5  avg_elapsed: 120s  review: 4 PASS, 0 FAIL

tg stats --plan "My Plan" --json
```

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

### `tg template apply <file>`

Reads a template YAML file (Cursor plan frontmatter shape), substitutes variables from `--var key=value`, and creates a plan and tasks in Dolt using the same logic as `tg import --format cursor`. Use templates when you want to reuse the same plan structure with different names or areas.

```bash
tg template apply <file> --plan "<planName>" [--var key=value]...
```

**Arguments:**

- `<file>`: Path to the template YAML file.

**Options:**

- `--plan <name>`: **(Required)** Plan name for the created plan (or existing plan to add tasks to). If no plan exists with this title/ID, a new plan is created.
- `--var <pairs...>`: Variable substitutions as `key=value`. Multiple pairs: `--var feature=auth --var area=backend`. Any `{{varName}}` in the template is replaced by the value for `varName`.

**Template format**

The file must be valid YAML with the same shape as Cursor plan frontmatter: `name`, `overview`, `todos` (required), `fileTree`, `risks`, `tests`. Any string value may contain `{{varName}}` placeholders (alphanumeric names). After substitution, the result is passed through the same plan/task creation and upsert logic as cursor import.

**Variables**

Placeholders use the form `{{varName}}`. Supply values via `--var key=value`. Placeholders not provided are left as literal `{{varName}}` in the output. Substitution runs recursively over all string fields in the YAML.

**When to use templates vs full plans**

- **Templates (`tg template apply`)**: Use when you want to **reuse** the same plan structure with different names or areas (e.g. per-feature or per-module). The template is YAML-only (no markdown body); variables allow one file to drive many plans.
- **Import (`tg import --plan X --format cursor`)**: Use for **one-off** Cursor plan files: a markdown document whose YAML frontmatter describes the plan. No variable substitution; the file is imported as-is.

**Example:**

```bash
tg template apply docs/templates/feature-rollout.yaml --plan "Auth rollout" --var feature=Auth --var area=backend
# Output:
# Created new plan 'Auth rollout' with ID: ...
# Successfully applied template docs/templates/feature-rollout.yaml to plan ... (2 tasks).
```

See [docs/templates/README.md](templates/README.md) for more examples and template authoring.

## MCP Server

Task Graph provides an MCP (Model Context Protocol) server so AI assistants (Cursor, Claude Desktop, etc.) can read task and plan data without using the CLI.

- **Command:** `tg-mcp` — run from the project root (directory containing `.taskgraph/`). Reads config from `.taskgraph/config.json`.
- **Tools (read-only):** `tg_status`, `tg_context`, `tg_next`, `tg_show` — same data as `tg status --json`, `tg context <taskId> --json`, `tg next`, and `tg show <taskId> --json`.

For setup, tool parameters, and how to configure Cursor or Claude to use the server, see [docs/mcp.md](mcp.md).
