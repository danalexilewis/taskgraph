# Lead: Investigator

## Purpose

Read-only investigation lead. Created when the **/investigate** skill runs. The skill orchestrates only the **investigator** sub-agent (no implementer, planner-analyst, or others). The investigator gathers evidence and returns structured findings; the orchestrator synthesizes those into a plan and tasks.

## Skill and agent

- **Skill:** `/investigate` (`.cursor/skills/investigate/SKILL.md`)
- **Agent file:** `.cursor/agents/investigator.md` (prompt template for the sub-agent)

## Pattern

1. **Context** — Skill reads **end of chat** (summary, post-action, sub-agent/lead reports) and does a quick **docs/** scan to identify focus and hypotheses.
2. **Draft** — Skill drafts **investigation areas** and, for each, a **tactical directive**; drafts a plan name and investigation task list.
3. **Dispatch** — Skill dispatches the **investigator** sub-agent with tactical directives (and optional scope and context). Only the investigator is used; no other sub-agents.
4. **Synthesize** — Skill merges the investigator's **structured findings** into the draft, finalizes the plan and task list (including "Suggested follow-up tasks" from findings), and presents plan + tasks + summary to the user.

## Input (to investigator)

- **Tactical directive** — What to investigate (e.g. entrypoints, function chains, ASTs, stack traces, architecture, schemas, API facades).
- **Scope** (optional) — Paths, modules, or areas to focus on.
- **Context** (optional) — One-line reason (e.g. post-failure summary, "status --live" issue).

## Output (from investigator)

**Structured findings** (sections as applicable): files and roles, function chains / call graph, stack traces / error sites, architectural patterns, schemas / data shape, API facades, risks and gaps, suggested follow-up tasks. No YAML or full plan; no edits.

## When to use

- User says **/investigate** or wants to "investigate what to do next."
- **Post-action** — After work completes or fails; use end-of-chat summary and reports to decide what to investigate.
- **Understanding next steps** — When sub-agents or leads have reported and you need to turn that into concrete investigation areas and then a plan and tasks.
