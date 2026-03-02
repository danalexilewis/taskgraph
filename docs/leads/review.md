# Lead: Review

## Purpose

Read-only review lead for code health, system health, and optional risk assessment. Dispatches investigator sub-agents in parallel; synthesizes findings into a single report.

## Skill and agents

- **Skill:** `/review` (`.cursor/skills/review/SKILL.md`)
- **Agent files** (workers):
  - `.cursor/agents/investigator.md` — code health and system health investigation
  - Optionally: risk skill or generalPurpose agent for risk assessment
  - **Assessment specialists** (when scope or user intent matches): adversarial-security-reviewer, risk-preparedness-reviewer, factuality-traceability-reviewer, fairness-equity-auditor, rubric-driven-reviewer (see `.cursor/agents/` and `docs/leads/` for each)

## Pattern

1. **Gather baseline** — Run `tg status --tasks` and optionally `tg status` for vanity metrics.
2. **Dispatch** — Launch investigator sub-agents (code health, system health) in parallel with readonly=true. If new feature/proposal, also run risk.
3. **Synthesize** — Merge sub-agent outputs into one report.
4. **Deliver** — Post report in chat; optionally write to `reports/`.

## Input

- User request for review/health check
- Scope: general (code + system) or feature/proposal (code + system + risk)

## Output

- Review Report (markdown): Code health, System health, Risk assessment (if in scope), Summary and next steps.

## When to use

- User says "review", "code health", "system health", "health check", "how healthy is the codebase"
- User asks to evaluate a new feature or proposal (adds risk assessment)
