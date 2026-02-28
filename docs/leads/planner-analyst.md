# Lead: Planner Analyst

## Purpose

Pre-plan analysis so the orchestrator can write a grounded plan. The planner-analyst lead is created by the **/plan skill**; it dispatches the analyst sub-agent to gather codebase and task-graph context, then the orchestrator uses that structured analysis to author the plan.

## When

**Mandatory before plan creation.** The /plan skill must run Phase 1 (analyst) before Phase 2 (orchestrator writes plan). Do not write a plan without analyst output.

## Pattern

1. **Skill** (/plan) is invoked.
2. **Skill dispatches** the planner-analyst sub-agent using the prompt in `.cursor/agents/planner-analyst.md`.
3. **Analyst** gathers context (codebase, Dolt/task-graph state, patterns, risks, rough breakdown).
4. **Orchestrator** receives the structured analysis and writes the plan (architecture, dependencies, task design).

Two-phase: analyst gathers facts; orchestrator writes the plan.

## Agent file

- **Worker:** `.cursor/agents/planner-analyst.md` — prompt template and output contract for the analyst sub-agent.

## Input

- **User request** — feature or change description (required; may be multi-line).
- **Optionally** — current task-graph state: orchestrator runs `pnpm tg status` and passes the output so the analyst can reference active plans and recent done tasks without re-running the CLI.

## Output

Structured analysis (from the analyst), including:

- Relevant files and roles
- Existing data and derivable metrics
- Existing patterns
- Potential risks and dependencies
- Dolt / task-graph state
- Related prior work
- Suggested task breakdown (rough) with dependency notes
- Recommended docs and skills per task

The analyst does **not** produce YAML or the final plan; the orchestrator uses this analysis as input to write the plan.

## References

- Plan skill: `.cursor/skills/plan/SKILL.md`
- Agent contract: `docs/agent-contract.md`, AGENT.md
- Lead registry: `docs/leads/README.md`
