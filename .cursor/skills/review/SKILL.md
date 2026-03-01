---
name: review
description: Read-only review of code health and system health using sub-agents; includes risk assessment when investigating a new feature or proposal. Use when the user asks for a review, health check, code health, system health, or to evaluate a new feature idea.
---

# Review (read-only)

This skill is **read-only**: no file edits, no database writes, no destructive commands. The orchestrator coordinates sub-agents that gather and assess; you synthesize their findings into a single report.

## When to use

- User says "review", "code health", "system health", "health check", or "how healthy is the codebase".
- User asks to evaluate a **new feature** or **proposal** — then also run risk assessment (see below).

## Scope

| User intent                     | Code health | System health | Risk assessment |
| ------------------------------- | ----------- | ------------- | --------------- |
| General review / health check   | Yes         | Yes           | No              |
| Review + new feature / proposal | Yes         | Yes           | Yes             |

**New feature potential** = user mentions a new feature, proposal, or "what if we add X"; or explicitly asks for risk assessment. When in doubt, include risk.

## Workflow

### 1. Gather baseline (orchestrator)

Run read-only commands so sub-agents have context:

- `pnpm tg status --tasks` — task graph state (doing, todo, blocked, stale).
- Optionally `pnpm tg status` (full output) for vanity metrics and active work.
- If risk is in scope: `pnpm tg crossplan summary --json` if available; else list active plans and read `plans/*.md` for fileTree/risks.

Capture output and pass into sub-agent prompts where useful.

### 2. Dispatch sub-agents (parallel, read-only)

Use **mcp_task** (or Task tool) with **readonly=true**. Emit all calls in the **same turn** so they run in parallel.

**Code health** — dispatch **investigator** (or generalPurpose with investigator-style directive):

- **Directive**: "Assess code health for this repo. Cover: (1) structure and layering (cli/domain/db, boundaries), (2) patterns and consistency (naming, error handling, types), (3) tech debt and hotspots, (4) test coverage and test quality signals, (5) main risks and gaps. Do not edit any file. Return structured findings: Files and roles, Architectural patterns, Risks and gaps, Suggested follow-up tasks."
- **Scope**: whole repo or user-specified path (e.g. `TARGET_PATH=src/cli`).
- **subagent_type**: investigator (preferred) or generalPurpose.

**System health** — dispatch **investigator** (or generalPurpose):

- **Directive**: "Assess system health for this task-graph repo. Use the following tg status output as input. Cover: (1) task graph state — stale doing tasks, orphaned or blocked tasks, plan completion; (2) gate/lint/typecheck — any known failure modes or flakiness; (3) dependency and tooling state; (4) operational readiness and suggested cleanup. Do not edit any file or run destructive commands. Return structured findings: summary, issues, suggested follow-up."
- **Context**: Paste `tg status --tasks` (and if available a one-line summary of gate: e.g. 'gate passes' or 'gate: typecheck failed on X').
- **subagent_type**: investigator or generalPurpose.

**Risk assessment (only when scope is new feature / proposal)** — run the **assess-risk** workflow:

- Either:
  - **Option A**: Apply the assess-risk skill yourself (read `.cursor/skills/assess-risk/SKILL.md` and `.cursor/skills/assess-risk/CODE_RISK_ASSESSMENT.md`; gather scope, rate metrics, produce the risk report), or
  - **Option B**: Dispatch a **generalPurpose** sub-agent with readonly=true and a prompt that includes the assess-risk skill content plus the current scope (plans, fileTree, crossplan summary if available). Ask it to produce the Risk Assessment Report per the template in CODE_RISK_ASSESSMENT.md.
- Use the same output template (Summary table, Cross-Plan Interactions, Mitigation Strategies, Recommended Execution Order) as in assess-risk.

### 3. Synthesize report (orchestrator)

Merge sub-agent outputs into one report. Suggested structure:

```markdown
## Review Report — [date or scope]

### Code health

[Findings from code-health sub-agent: structure, patterns, tech debt, tests, risks.]

### System health

[Findings from system-health sub-agent: task graph, gate, dependencies, cleanup.]

### Risk assessment (if in scope)

[Summary table and narrative from assess-risk; link to full risk report if produced separately.]

### Summary and next steps

- Overall health: ...
- Top 3–5 actionable items
- Optional: suggested follow-up tasks or plan ideas
```

Resolve conflicts (e.g. one agent says "tests adequate", another "gaps in X") by noting both and stating which you treat as authoritative and why.

### 4. Deliver

- Post the report in chat.
- Optionally write to `reports/review-YYYY-MM-DD.md` (create `reports/` if needed). If risk was in scope, you can write the full risk section to `reports/risk-assessment-YYYY-MM-DD.md` or keep it inside the main review file.

## Sub-agent constraints (remind in prompts)

- **Read-only**: No file edits, no `tg start`/`tg done`, no DB writes, no destructive or state-changing commands.
- **Structured output**: Request the sections above so synthesis is easy.
- **No code generation**: Sub-agents describe what they see and recommend; they do not write patches or config.

## Reference

- **Assess-risk**: `.cursor/skills/assess-risk/SKILL.md`, `.cursor/skills/assess-risk/CODE_RISK_ASSESSMENT.md`
- **Investigator**: `.cursor/agents/investigator.md`
- **Dispatch**: `.cursor/rules/subagent-dispatch.mdc` (use readonly and parallel batch in one turn)
