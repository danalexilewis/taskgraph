---
name: commit-messages
description: Analyzes unstaged/staged diffs, groups changes into logical commits, creates a branch, dispatches one sub-agent per group to write and run each commit, merges and tags, then adds the bundle as a project under the daily initiative. Use when the user asks to create commit messages, group commits, write good commits, add work to daily initiative, or to "commit everything" with grouped messages.
---

# Commit Messages (orchestrated)

Analyze the working tree (or staged) diff, do a **rough groupBy** into N logical commits, create **one branch per group**, then hand off to **one sub-agent per group in parallel** to stage, message, and commit. Finish by **merging all group branches into one and tagging**.

## Orchestrator workflow

1. **Inspect** — Run `git status` and `git diff --staged` (or `git diff` if nothing staged). If the user scoped to specific files or a branch, honor that.
2. **Exclude** — Identify paths to never commit (e.g. `.taskgraph/dolt/` stats, binary blobs, local-only files). Pass an exclude list so sub-agents do not stage them.
3. **Rough groupBy** — Cluster changed files by intent (same domain, same change type, refactor vs behavior, docs/chore). One group = one commit. Output:
   - Ordered list of groups: each with `{ files: string[], suggestedType?, suggestedScope?, oneLineHint? }`.
   - Optional `excludePaths: string[]` for the repo.
4. **Branches** — Record current branch (e.g. `main`) as the merge target. From that branch, create **one branch per group** from current HEAD, e.g. `chore/grouped-commits-YYYY-MM-DD-g1`, `-g2`, … `-gN` (e.g. `git branch <name>` for each). All N point at the same commit; each committer will checkout their branch and commit, so they can run in parallel without ref conflicts.
5. **TodoWrite** — Register one todo per group (e.g. "Commit 1: feat(cli) dashboard TUI", "Commit 2: feat(cli) cancel --include-done", …). Use `merge: false` with status `pending` (all in progress once dispatched).
6. **Dispatch committer sub-agents in parallel** — Emit **all N** committer invocations in the **same turn** (one Task or mcp_task per group). Each sub-agent gets a **distinct branch** (e.g. `chore/grouped-commits-YYYY-MM-DD-g1` for group 1). Pass to each:
   - `{{REPO_ROOT}}` — absolute path to repo root (or omit and say "workspace root").
   - `{{BRANCH}}` — **that group’s branch only** (e.g. `chore/grouped-commits-2026-03-02-g1`).
   - `{{GROUP_INDEX}}` — 1-based (e.g. "Commit 1 of 8").
   - `{{FILES}}` — exact paths for this group (relative to repo root).
   - `{{EXCLUDE_PATHS}}` — paths no group should stage.
   - `{{SUGGESTED_TYPE}}` / `{{SUGGESTED_SCOPE}}` / `{{ONE_LINE_HINT}}` — from groupBy.
     After all N complete, set all todos to `completed`.
7. **Merge and tag** — After all N committers have finished:
   - Checkout the merge target (e.g. `main`). Merge each group branch in order: `git merge --no-ff chore/grouped-commits-YYYY-MM-DD-g1`, then `-g2`, … then `-gN`. That yields one linear history on the target with N commits. (Alternatively create a single collector branch from main and merge g1…gN into it, then merge the collector into main.)
   - Create a tag (e.g. `grouped-commits-YYYY-MM-DD`) at the tip of the merged result.
8. **Add bundle to daily initiative** — Record the work in the task graph so it appears under the daily initiative:
   - **Resolve daily initiative:** Run `pnpm tg initiative list --json` (or `tg initiative list --json`). Find an initiative whose title is "Daily" or "Today" (case-insensitive). If none exists, use the default Unassigned initiative ID `00000000-0000-4000-8000-000000000000`, or create one: `pnpm tg initiative new "Daily"` and capture the returned `initiative_id` from output or a follow-up `tg initiative list --json`.
   - **Create project with meaningful summary:** Run `pnpm tg plan new "<title>"` with a title that meaningfully summarizes what was committed (e.g. "Grouped commits: dashboard TUI, cancel --include-done, db fixes, docs" or "2026-03-02 grouped commits (8) — CLI, db, docs, cursor"). Optionally add `--intent "<short summary>"` (e.g. one line listing the main areas or commit types). Capture the new project’s `plan_id` from the command output.
   - **Assign to daily initiative:** Run `pnpm tg initiative assign-project <dailyInitiativeId> <planId>` so the new project appears under the daily initiative.
   - Report to the user: branch name, N commits, tag name, **new project title and ID**, assignment to daily initiative, and any excluded paths they might want to add to `.gitignore`.

