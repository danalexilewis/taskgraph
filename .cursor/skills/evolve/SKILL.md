---
name: evolve
description: Post-plan pattern mining; analyses task diffs from a completed plan to identify implementation anti-patterns and route learnings to agent templates and docs. Use when the user says /evolve, "evolve the last plan", or after a plan completes before the plan-merge step.
---

# Evolve — Post-Plan Pattern Mining

When this skill is invoked, analyse the completed plan's diffs for implementation anti-patterns and route findings as learnings to agent templates and docs. Do not stop to ask the human unless the plan branch cannot be located.

## Purpose

Review completed plan execution history (task diffs on the plan branch) to identify code patterns that required follow-up fixes. Route findings as learnings to agent templates (`implementer.md`, `quality-reviewer.md`) or new/updated docs/skills. Complements the automated session-end `learningMode` hook — evolve is targeted (plan-scoped, diff-grounded) rather than session-broad.

## Architecture

- **Lead (orchestrator):** Resolves the plan, collects diffs from the plan branch, dispatches a reviewer in research mode, synthesises findings, routes learnings to agent files.
- **Sub-agent:** Reviewer (read-only, inherit session model — do NOT pass `model="fast"`; pattern analysis requires reasoning quality). Tactical directive: analyse diffs for anti-patterns, classify, return structured findings.

| Agent | Purpose | Permission | Model |
|---|---|---|---|
| reviewer (research mode) | Analyse plan diffs for anti-patterns | read-only | inherit (session model) |

## Permissions

- **Lead:** read-write (appends to agent Learnings sections, optionally updates docs/skills)
- **Sub-agent (reviewer):** read-only

## When to use

- User says `/evolve`, "evolve the last plan", or "find patterns from this plan"
- Work skill orchestrator: optionally before the plan-merge step, after all tasks complete
- **Timing constraint:** Must run BEFORE the plan-merge step — the plan branch (`plan-<hash>`) is deleted after `wt merge main` runs. If already merged, use the fallback (git log on main for the squash commit).

## Decision tree

```mermaid
flowchart TD
    A[/evolve invoked] --> B{Plan branch exists?}
    B -->|Yes| C[git diff main...plan-hash]
    B -->|No - already merged| D[git log main --grep plan-name --patch -1]
    C --> E[git log plan-hash --not main --oneline]
    D --> E
    E --> F[Collect follow-up fix notes from tg tasks]
    F --> G[Dispatch reviewer in research mode]
    G --> H{Findings?}
    H -->|None| I[Report: no patterns found]
    H -->|Found| J[Route learnings by category]
    J --> K[Append to agent ## Learnings sections]
    K --> L[Report findings table to user]
    L --> M{Durable patterns?}
    M -->|Yes - 3+ occurrences| N[Suggest docs/skills update to user]
    M -->|No| O[Done]
    N --> O
```

## Step-by-step workflow

### Step 1 — Resolve the plan

- If user gave a plan name or ID: `pnpm tg status --tasks --json` to locate it. If they said "last plan" or "the plan we just finished", use the most recently completed plan from the same session context.
- Get the plan's `hash_id` from the plan row (needed for branch name `plan-<hash_id>`).
- Get the list of all done task IDs and titles in the plan.

### Step 2 — Get the plan diff

```bash
# Primary: full plan diff (requires plan branch to still exist)
git diff main...plan-<hash_id>

# Per-task commit list (for context)
git log plan-<hash_id> --not main --oneline

# Fallback: if plan branch already merged
git log main --grep="plan: <plan-name>" --patch -1
```

Also collect task notes that signal follow-up work:

```bash
# For each task in the plan, look for VERDICT: FAIL, STATUS: FIXED, follow-up, anti-pattern
pnpm tg status --tasks --json  # filter by planId, check event bodies
```

### Step 3 — Dispatch reviewer in research mode

Pass to a reviewer sub-agent (omit `model` — inherit session model):

- The full diff (or per-task diffs from `git log --patch`)
- List of follow-up fix task notes
- Tactical directive:

> "Analyse these diffs from plan '\<name\>'. For each implementation that was later fixed, flagged by a reviewer, or noted as an anti-pattern: identify the pattern, classify it as one of [SQL pattern | Type pattern | Error handling | Scope drift | Other], note the file and first-pass code snippet, note the corrected code snippet, and suggest a one-line agent-file directive (imperative sentence, e.g. 'Use query(repoPath).insert() for single-table INSERTs'). Return a structured findings list. If no anti-patterns are found, say so explicitly."

### Step 4 — Route learnings (orchestrator, not sub-agent)

For each finding from the reviewer:

- **SQL pattern** → append to `implementer.md ## Learnings` AND `quality-reviewer.md ## Learnings`
- **Type pattern** → append to `implementer.md ## Learnings`; optionally `quality-reviewer.md`
- **Error handling** → append to `quality-reviewer.md ## Learnings`
- **Scope drift** → append to `implementer.md ## Learnings`
- **Durable / structural** (same issue 3+ times or across multiple files) → note for docs/skills suggestion

**Before appending:** Scan the existing `## Learnings` section for the same directive (keyword match). If already present, skip — do not duplicate.

**Format for each entry:**

```
- **[YYYY-MM-DD]** <one-line summary>. <concrete directive: "Instead, do X" or "Always check Y before Z".>
```

**Consolidation:** When a Learnings section exceeds ~10 entries, fold recurring directives into the main agent template and prune old entries (per `.cursor/agents/README.md` consolidation rule).

### Step 5 — Report to user

Output the findings table and a summary of what was written. Do not import or create plan tasks unless the user explicitly asks for follow-up work.

## Output format

```markdown
## Evolve: Plan "<name>" — <YYYY-MM-DD>

### Findings
| Category | Pattern | File | Routed to |
|---|---|---|---|
| SQL pattern | raw INSERT template literal | src/cli/start.ts | implementer.md + quality-reviewer.md |

### Learnings written
- `implementer.md ## Learnings`: N entries added
- `quality-reviewer.md ## Learnings`: N entries added

### Durable patterns (suggest doc update)
- (none)
- OR: docs/skills/cli-command-implementation.md — add SQL builder rule
```

## Fallback: no plan branch

If the plan branch has already been merged and the squash commit cannot be found via grep:

1. Ask the user for a diff or git ref.
2. If in the same session: use the implementer sub-agent return messages and task evidence as proxy for "first-pass code."
3. Note the limitation in the report.
