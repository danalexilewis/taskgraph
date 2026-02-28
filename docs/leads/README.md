# Leads

Leads are specialized orchestration patterns used when a skill is invoked. This doc defines the concept, lists the lead registry, and explains how leads differ from workers and how to add a new lead.

## What is a lead?

A **lead** is an orchestration pattern created by skill invocation:

1. The **orchestrator** invokes a **skill** (e.g. `/investigate`, `/plan`, `/work`, `/test-review`).
2. The skill creates or follows a **lead** pattern: the lead dispatches **workers** (sub-agents), collects their results, and **synthesizes** the outcome.
3. Leads are **patterns within skills**, not separate agent definition files. They use agent files (e.g. `.cursor/agents/investigator.md`) as **prompt templates for workers**, not as the lead itself.

So: skill → lead (orchestration pattern) → workers (dispatched using agent files) → synthesis.

## Lead registry

| Lead | Skill | Agent file(s) | Purpose |
|------|-------|----------------|---------|
| investigator | /investigate | investigator.md | Read-only investigation; dispatches investigator sub-agent with tactical directives. |
| planner-analyst | /plan | planner-analyst.md | Pre-plan analysis; gathers codebase context before plan creation. |
| execution | /work | implementer.md, reviewer.md | Task execution loop; implementer does work, reviewer evaluates; orchestrator coordinates. |
| test-review | /test-review | test-quality-auditor, test-infra-mapper, test-coverage-scanner | Audits tests; dispatches scanner sub-agents; orchestrator synthesizes findings and plan. |

## How leads differ from workers

| | Leads | Workers |
|--|--------|--------|
| **Role** | Orchestrate: decide what to run, dispatch workers, synthesize results. | Execute: do the concrete work (code, investigation, tests). |
| **Created by** | Skills (when user invokes a skill). | Dispatched by leads or by the orchestrator. |
| **Definition** | Pattern described in the skill and in this doc. | Agent files in `.cursor/agents/` used as prompt templates. |

Leads coordinate; workers perform. A skill implements a lead by dispatching one or more workers and then combining their outputs.

## Adding a new lead

1. **Create the skill** in `.cursor/skills/<name>/` (e.g. SKILL.md, triggers, steps). The skill defines when the lead runs and how it orchestrates.
2. **Optionally add agent file(s)** in `.cursor/agents/` for workers the lead will dispatch (e.g. `my-worker.md`). Use these as prompt templates for sub-agent dispatch.
3. **Document the lead** in `docs/leads/<name>.md` (purpose, workers used, flow).
4. **Add a row to the registry** in this README (Lead | Skill | Agent file(s) | Purpose).

No code changes are required to “register” a lead beyond documenting it here and implementing the pattern in the skill.
