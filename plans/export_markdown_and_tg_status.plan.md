---
name: Export Markdown and tg status
overview: "Add tg export markdown for round-trip plan sync (import → work → export) and tg status for a quick task graph overview (plans count, tasks by status, next runnable)."
todos:
  - id: export-markdown-module
    content: Create export/markdown.ts — function to generate Cursor-format YAML frontmatter from plan + tasks (id from external_key, content from title, status from task status, blockedBy from edges)
    status: pending
  - id: export-markdown-cli
    content: Add tg export markdown --plan <id> command; output to stdout (or --out <path> to write file)
    status: pending
    blockedBy: [export-markdown-module]
  - id: export-markdown-tests
    content: Add unit test for markdown export; integration test that import → export round-trips
    status: pending
    blockedBy: [export-markdown-cli]
  - id: tg-status-command
    content: Add tg status command — plans count, task counts by status (todo/doing/blocked/done), next 1–2 runnable tasks
    status: pending
  - id: tg-status-output
    content: Support --json for tg status; human output as compact summary lines
    status: pending
    blockedBy: [tg-status-command]
  - id: docs-export-status
    content: Update docs/cli-reference.md with tg export markdown and tg status
    status: pending
    blockedBy: [export-markdown-cli, tg-status-output]
isProject: false
---

# Export Markdown and tg status

## Feature 1: tg export markdown (round-trip)

- **Goal**: Output tasks in Cursor format so `tg import --format cursor` can re-ingest. Enables import → work → export updated plan.
- **Output**: YAML frontmatter with `name` (plan title), `overview` (plan intent), `todos` array.
- **Task mapping**: `external_key` → `id`, `title` → `content`, `status` (todo/done) → `status` (pending/completed), edges → `blockedBy`.
- **Usage**: `tg export markdown --plan <id>` (stdout) or `--out plans/updated.plan.md` to write file.

## Feature 2: tg status

- **Goal**: Quick overview for humans and agents—no need to juggle plan IDs.
- **Output**: Plans count, tasks by status (todo, doing, blocked, done), next 1–2 runnable tasks.
- **Usage**: `tg status` with optional `--plan <id>` to filter, `--json` for scripting.
