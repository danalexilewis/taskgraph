---
triggers:
  files: [".cursor/agents/**", "docs/leads/**", "AGENT.md"]
  change_types: ["create", "modify"]
  keywords: ["agent", "orchestrator", "lead", "worker", "subagent"]
---

# Agent Strategy

High-level reference for the agent system: orchestrator, leads, workers, and how they interact.

## Orchestrator

The **orchestrator** is the session-model agent (the main Cursor agent in a chat). It:

- Interprets user intent and decides whether a skill applies or to use the default path.
- Chooses skills when the user invokes them (e.g. `/plan`, `/work`, `/investigate`); otherwise defaults to **generalPurpose**.
- Dispatches **leads** (when a skill creates one) and **workers** (task-level executors).
- Coordinates only: it does not perform bounded implementation work except as **fallback** after a worker has failed twice on the same task.

See [AGENT.md](../AGENT.md) and [.cursor/rules/subagent-dispatch.mdc](../.cursor/rules/subagent-dispatch.mdc) for execution protocol.

## Leads

**Leads** are specialized orchestration patterns created when a skill is invoked. A lead:

- Receives a directive from the orchestrator (e.g. “run investigation”, “create a plan”, “execute plan tasks”).
- Dispatches **workers** to do the actual work.
- Synthesizes results and reports back.

Leads are defined by skills and documented in **docs/leads/**. Examples:

| Lead | Skill / trigger | Role |
| ----- | ----------------- | ----- |
| Investigator | `/investigate` | Run investigation, dispatch investigator worker, produce plan/tasks |
| Planner-analyst | `/plan` | Gather context, dispatch planner-analyst, produce plan |
| Execution | `/work` | Run task loop, dispatch implementer + reviewer |
| Test-review | `/test-review` | Audit tests, dispatch test scanners, synthesize findings |

See [docs/leads/README.md](leads/README.md) for the lead registry.

## Workers

**Workers** are task-level executors. They do bounded work; they do not orchestrate other agents. Examples:

- **implementer** — Executes a single task from the task graph (start → work → done).
- **reviewer** — Evaluates an implementation against the task spec.
- **explorer** — Codebase exploration (quick / medium / thorough).
- **spec-reviewer** — Reviews specs or plan structure.
- **quality-reviewer** — Quality checks on deliverables.
- **Test scanners** — test-coverage-scanner, test-infra-mapper, test-quality-auditor.

Worker prompts live in [.cursor/agents/](.cursor/agents/); see [.cursor/agents/README.md](../.cursor/agents/README.md).

## generalPurpose Default

When the user asks something **without** invoking a skill:

- The orchestrator uses **generalPurpose**: there is no lead.
- The orchestrator either dispatches a worker (e.g. generalPurpose, explorer) or does the work directly, depending on the request.

No skill ⇒ no lead ⇒ generalPurpose path.

## Decision Tree

1. **User invokes a skill** (e.g. `/plan`, `/work`, `/investigate`) → skill runs → skill creates a **lead** → lead **dispatches workers** → lead synthesizes and reports.
2. **User asks without a skill** → **generalPurpose**: orchestrator handles via direct dispatch or direct execution, no lead.

## File Layout

| Location | Purpose |
| -------- | -------- |
| **.cursor/agents/*.md** | Prompt templates for workers (and any lead-capable agents). One file per agent type. |
| **docs/leads/*.md** | Documentation of **orchestration patterns** (how a lead is invoked, which workers it uses, flow). |
| **docs/leads/README.md** | Lead registry and index. |

Agent files define *who* does the work; lead docs explain *how* orchestration runs for each pattern. See [docs/leads/README.md](leads/README.md) and [.cursor/agents/README.md](../.cursor/agents/README.md).
