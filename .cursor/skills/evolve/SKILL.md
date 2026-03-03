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

## Inputs

- **Primary (required):** Plan diff (from plan branch or fallback) and follow-up fix task notes.
- **Optional:** Findings from the **/review** skill — code-health and/or system-health sections. When the user has run /review and provides that report (paste, path to `reports/review-*.md`, or inline code-health/system-health sections), use them as additional inputs so the reviewer can consider both plan diffs and review findings for pattern mining and routing.

## When to use

- User says `/evolve`, "evolve the last plan", or "find patterns from this plan"
- Work skill orchestrator: optionally before the plan-merge step, after all tasks complete
- **Timing constraint:** Must run BEFORE the plan-merge step — the plan branch (`plan-<hash>`) is deleted after `wt merge main` runs. If already merged, use the fallback (git log on main for the squash commit).

## Conflict resolution: evolve vs review

When the **evolve** skill and the **/review** skill (or a reviewer sub-agent) disagree — e.g. on whether a learning should be applied, how to route it, or whether a finding is an anti-pattern — use the following rule so orchestrators and evolve flows resolve consistently.

| Situation | Resolution |
| --------- | ---------- |
| **Review says "do not apply" / "not a valid learning"** | Defer to review. Do not append the learning to agent files. Optionally note the finding in the evolve report as "review-disagreed" and skip routing. |
| **Review says "route differently"** (e.g. different agent or doc) | Use review's routing. Evolve's default routing (implementer/quality-reviewer/docs) is a default; review's domain-specific suggestion wins when it contradicts. |
| **Review says "risk/safety concern"** and evolve did not request risk | Halt applying that learning until risk assessment (or risk-preparedness-reviewer / adversarial-security-reviewer) has been run. Review wins on safety. |
| **Both have evidence; neither is safety** | Orchestrator decides: either apply evolve's learning with a short note that review disagreed, or merge both views (e.g. apply learning but add the reviewer's caveat as a one-line qualifier in the Learnings entry). Prefer merging when the disagreement is nuance, not correctness. |
| **Irreconcilable or high-stakes** | Escalate to the user: report both positions and do not apply the disputed learning until the user confirms. |

**Who wins:** For safety, security, and high-impact domains, **review (and risk) wins**. For routine implementation learnings where review only suggests different wording or routing, **orchestrator** may merge both views or choose one and note the other in the report. When in doubt, **escalate to the user**.

## Specialist dispatch during or after evolve

When an evolve run surfaces or routes learnings that are **security-, factuality-, or fairness-sensitive**, dispatch the matching specialist **during** (before routing) or **after** (to validate routed learnings) the evolve flow. This ensures high-impact learnings are vetted before they change agent behavior.

| Sensitivity | Specialist | When to dispatch |
| ----------- | ---------- | ---------------- |
| **Security** | **adversarial-security-reviewer** | Evolve findings touch CLI, MCP, plan-import, db, or user/agent input handling; or the plan diff introduces or changes code in those areas. Dispatch with the plan diff (or the learnings + target agent snippets) and request VERDICT: PASS / CONCERNS / FAIL. Do not route security-relevant learnings until the specialist passes or concerns are resolved. |
| **Factuality / docs** | **factuality-traceability-reviewer** | Evolve findings or routed learnings touch `docs/`, critical comments, or domain rules (schema, glossary). Dispatch with the diff + affected docs and request PASS/FAIL with specific inconsistencies. Route learnings only after factuality pass or after fixing noted inconsistencies. |
| **Fairness / process** | **fairness-equity-auditor** | Evolve is run in a multi-plan or multi-agent context and findings might affect task graph balance (e.g. learnings that change who gets work or how priorities are applied). Dispatch with `tg status --tasks` and `tg status --projects` (and optionally initiative rollup); request structured report (skews, rebalances). Consider rebalancing before applying learnings that affect process fairness. |

- **During evolve:** After the reviewer (research mode) returns findings, if any finding is security/factuality/fairness-sensitive, dispatch the relevant specialist(s) **before** Step 4 (route learnings). Gate routing on specialist verdict (e.g. do not append to agent files until adversarial-security passes or concerns are addressed).
- **After evolve:** Optionally run the relevant specialist on the **routed learnings** (e.g. the new agent-file entries or doc changes) to validate they do not introduce security, factuality, or fairness issues.
- **Agent templates and lead docs:** `.cursor/agents/adversarial-security-reviewer.md`, `factuality-traceability-reviewer.md`, `fairness-equity-auditor.md`; lead docs in `docs/leads/`. Use the same readonly dispatch pattern as in the /review skill.

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

### Step 1 — Resolve the plan and optional review inputs

