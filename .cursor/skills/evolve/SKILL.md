---
name: evolve
description: Post-plan pattern mining; analyses task diffs from a completed plan to identify implementation anti-patterns and route learnings to agent templates and docs. Use when the user says /evolve, "evolve the last plan", or after a plan completes before the plan-merge step.
---

# Evolve — Post-Plan Pattern Mining

When this skill is invoked, analyse the completed plan's diffs for implementation anti-patterns and route findings as learnings to agent templates and docs. Do not stop to ask the human unless the plan branch cannot be located.

**Shared learnings for sub-agents:** [.cursor/agent-utility-belt.md](../../agent-utility-belt.md). When routing learnings, prefer appending to the utility belt for cross-cutting patterns; keep agent-specific learnings in the agent file.

## Purpose

Review completed plan execution history (task diffs on the plan branch) to identify code patterns that required follow-up fixes. Route findings as learnings to agent templates (`implementer.md`, `quality-reviewer.md`) or new/updated docs/skills. Complements the automated session-end `learningMode` hook — evolve is targeted (plan-scoped, diff-grounded) rather than session-broad.

## Architecture

- **Lead (orchestrator):** Resolves the plan, collects diffs from the plan branch, dispatches a reviewer in research mode, synthesises findings, routes learnings to agent files.
- **Sub-agent:** Reviewer (read-only, inherit session model — do NOT pass `model="fast"`; pattern analysis requires reasoning quality). Tactical directive: analyse diffs for anti-patterns, classify, return structured findings.

