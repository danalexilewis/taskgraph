# Leads

Leads are specialized orchestration patterns used when a skill is invoked. This doc defines the concept, lists the lead registry, and explains how leads differ from workers and how to add a new lead.

## What is a lead?

A **lead** is an orchestration pattern created by skill invocation:

1. The **orchestrator** invokes a **skill** (e.g. `/investigate`, `/plan`, `/work`, `/test-review`).
2. The skill creates or follows a **lead** pattern: the lead dispatches **workers** (sub-agents), collects their results, and **synthesizes** the outcome.
3. Leads are **patterns within skills**, not separate agent definition files. They use agent files (e.g. `.cursor/agents/investigator.md`) as **prompt templates for workers**, not as the lead itself.

So: skill → lead (orchestration pattern) → workers (dispatched using agent files) → synthesis.

## Lead registry

| Lead            | Skill        | Agent file(s)                                                          | Purpose                                                                                                                                        |
| --------------- | ------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| investigator    | /investigate | investigator.md                                                        | Read-only investigation; dispatches investigator sub-agent with tactical directives.                                                           |
| planner-analyst | /plan        | planner-analyst.md                                                     | Pre-plan analysis; gathers codebase context before plan creation.                                                                              |
| execution       | /work        | implementer.md, reviewer.md                                            | Task execution loop; implementer does work, reviewer evaluates; orchestrator coordinates.                                                      |
| test-review     | /test-review | test-quality-auditor, test-infra-mapper, test-coverage-scanner         | Audits tests; dispatches scanner sub-agents; orchestrator synthesizes findings and plan.                                                       |
| review          | /review      | investigator.md, assessment specialists (optional)                     | Read-only code health, system health, optional risk assessment, and optional specialists (security, scorecard, factuality, fairness, rubric).  |
| rescope         | /rescope     | explorer.md, spec-reviewer.md, quality-reviewer.md, planner-analyst.md | PM-role lead that clarifies desired functionality vs shipped behavior.                                                                         |
| risk            | /risk        | (none; orchestrator direct)                                            | Read-only risk assessment using 8-metric model across plans.                                                                                   |
| meta            | /meta        | (none; orchestrator direct)                                            | Cross-plan and cross-project edge enrichment; writes only after user approval.                                                                 |
| debug           | /debug       | investigator.md, implementer.md (optional)                             | Systematic debugging: 4-phase process (investigate, pattern, hypothesis, implement); escalate after 3 failed fix attempts.                     |
| reprioritise    | reprioritise | (none; orchestrator direct)                                            | Reviews active projects, answers "right projects?", produces linear priority list; ensures ≥10 Ready tasks; updates order/activates as needed. |

## How leads differ from workers

|                | Leads                                                                  | Workers                                                     |
| -------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Role**       | Orchestrate: decide what to run, dispatch workers, synthesize results. | Execute: do the concrete work (code, investigation, tests). |
| **Created by** | Skills (when user invokes a skill).                                    | Dispatched by leads or by the orchestrator.                 |
| **Definition** | Pattern described in the skill and in this doc.                        | Agent files in `.cursor/agents/` used as prompt templates.  |

Leads coordinate; workers perform. A skill implements a lead by dispatching one or more workers and then combining their outputs.

## Adding a new lead

1. **Create the skill** in `.cursor/skills/<name>/` (e.g. SKILL.md, triggers, steps). The skill defines when the lead runs and how it orchestrates.
2. **Optionally add agent file(s)** in `.cursor/agents/` for workers the lead will dispatch (e.g. `my-worker.md`). Use these as prompt templates for sub-agent dispatch.
3. **Document the lead** in `docs/leads/<name>.md` (purpose, workers used, flow).
4. **Add a row to the registry** in this README (Lead | Skill | Agent file(s) | Purpose).

No code changes are required to "register" a lead beyond documenting it here and implementing the pattern in the skill.

## Sitrep and Formation

When `/work` is invoked without a specific plan, the execution lead **self-orients** using a **Situation Report (sitrep)**. The sitrep is shared state that all `/work` instances can read.

**File convention:** `reports/sitrep-YYYY-MM-DD-HHmm.md` (timestamped to the minute).

**Required frontmatter:**

```yaml
---
type: sitrep
generated_at: "2026-03-02T14:30:00Z"
generated_by: "<agent-name>"
---
```

**Required sections in the body:**

1. **Project Landscape** — Active initiatives, projects, their status (from `tg status --projects`, `--initiatives`).
2. **Workload Snapshot** — Doing tasks and owners, runnable tasks by plan, blocked tasks and reasons (from `tg status --tasks`, `tg next --json`).
3. **Cross-Plan Analysis** — File conflicts, domain clusters, ordering recommendations (from `tg crossplan summary --json` or manual).
4. **Health and Risks** — Stale doing tasks, recent failures, gate status, known issues (from `tg stats`, memory).
5. **Formation** — Recommended lead roles to fill (see schema below).
6. **Suggested Work Order** — Up to 3 prioritized work streams, each with: stream name, lead role, key tasks, rationale.

**Formation section schema (YAML in the sitrep body or frontmatter):**

```yaml
formation:
  - role: execution-lead
    cardinality: 1-3
    description: "Grinds through plan tasks"
    suggested: 2
    plans: ["Plan A", "Plan B"]
  - role: overseer
    cardinality: 0-1
    description: "Monitors active agents, detects stalls, manages formation"
    suggested: 1
  - role: investigator-lead
    cardinality: 0-1
    description: "Handles gate failures and debug clusters"
    suggested: 0
```

If a sitrep was written less than 1 hour ago, `/work` reuses it instead of regenerating. The human decides how many `/work` instances to spawn; each reads the sitrep and **self-selects** an available role from the formation.

**Lead roles (cardinality):** execution-lead (1–N), overseer (0–1), investigator-lead (0–1), planner-lead (0–1). Self-selection rules and the full table are in [.cursor/rules/available-agents.mdc](../.cursor/rules/available-agents.mdc) (Lead Roles and Formation).

## Standard skill anatomy

Every agentic skill SKILL.md should follow this section order:

1. Frontmatter (name, description)
2. Lead documentation link
3. When to use (triggers)
4. Architecture (lead + sub-agents table)
5. Permissions (lead + propagation rule + sub-agent table)
6. Decision tree (mermaid flowchart)
7. Workflow (numbered phases)
8. Output format / template
9. Reference (links to agent files, lead doc, rules)

Utility skills (e.g. create-hook) may omit Architecture, Permissions, and Decision tree.