- If user gave a plan name or ID: `pnpm tg status --tasks --json` to locate it. If they said "last plan" or "the plan we just finished", use the most recently completed plan from the same session context.
- Get the plan's `hash_id` from the plan row (needed for branch name `plan-<hash_id>`).
- Get the list of all done task IDs and titles in the plan.
- **If the user provides /review findings:** Accept code-health and/or system-health content (e.g. pasted report, path to `reports/review-YYYY-MM-DD.md`, or explicit "use the last review"). Load or retain those sections for Step 3 so the reviewer can use them alongside the plan diff.

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

### Step 2c — Evidence gate (minimum diff coverage)

Before dispatching the reviewer or routing any learnings, require **minimum diff coverage** so evolve does not route on trivial or empty diffs.

- **Threshold:** At least **20 lines changed** (insertions + deletions). Measure using:
  - **Plan branch exists:** `git diff main...plan-<hash_id> --shortstat` — parse the summary line (e.g. "3 files changed, 45 insertions(+), 12 deletions(-)") and require insertions + deletions ≥ 20.
  - **Fallback (already merged):** From the squash commit patch, require at least 20 lines of diff output (e.g. count lines from `git log main --grep="plan: <plan-name>" --patch -1` that start with `+` or `-` and are not only whitespace/context).
- **If the gate fails:** Do **not** run Step 3 (do not dispatch the reviewer) or Step 4. Report to the user: **"Evolve skipped: insufficient diff coverage (X lines changed, minimum 20). No learnings routed."** Include the State Documentation block with Metrics (`sample_size`, `diff_lines`, `confidence: low`) so instrumentation is consistent.

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
- **When available:** Code-health and/or system-health findings from /review (paste the relevant sections or path to the report). The reviewer uses these alongside the diff to cross-reference (e.g. tech debt or risks called out in review with anti-patterns in the plan diff) and to route learnings.
- Tactical directive:

> "Analyse these diffs from plan '\<name\>'. For each implementation that was later fixed, flagged by a reviewer, or noted as an anti-pattern: identify the pattern, classify it as one of [SQL pattern | Type pattern | Error handling | Scope drift | Process/tooling | Other], note the file and first-pass code snippet, note the corrected code snippet, suggest a one-line agent-file directive (imperative sentence, e.g. 'Use query(repoPath).insert() for single-table INSERTs'), give recurrence (number of times this pattern appeared in the analysed set), and assign a **confidence** (high | medium | low) using the confidence criteria below so consumers can prioritize. If agent transcript excerpts are provided, also look for **process anti-patterns**: redundant tool calls, missed context (key files never read), wrong-file edits that were reverted, or tool-call storms (30+ calls where fewer would suffice). Classify these as 'Process/tooling'. Return a structured findings list with confidence per finding. If no anti-patterns are found, say so explicitly. If **review findings** (code-health and/or system-health) were provided, use them as additional input: cross-reference review-flagged areas (e.g. tech debt, risks, hotspots) with the plan diff and include any overlapping or reinforcing patterns in your findings."

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

**Dedupe check (mandatory before every append):** Before writing any new learning to agent `## Learnings`, the utility belt, memory, or docs, check that it is not already present in **agent learnings** or the **utility belt** and skip or merge as follows.

- **Sources to check every time:** (1) `.cursor/memory.md`, (2) `.cursor/pending-learnings.md` (if present), (3) `.cursor/agent-utility-belt.md`, (4) the relevant agent file’s `## Learnings` section (e.g. `implementer.md`, `quality-reviewer.md`). Read these once at the start of Step 4, then for each candidate learning check for keyword or close-paraphrase match in any of them.
- **When the target is an agent file** (e.g. `implementer.md ## Learnings`): If the same directive already exists in memory, pending-learnings, the utility belt, or that file’s Learnings section, **skip** the new entry or **merge** into the existing one (e.g. add a date to an existing bullet); do not add a duplicate.
- **When the target is the utility belt** (`.cursor/agent-utility-belt.md`): If the same directive already exists in memory, pending-learnings, the utility belt, or the relevant agent Learnings sections, **skip** or **merge**; do not add a duplicate.

**Format for each entry:**

```
- **[YYYY-MM-DD]** <one-line summary>. <concrete directive: "Instead, do X" or "Always check Y before Z".>
```

**Consolidation:** When a Learnings section exceeds ~10 entries, fold recurring directives into the main agent template and prune old entries (per `.cursor/agents/README.md` consolidation rule).

### Step 5 — Report to user

Emit both **Pattern Learnings** and **State Documentation** in the report so the orchestrator and downstream steps can use them separately (routing vs instrumentation/context). Do not import or create plan tasks unless the user explicitly asks for follow-up work.

## Output categories

Split evolve outputs into two categories:

1. **Pattern Learnings** — Reusable patterns, anti-patterns, and directives for agents: the findings table (category, pattern, file, confidence, routed-to, recurrence), learnings written (which agent files received entries), and durable-pattern suggestions for docs/skills. Downstream steps use this to perform routing; do not use for run context.

2. **State Documentation** — Point-in-time state and snapshot of what was found: what was done (plan name, branch, scope), metrics (sample_size, confidence, recurrence for instrumentation), task/commit counts. Used for reporting, scorecards, and context only.

