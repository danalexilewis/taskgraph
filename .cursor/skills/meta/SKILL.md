---
name: pattern-tasks
description: Enrich task graph with cross-project edges and notes. Use when you have multiple projects loaded and want to find file conflicts, domain clusters, architectural opportunities, and execution ordering. Run after assess-risk.
---

# Pattern-Tasks Skill

Enriches the task graph with cross-plan relationships by analyzing plans and tasks from Dolt, proposing **blocks** and **relates** edges and task notes, and writing to Dolt only after user approval.

## When to use

- User says "find patterns", "enrich tasks", or asks for cross-plan task analysis.
- You have multiple plans in the task graph and want to surface file conflicts, domain clusters, architectural opportunities, or execution ordering.
- Run **after** assess-risk (cross-plan risk assessment) when both risk and enrichment are needed.

## Workflow

### 1. Gather cross-plan data

Run:

```bash
pnpm tg crossplan summary --json
```

This returns domains, skills, file overlaps, and proposed edges across all plans. Parse the JSON for the analysis steps below.

### 2. Analyze and categorize

From the summary, identify:

| Pattern                         | What to look for                                                                                            | Proposed action                                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **File conflicts**              | Tasks from different plans touching the same files                                                          | Propose `blocks` edges (e.g. "Plan A task X blocks Plan B task Y on file F") with a short rationale.                           |
| **Domain clusters**             | Tasks sharing domains across plans                                                                          | Propose `relates` edges between tasks that share a domain.                                                                     |
| **Architectural opportunities** | Tasks in multiple plans that could share a common abstraction (e.g. same area of code, same kind of change) | Propose `relates` edges and/or suggest a note on one or both tasks (e.g. "Consider shared abstraction with task T in plan P"). |
| **Ordering opportunities**      | Which plans (or plan roots) should execute first to unblock others                                          | Present ordering recommendations; optionally propose `blocks` edges to encode dependencies.                                    |

### 3. Present proposals to the user

- List each proposed edge (blocks or relates) with: task IDs, plan names, and rationale.
- List any suggested task notes (which task, note text).
- **Do not write to Dolt yet.** Wait for explicit user approval (e.g. "apply", "go ahead", "write them").

### 4. On approval only — write to Dolt

- **blocks / relates edges:** Use `pnpm tg edge add <fromTaskId> <toTaskId> --type blocks|relates` (or the equivalent flags your CLI supports) for each approved edge.
- **Task notes:** Use `pnpm tg note <taskId> --msg "..."` for each approved note.

If the user does not approve, do not run any `tg edge add` or `tg note` commands.

## Important

- **Never write without user approval.** This skill can create incorrect cross-plan dependencies; every batch of edges and notes must be confirmed by the user before writing.
- If `tg crossplan summary --json` is not available, report that the crossplan CLI is required and suggest running the crossplan-cli task first.