## Committer sub-agent prompt (per group)

Give each sub-agent a prompt like this. They do **not** use `tg`; they only run git in the repo.

```
You are the Committer sub-agent. You create exactly one git commit on an existing branch.

**Repo root:** {{REPO_ROOT}}

**Step 1 — Ensure branch**
Run: `cd {{REPO_ROOT}}` then `git checkout {{BRANCH}}`. The branch should already exist (orchestrator created one per group). If it does not exist, abort and report.

**Step 2 — Stage only your group’s files**
You must stage exactly these paths (and only these). Do not stage any path in EXCLUDE_PATHS.
Files to stage:
{{FILES}}

Exclude (do not stage): {{EXCLUDE_PATHS}}

Run: `git add <path>` for each file in FILES that exists and is not in EXCLUDE_PATHS. Verify with `git status` before committing.

**Step 3 — Write and run the commit**
Suggested type/scope: {{SUGGESTED_TYPE}}({{SUGGESTED_SCOPE}}). Hint: {{ONE_LINE_HINT}}
Write a single conventional-commit message: type(scope): imperative summary, optional body. Then run:
git commit -m "<message>"

**Step 4 — Report**
Return the commit hash and the message you used (e.g. "Committed abc1234: feat(cli): add dashboard alternate screen").
```

Use `model="fast"` for committer sub-agents.

## Message format (for sub-agents)

Conventional commits:

- **type**: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `style`
- **scope**: area (e.g. `cli`, `db`). Omit if repo-wide.
- **summary**: imperative, lowercase start, no period, ~50 chars.
- **body**: only when it adds rationale, breaking change, or reference.

## Grouping rules (rough pass)

- **Same domain** — Same dir or same feature → one group.
- **Same change type** — One group when "add tests for X" and "implement X" are the same logical unit; else split.
- **Refactor vs behavior** — Pure refactor (rename, extract) separate from behavior/feature when independent.
- **Docs/config** — Often one group: "docs: ..." or "chore: ..." unless part of a feature.

Avoid: one commit per file, or one giant commit with a vague message.

## Parallel dispatch

Each group has its **own branch** (e.g. `chore/grouped-commits-YYYY-MM-DD-g1` … `-gN`), so there are no ref conflicts. **Emit all N committer sub-agent invocations in the same turn** so they run in parallel. After all report completion, the orchestrator merges the group branches into the target (one by one in a fixed order) to get a linear history, then tags.

## Exclude list

Orchestrator should compute and pass to every committer:

- Paths under `.taskgraph/dolt/` (or other local Dolt state) unless the repo intentionally commits them.
- Any path the user said to exclude.
- Binary or generated paths that are not meant for version control.

## Daily initiative

The **daily initiative** is the initiative under which the bundle of work is recorded. Resolve it by:

- `tg initiative list --json` → look for an initiative with title **"Daily"** or **"Today"** (case-insensitive). Use its `initiative_id`.
- If none exists: use the default **Unassigned** initiative ID `00000000-0000-4000-8000-000000000000`, or run `tg initiative new "Daily"` and use the new initiative’s ID.

The new **project title** should meaningfully summarize the commits (e.g. "Grouped commits: dashboard TUI, cancel --include-done, docs" or "26-03-02 grouped commits (8)"). No tasks are created; the project is a single record that “this bundle of commits happened” and lives under the daily initiative for visibility in `tg status --initiatives` and project lists.

## After merge

- Suggest adding persistent exclusions to `.gitignore` if applicable.
- Report: branch created, N commits, merge target, tag created, **new project (title + ID) and daily initiative assignment**.

## Quick checklist (orchestrator)

- [ ] Ran `git status` and `git diff` (or `--staged`).
- [ ] Built exclude list and N groups with file lists and suggested type/scope/hint.
- [ ] Created one branch per group (g1 … gN); TodoWrite with N items.
- [ ] Dispatched all N committer sub-agents **in parallel** (same turn), each with its own branch.
- [ ] Merged all group branches into original (in order); created tag.
- [ ] Resolved daily initiative; created project with meaningful title; assigned project to initiative.
- [ ] Reported branch, commits, tag, new project, initiative assignment, and any .gitignore suggestions.