## Output format

Use the following structure. Every evolve report must include both **Pattern Learnings** and **State Documentation** blocks.

```markdown
## Evolve: Plan "<name>" — <YYYY-MM-DD>

## State Documentation

(Descriptive only; no routing. Use for instrumentation and context.)

### Metrics

| Field          | Value | Description |
| -------------- | ----- | ----------- |
| sample_size   | N     | Number of commits/diffs or tasks analysed for this run. |
| diff_lines    | N or — | Sum of insertions + deletions from plan diff (or — if unavailable). Used by evidence gate. |
| files_changed | N or — | Number of files changed in plan diff (or — if unavailable). Used by evidence gate. |
| confidence    | low / medium / high | How reliable the findings are (e.g. single squash = low; full plan diff + task notes = high). |
| recurrence    | N     | Count of distinct patterns that appeared 2+ times, or total recurrence count across findings. |

### What was done

- Plan: "<name>", branch: plan-<hash> (or fallback: squash on main).
- Tasks analysed: N. Commits in diff: N. (Optional: short list of task IDs or file count.)

## Pattern Learnings

(Actionable: route these to memory/docs/templates as in Step 4.)

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

When the evidence gate (Step 2c) failed (before reviewer), output: **Skipped (insufficient diff coverage: X lines changed, minimum 20). No learnings routed.**

When the evidence gate (Step 3b) fails (after reviewer), output instead of the learnings list:

- Skipped (insufficient diff coverage: sample_size=N, threshold=3; diff_lines=L, files_changed=F; minimum required: 2 files or 50 lines).

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

**State Documentation:** The **Metrics** table and **What was done** narrative are the canonical slots for run-quality instrumentation and context. Populate:

- **sample_size** — e.g. `git log plan-<hash> --not main --oneline | wc -l`, or number of done tasks in the plan.
- **diff_lines** — from `git diff main...plan-<hash> --shortstat` (insertions + deletions), or from `git show <commit> --shortstat` in fallback; use "—" when diff is unavailable.
- **files_changed** — from the same `--shortstat` output; use "—" when diff is unavailable. These two fields are used by the evidence gate and must be present when the diff was used.
- **confidence** — from context: full plan branch diff + task notes = high; single squash commit = medium; partial or inferred = low. If review findings (code-health/system-health) were included as input, treat confidence as high when combined with plan diff.
- **recurrence** — per row in Findings: how many times that pattern appeared; in the Metrics table you may also set recurrence to the number of findings with recurrence ≥ 2, or the sum of recurrence counts.

**Pattern Learnings:** The **Findings** table (including **Confidence** and **Recurrence** per row), **Learnings written**, and **Durable patterns** are the canonical slots for pattern and directive capture and for routing and filtering by confidence.

## Acceptance criteria for behavior-change validation

Closed-loop verification needs a clear pass/fail definition for "did this learning actually change behavior?" After evolve routes learnings to agent files or docs, use the following criteria to validate that the learning had an effect. A learning is considered to have **changed behavior (PASS)** when at least one of the following holds on a subsequent run or measurement:

| Criterion | Definition | How to verify |
| --------- | ---------- | ------------- |
| **Scenario non-repetition** | The next run of the same scenario (same plan type, task types, or code paths) does not repeat the anti-pattern that was learned. | Re-run a similar plan or task set; confirm the finding (e.g. raw SQL, wrong-file edit, missed context) does not appear in the diff or in reviewer findings. |
| **Reviewer pass rate** | Reviewer pass rate for the relevant category (e.g. SQL pattern, Type pattern) improves after the learning was routed. | Compare VERDICT: PASS rate (or count of same-pattern findings) over N tasks before the learning was added vs N tasks after. |
| **Metric delta** | A defined metric improves before/after. | Examples: recurrence count for that pattern drops to 0 in the next plan; confidence-weighted recurrence decreases; number of findings in the learned category decreases while sample_size/diff_lines remain sufficient. |
| **Explicit negative check** | The learning was a "do not do X" directive; a subsequent run shows no violations of X. | Run evolve or reviewer on a later plan; if the check for X finds no violations → PASS; if violations are found → FAIL. |

**Pass:** At least one of the above criteria is satisfied on the next relevant run or measurement.  
**Fail:** The same anti-pattern recurs in the next run of a similar scenario, or the chosen metric (pass rate, recurrence, violations) does not improve or worsens.

When designing or running closed-loop verification, pick one or more criteria and the measurement method (e.g. "recurrence of pattern P in next plan", "reviewer pass rate for SQL pattern in next 5 tasks") so the result is unambiguous.

## Fallback: no plan branch

If the plan branch has already been merged and the squash commit cannot be found via grep:

1. Ask the user for a diff or git ref.
2. If in the same session: use the implementer sub-agent return messages and task evidence as proxy for "first-pass code."
3. Note the limitation in the report.
