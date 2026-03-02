---
triggers:
  files: ["src/cli/**"]
  change_types: ["create", "modify"]
  keywords: ["command", "option", "flag", "CLI"]
---

# CLI Reference

The Task Graph Command Line Interface (`tg`) provides a comprehensive set of commands for managing **projects** (formerly called plans in the schema), tasks, dependencies, events, initiatives, and portfolio views. This document details each command, its options, and examples. Where the database entity is a project, we use "project" in descriptions; the command name may still be `tg plan` for backward compatibility.

## Task IDs

All commands that accept `<taskId>` (or similar task ID arguments such as `<fromTaskId>`, `<toTaskId>`, `<blockerTaskId>`) accept both:

- **Full UUID**: e.g., `b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`
- **Short hash**: e.g., `tg-XXXXXX` (from the task's `hash_id` column)

## The `--plan` Option Convention

Commands that accept `--plan <value>` refer to a **project** (stored in the `project` table; `plan_id` is the primary key). The same UUID-dispatch pattern applies:

- **UUID input** (matches `^[0-9a-fA-F]{8}-...-[0-9a-fA-F]{12}$`): matched against `plan_id`
- **Non-UUID input**: matched against `title` (case-sensitive exact match)

Both inputs are sanitised with `sqlEscape()` before interpolation. When implementing a new command that accepts `--plan`, grep `src/cli/status.ts` or `src/cli/next.ts` for the existing UUID-dispatch pattern and replicate it exactly.

## Global Options

All `tg` commands support the following global options:

- `--json`: Output machine-readable JSON instead of human-readable text. Useful for scripting.
- `--no-commit`: Perform a dry run; do not commit changes to the Dolt repository. (Applies only to commands that modify data.)
- `--commit-msg <msg>`: Override the default commit message for data-modifying commands.

## Commands

### `tg import`

Import tasks and edges from a markdown plan file. Creates or updates a **project** (stored in the `project` table). When a new project is created, prints: `Created new project '<title>' with ID: <plan_id>`.

```bash
tg import <filePath> --plan <planTitleOrId> [--format cursor|legacy] [--initiative <id>] [options]
```

**Required:**

- `--plan <planTitleOrId>`: Title or ID of the project to associate tasks with (kept for backward compatibility).

**Options:**

- `--format <format>`: `legacy` (default) or `cursor`. Use `cursor` for plans with YAML frontmatter and `todos`.
- `--initiative <id>`: Initiative ID to assign the project to. When omitted, `project.initiative_id` is set to the default Unassigned initiative.
- `--external-key-prefix <prefix>`: Optional prefix for task `external_key` to avoid collisions.
- `--no-suggest`: Disable auto-suggestion of docs/skills from file patterns.
- `--force`: Proceed even when existing tasks would be unmatched (may create duplicates).
- `--benchmark`: Mark the imported project as benchmark.
- `--replace`: Cancel existing tasks that would not be matched, then upsert.

**Cursor format:** Parsed frontmatter fields `overview`, `objectives`, `outcomes`, and `outputs` are stored on the project record when present.

### `tg stats`

Derives agent performance metrics from the event table: tasks completed per agent, average elapsed time per task (started → done), review pass/fail counts, investigator fix rate metrics when requested, and (when self-reported) token usage and tool-call aggregates. See [performance.md](performance.md) for interpretation guidance.

```bash
tg stats [--agent <name>] [--plan <planId>] [--timeline] [--recovery] [--json]
```

**Options:**

- `--agent <name>`: Restrict metrics to the given agent.
- `--plan <planId>` / `-p <planId>`: Show plan-level analytics — total duration, velocity (tasks/hr), and a per-task elapsed table sorted slowest-first. When self-report data is present (`tg done --tokens-in/out/tool-calls`), adds token and tool-call columns.
- `--timeline`: Show cross-plan execution history sorted newest-first. Columns: started date, plan title, status, tasks completed/total, duration, velocity.
- `--benchmark`: Filter to benchmark projects. In timeline view or default JSON output, shows only benchmark plans. When used with `--plan`, in JSON mode returns `planSummary: null` and empty `tasks` for non-benchmark plans; in human-readable mode prints "Plan is not marked as benchmark" and exits normally.
- `--recovery`: Include investigator fix rate metrics based on gate events for run-full-suite tasks.
- `--json`: Output structured JSON. Default view: `{ agent_metrics: [...], recovery?: {...} }`. With `--plan`: `{ planSummary: {...}, tasks: [...], token_usage?: [...], recovery?: {...} }`. With `--timeline`: `{ plans: [...], recovery?: {...} }`.

**Token usage section (default view):** When any done event body includes `tokens_in`, a "Token Usage" table appears showing per-agent averages and totals. Omitted when no self-report data exists.

**Recovery metrics:** When `--recovery` is specified, a "Recovery" block shows:

- Plans with failures: number of plans with a gate failure on the run-full-suite task.
- Plans fixed: number of those plans where a subsequent gate pass was recorded.
- Investigator fix rate: percentage of fixes over failures.
