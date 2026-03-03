---
name: commit-messages
description: Analyzes unstaged/staged diffs, groups changes into logical commits, then as the lead you stage each group and run git commit with a conventional message. Optionally add the bundle to the daily initiative. Use when the user asks to create commit messages, group commits, write good commits, add work to daily initiative, or to "commit everything" with grouped messages.
---

# Commit Messages (lead-only)

*nd*You** (the lead) do the commits. Do not dispatch sub-agents to commit.

1. **Inspect** — Run `git status` and `git diff --staged` (or `git diff` if nothing staged). Honor user scope (files or branch).
2. **Exclude** — Paths to never commit: e.g. `.taskgraph/dolt/` state, binaries, local-only files. Do not stage these.
3. **Group** — Cluster changed files by intent (same domain, same change type, refactor vs behaviour, docs/chore). One group = one commit. Ordered list of groups, each with `files`, optional `suggestedType`, `suggestedScope`, `oneLineHint`.
4. **Commit each group** — For each group in order:
   - Stage only that group’s files: `git add <path>` for each file in the group that exists and is not in the exclude list.
   - Write a single conventional-commit message (type(scope): imperative summary; optional body).
   - Run `git commit -m "<message>"`.
5. **Optional — daily initiative** — To record the bundle in the task graph: resolve daily initiative (`tg initiative list --json` → "Daily" or "Today"), create a project (`tg plan new "<title>"` with a short summary of what was committed), assign to daily initiative (`tg initiative assign-project <dailyInitiativeId> <planId>`). Report project title and ID to the user.

## Message format

- **type**: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `style`
- **scope**: area (e.g. `cli`, `db`). Omit if repo-wide.
- **summary**: imperative, lowercase start, no period, ~50 chars.
- **body**: only when it adds rationale, breaking change, or reference.

## Grouping rules

- Same domain or same feature → one group.
- Refactor separate from behaviour when independent.
- Docs/config often one group: "docs: ..." or "chore: ..." unless part of a feature.

Avoid: one commit per file, or one giant commit with a vague message.

## Exclude list

- Paths under `.taskgraph/dolt/` (or other local Dolt state) unless the repo commits them.
- Any path the user said to exclude.
- Binary or generated paths not meant for version control.

## Checklist

- [ ] Ran `git status` and `git diff` (or `--staged`).
- [ ] Built exclude list and N groups with file lists and suggested type/scope/hint.
- [ ] For each group: staged only that group’s files, wrote message, ran `git commit`.
- [ ] Optionally: resolved daily initiative, created project, assigned to initiative, reported to user.