| Agent                    | Purpose                              | Permission | Model                   |
| ------------------------ | ------------------------------------ | ---------- | ----------------------- |
| reviewer (research mode) | Analyse plan diffs for anti-patterns | read-only  | inherit (session model) |

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
    H -->|Found| H2{Diff coverage gate}
    H2 -->|Below minimum| I2[Report findings; skip routing]
    H2 -->|Meets minimum| J[Route learnings by category]
    J --> K[Append to agent ## Learnings sections]
    K --> L[Report findings table to user]
    L --> M{Durable patterns?}
    M -->|Yes - 3+ occurrences| N[Suggest docs/skills update to user]
    M -->|No| O[Done]
    N --> O
    I2 --> O
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

### Step 2b — Check agent transcripts (optional, high-value)

Agent transcripts (`agent-transcripts/<uuid>/subagents/*.jsonl`) capture the full tool-call sequence of each sub-agent — what it read, searched, edited, and in what order. For evolve, this reveals **process anti-patterns** that diffs alone cannot show:

- **Redundant tool calls** — agent read the same file 5 times, or searched for something already in context.
- **Wrong-file edits** — agent edited file A, then reverted and edited file B (the diff only shows B).
- **Missed context** — agent never read a key doc or type definition, leading to a type error fixed in a follow-up task.
- **Tool-call storms** — 30+ calls where 5 would have sufficed (e.g. reading one file at a time instead of batching).

To use: find the session(s) that executed this plan's tasks (`rg "<plan-name-or-task-id>" agent-transcripts/ --glob "*.jsonl" -l`), then read the sub-agent transcripts for tasks that had reviewer FAILs or follow-up fixes. Pass relevant excerpts to the reviewer alongside the diff. See `.cursor/rules/agent-transcripts.mdc`.

### Step 3 — Dispatch reviewer in research mode

Pass to a reviewer sub-agent (omit `model` — inherit session model):

- The full diff (or per-task diffs from `git log --patch`)
- List of follow-up fix task notes
- Tactical directive:

> "Analyse these diffs from plan '\<name\>'. For each implementation that was later fixed, flagged by a reviewer, or noted as an anti-pattern: identify the pattern, classify it as one of [SQL pattern | Type pattern | Error handling | Scope drift | Process/tooling | Other], note the file and first-pass code snippet, note the corrected code snippet, suggest a one-line agent-file directive (imperative sentence, e.g. 'Use query(repoPath).insert() for single-table INSERTs'), give recurrence (number of times this pattern appeared in the analysed set), and assign a **confidence** label: **high** (clear diff evidence and fix; no ambiguity), **medium** (reasonable inference from context), **low** (inferred or single data point). If agent transcript excerpts are provided, also look for **process anti-patterns**: redundant tool calls, missed context (key files never read), wrong-file edits that were reverted, or tool-call storms (30+ calls where fewer would suffice). Classify these as 'Process/tooling'. Return a structured findings list with confidence per finding. If no anti-patterns are found, say so explicitly."

### Step 3b — Evidence gate (minimum diff coverage)

Before routing any learnings to agent files or the utility belt, check that the analysed changes have **sufficient scope**. Only proceed to Step 4 when the gate passes. If the gate fails, skip routing and note it in the output (see **Learnings written** below).

**Thresholds (all required when applicable):**

1. **Sample size:** `sample_size >= 3` (number of commits on the plan branch, or number of done tasks in the plan, whichever was used for this run). Fewer than 3 commits/tasks is insufficient evidence to generalise.
2. **Diff coverage:** When the plan diff is available, require **either** (a) at least 2 files changed, **or** (b) at least 50 lines changed (insertions + deletions). Tiny or empty diffs must not drive routing.

**How to obtain diff metrics (when plan branch exists):**

```bash
git diff main...plan-<hash_id> --shortstat
# Output: "N files changed, X insertions(+), Y deletions(-)"
# files_changed = N; diff_lines = X + Y
```

When using the fallback (squash commit): use `git show <commit> --shortstat` to get files changed and line counts for the single patch.

**Gate result:**

- **Pass:** `sample_size >= 3` and (when diff available) `files_changed >= 2` or `diff_lines >= 50` → proceed to Step 4.
- **Fail:** Otherwise → do **not** append to any agent file or the utility belt. Still produce the full report (findings table, Metrics). In **Learnings written**, output exactly one line:  
  `Skipped (insufficient diff coverage: sample_size=N, threshold=3; diff_lines=L, files_changed=F; minimum required: 2 files or 50 lines).`  
  so the user and instrumentation see that routing was gated.

### Step 4 — Route learnings (orchestrator, not sub-agent)

**Only when the evidence gate (Step 3b) passes.** For each finding from the reviewer, routing and filtering may use the finding's **confidence** (high / medium / low): high-confidence findings are always routed; low-confidence findings may be routed optionally or only suggested. Then by category:

- **SQL pattern** → append to `implementer.md ## Learnings` AND `quality-reviewer.md ## Learnings`
- **Type pattern** → append to `implementer.md ## Learnings`; optionally `quality-reviewer.md`
- **Error handling** → append to `quality-reviewer.md ## Learnings`
- **Scope drift** → append to `implementer.md ## Learnings`
- **Durable / structural** (same issue 3+ times or across multiple files) → note for docs/skills suggestion; cross-cutting patterns → append to `.cursor/agent-utility-belt.md` (under the appropriate section)

**Dedupe check (mandatory before every append):** Before writing any new learning or utility-belt entry, check for duplicates in **both** agent learnings and the utility belt; skip or merge as follows.

- **When the target is an agent file** (e.g. `implementer.md ## Learnings`): (1) Read that file’s `## Learnings` section. (2) Read `.cursor/agent-utility-belt.md` (all sections that contain bullet-list learnings). If the same directive already exists in either (keyword or close paraphrase match), **skip** the new entry or **merge** into the existing one (e.g. add a date to an existing bullet); do not add a duplicate.
- **When the target is the utility belt** (`.cursor/agent-utility-belt.md`): (1) Read the utility belt. (2) Read the `## Learnings` sections of the agent files that typically receive this category (e.g. `implementer.md`, `quality-reviewer.md`). If the same directive already exists in any of them, **skip** or **merge**; do not add a duplicate.

**Format for each entry:**

```
- **[YYYY-MM-DD]** <one-line summary>. <concrete directive: "Instead, do X" or "Always check Y before Z".>
```

**Consolidation:** When a Learnings section exceeds ~10 entries, fold recurring directives into the main agent template and prune old entries (per `.cursor/agents/README.md` consolidation rule).

### Step 5 — Report to user

Output the findings table, the **Metrics** section (so metrics can be captured for instrumentation), and a summary of what was written. Do not import or create plan tasks unless the user explicitly asks for follow-up work.

## Output format

Structure every evolve report into two categories:

1. **State Documentation** — Point-in-time snapshot of the run: what was analysed, sample size, confidence, and recurrence counts. Use for instrumentation and run-quality scorecards.
2. **Pattern Learnings** — Reusable patterns, anti-patterns, and directives for agents: findings table, learnings written to agent files, and durable pattern suggestions for docs/skills.

Use the following structure so that metrics (e.g. for scorecards or analytics) can be captured consistently. Every evolve report must include both **State Documentation** and **Pattern Learnings** sections.

```markdown
## Evolve: Plan "<name>" — <YYYY-MM-DD>

## State Documentation (point-in-time snapshot)

Snapshot of what was analysed and run-quality metrics. Not reusable across runs.

### Metrics

| Field          | Value | Description |
| -------------- | ----- | ----------- |
| sample_size   | N     | Number of commits/diffs or tasks analysed for this run. |
| confidence    | low / medium / high | How reliable the findings are (e.g. single squash = low; full plan diff + task notes = high). |
| recurrence    | N     | Count of distinct patterns that appeared 2+ times, or total recurrence count across findings. |

### Run context (optional)

Plan: "<name>", branch: plan-<hash>, tasks: N, commits: N. Omit if redundant with Metrics.

## Pattern Learnings (reusable patterns and directives)

Findings, routed learnings, and durable pattern suggestions. Reusable by agents and docs.

### Findings

| Category    | Pattern                     | File             | Confidence | Routed to                            | Recurrence |
| ----------- | --------------------------- | ---------------- | ---------- | ------------------------------------ | ---------- |
| SQL pattern | raw INSERT template literal | src/cli/start.ts | high       | implementer.md + quality-reviewer.md | 2          |

(Recurrence: number of times this pattern appeared in the analysed diff set. Confidence: high | medium | low per finding — see **Confidence criteria (per finding)** below.)

**Confidence criteria (per finding)** — assign one label per finding; emit with each finding in the evolve output (Findings table and reviewer-structured list):

| Label     | Criteria |
| --------- | -------- |
| **high**  | Clear pattern and multiple occurrences (e.g. recurrence ≥ 2 with explicit fix or reviewer verdict). |
| **medium** | Clear pattern but single occurrence, or inferred from diff + context without a direct fix/verdict. |
| **low**   | Single occurrence with weak signal, or ambiguous (e.g. could be style preference or one-off). |

### Learnings written

- `implementer.md ## Learnings`: N entries added
- `quality-reviewer.md ## Learnings`: N entries added

### Durable patterns (suggest doc update)

- (none)
- OR: docs/skills/cli-command-implementation.md — add SQL builder rule
```

### Confidence criteria (per finding)

Assign one label per finding so consumers can prioritize. Emit the label with each finding in the evolve output (Findings table and reviewer-structured list).

| Label     | Criteria |
| --------- | -------- |
| **high**  | Clear pattern and multiple occurrences (e.g. recurrence ≥ 2 with explicit fix or reviewer verdict). |
| **medium** | Clear pattern but single occurrence, or inferred from diff + context without a direct fix/verdict. |
| **low**   | Single occurrence with weak signal, or ambiguous (e.g. could be style preference or one-off). |

### Structured report sections for metrics capture

**State Documentation:** The **Metrics** table (and optional **Run context**) is the canonical slot for run-quality instrumentation. Populate:

- **sample_size** — e.g. `git log plan-<hash> --not main --oneline | wc -l`, or number of done tasks in the plan.
- **confidence** — from context: full plan branch diff + task notes = high; single squash commit = medium; partial or inferred = low.
- **recurrence** — per row in Findings: how many times that pattern appeared; in the Metrics table you may also set recurrence to the number of findings with recurrence ≥ 2, or the sum of recurrence counts.

**Pattern Learnings:** The **Findings** table (including **Confidence** and **Recurrence** per row), **Learnings written**, and **Durable patterns** are the canonical slots for pattern and directive capture and for routing and filtering by confidence.

## Fallback: no plan branch

If the plan branch has already been merged and the squash commit cannot be found via grep:

1. Ask the user for a diff or git ref.
2. If in the same session: use the implementer sub-agent return messages and task evidence as proxy for "first-pass code."
3. Note the limitation in the report.
