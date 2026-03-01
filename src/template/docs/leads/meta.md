# Lead: Meta

## Purpose

Enrichment lead that analyzes cross-plan (and optionally cross-project) task relationships. Proposes edges and notes; writes to the task graph only after user approval.

## Skill and agents

- **Skill:** `/meta` (`.cursor/skills/meta/SKILL.md`)
- **Agent files**: None (orchestrator performs analysis directly using crossplan CLI or manual analysis)

## Pattern

1. **Gather** — Run `tg crossplan summary --json` or fall back to manual analysis from plan files and task status.
2. **Analyze** — Identify file conflicts, domain clusters, architectural opportunities, and ordering.
3. **Present** — List proposed edges and notes to the user. Do NOT write yet.
4. **Write** — Only after explicit user approval, write edges and notes to the task graph.

## Input

- Cross-plan summary (from CLI) or manual plan/task analysis
- Scope: cross-plan (default) or cross-project (extended)

## Output

- Proposed edges (blocks/relates) and task notes
- Written to task graph only after user approval

## When to use

- User says "find patterns", "enrich tasks", or asks for cross-plan task analysis
- Multiple plans in the task graph; want to surface file conflicts, domain clusters, execution ordering
- Run after risk when both risk and enrichment are needed
