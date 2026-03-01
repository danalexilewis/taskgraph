# Lead: Rescope (Deprecated)

> **Deprecated.** This lead is merged into the Plan skill. Use `/plan` and classify the request as **Pivot/Rescope** mode. The Plan skill's mode decision tree handles "shipped behavior doesn't match intent" directly, including dispatching a spec-reviewer to surface gaps.

## Purpose (archived)

Product-manager lead that clarifies desired functionality when shipped behavior does not match intent. Read-only; does not write code. Dispatches optional sub-agents (explorer, spec-reviewer, quality-reviewer, planner-analyst) to assess current state vs desired state.

## Skill and agents

- **Skill:** `/rescope` (`.cursor/skills/rescope/SKILL.md`)
- **Agent files** (workers; all optional):
  - `.cursor/agents/explorer.md` — map current implementation and behavior
  - `.cursor/agents/spec-reviewer.md` — check if implementation matches intent
  - `.cursor/agents/quality-reviewer.md` — check implementation quality
  - `.cursor/agents/planner-analyst.md` — broader codebase context for plan

## Pattern

1. **Capture** — Extract directive, scope anchor, constraints from user message.
2. **Decide** — Choose which sub-agents (if any) to dispatch based on need.
3. **Assess** — Run sub-agents (explorer, spec-reviewer, quality-reviewer, or planner-analyst).
4. **Produce** — Synthesize findings into a rescope document with current state, gaps, and recommended next steps.

## Input

- User directive describing desired behavior
- Scope anchor (feature or area)

## Output

- Rescope document (markdown): Directive, Current state, Gaps, Recommended next steps.

## When to use

- User says "rescope", "clarify scope", "this isn't quite right"
- User gives a directive describing desired behavior after tasks are done
