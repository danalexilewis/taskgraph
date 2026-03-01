# Lead: Risk

## Purpose

Read-only risk assessment lead. The orchestrator gathers cross-plan data, reads plan files, rates 8 risk metrics, and produces a Risk Assessment Report. No sub-agents are dispatched; the orchestrator performs analysis directly.

## Skill and agents

- **Skill:** `/risk` (`.cursor/skills/risk/SKILL.md`)
- **Agent files**: None (orchestrator performs analysis directly)

## Pattern

1. **Gather** — Run `tg crossplan summary --json` or fall back to `tg status` + plan files.
2. **Read** — Read plan files for fileTree, risks, and task intents.
3. **Rate** — Rate 8 risk metrics (Entropy, Surface Area, Backwards Compat, Reversibility, Complexity Concentration, Testing Surface, Performance Risk, Blast Radius) per plan.
4. **Cross-plan** — If multiple plans, assess cross-plan interactions and file overlaps.
5. **Report** — Produce Risk Assessment Report.

## Input

- Plan scope (single or multi-plan)
- Optional crossplan summary JSON

## Output

- Risk Assessment Report (markdown): Summary table, Cross-Plan Interactions, Overall Risk, Mitigation Strategies, Key Risks, Recommended Execution Order.

## When to use

- User says "assess risk", "run risk assessment", or asks about risk/impact/safety of changes.
- Before committing to multi-plan execution.
- When evaluating a feature proposal or reviewing implementation plans.
