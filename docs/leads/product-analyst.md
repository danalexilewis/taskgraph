---
triggers:
  files: [".cursor/agents/product-analyst.md", ".cursor/skills/plan/SKILL.md"]
  change_types: ["create", "modify"]
  keywords: ["product analyst", "strategic", "classification", "plan skill"]
---

# Lead: Product Analyst

## Purpose

Product-level and strategic analysis to support plan creation when **plan mode is Strategic**. The /plan skill classifies plan mode (Tactical vs Strategic); when Strategic, it **dispatches** the product-analyst sub-agent before the planner-analyst to produce options, outcomes, priorities, and scope framing.

## When

**Dispatched by the /plan skill when plan mode is Strategic.** Strategic signals: goals/outcomes/priorities unclear, "figure out what to do", "prioritise", "what should we build", "explore options", "roadmap", "strategy", initiative-level or cross-project scope. When plan mode is Tactical (clear single-feature or scoped request), the product analyst is not dispatched; planner-analyst remains mandatory for all plans.

## Pattern

1. **Skill** (/plan) is invoked; orchestrator classifies **plan mode** (Tactical vs Strategic).
2. **If Strategic:** Orchestrator dispatches the product-analyst sub-agent using the prompt in `.cursor/agents/product-analyst.md`.
3. **Product analyst** returns structured output: options, outcomes, priorities, or recommended direction.
4. **Orchestrator** uses that output as `{{STRATEGIC_CONTEXT}}` and proceeds with request-mode classification and planner-analyst, then plan authoring with the Strategic checklist.

Product analyst is Phase 0 when Strategic; planner-analyst (Phase 1) remains mandatory before writing the plan.

## Agent file

- **Worker:** `.cursor/agents/product-analyst.md` — prompt template and output contract for the product-analyst sub-agent.

## Input

- **User request** — initiative, roadmap, or feature description (required; may be multi-line).
- **Optionally** — current initiatives/projects: orchestrator runs `pnpm tg status --initiatives` and/or `tg status --projects` and passes the output so the analyst can align to existing work.

## Output

Structured product/strategic analysis (from the analyst), including:

- **Goals and success outcomes** — What "done" looks like from a product perspective; measurable or observable outcomes.
- **Scope boundaries** — Scope-in (what this plan owns) and scope-out (explicitly out of scope or deferred).
- **Initiative alignment** — How this request relates to existing initiatives or projects; whether it should attach to one or stand alone.
- **Classification** — Optional: suggested mode (e.g. Greenfields, Improvement, Refactor, Pivot) or tags that the orchestrator can use when briefing the planner-analyst.

The analyst does **not** produce the plan or task breakdown; the orchestrator uses this to frame the request and optionally inject focus into the planner-analyst phase.

## References

- Plan skill: `.cursor/skills/plan/SKILL.md`
- Planner-analyst (mandatory phase): `docs/leads/planner-analyst.md`
- Agent contract: `docs/agent-contract.md`, AGENT.md
- Lead registry: `docs/leads/README.md`
