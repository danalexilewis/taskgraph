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

| Lead            | Skill / trigger | Role                                                                |
| --------------- | --------------- | ------------------------------------------------------------------- |
| Investigator    | `/investigate`  | Run investigation, dispatch investigator worker, produce plan/tasks |
| Planner-analyst | `/plan`         | Gather context, dispatch planner-analyst, produce plan              |
| Execution       | `/work`         | Run task loop, dispatch implementer + reviewer                      |
| Test-review     | `/test-review`  | Audit tests, dispatch test scanners, synthesize findings            |

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

## Communication: Notes as Cross-Dimensional Transmission

Agents operate in two fundamentally different perspectives:

- **Introspective** — A worker (implementer) sees one task. It has intent, files, suggested changes — a self-contained world. Its scope is bounded by the task.
- **Connective** — The orchestrator (or a future worker on a related task) sees many tasks. It cares about patterns, conflicts, repeated failures, and architectural drift across the task network.

**Notes (`tg note`) are the boundary-crossing mechanism between these two perspectives.** When an implementer hits something unexpected — a fragile migration, a conflicting pattern, an assumption that doesn't hold — it writes a note. That note is written introspectively (one agent, one task) but its value is connective (relevant to every task touching the same area).

The `event` table stores notes as task-scoped rows (`kind = 'note'`), but the _meaning_ of a note is inherently cross-task. `tg context` surfaces notes from sibling tasks in the same plan so that the connective dimension can read what the introspective dimension wrote. Without this surfacing, notes are trapped in the task that created them.

**When to write notes:**

- Discovered fragility or unexpected behavior in shared code
- Pattern conflicts between what the task says and what the codebase does
- Environment or tooling issues the implementer couldn't fix
- Warnings for future tasks touching the same files
- Review verdicts (structured JSON for `tg stats`)

See [multi-agent.md](multi-agent.md) for event body conventions and [schema.md](schema.md) for the `event` table structure.

## generalPurpose Default

When the user asks something **without** invoking a skill:

- The orchestrator uses **generalPurpose**: there is no lead.
- The orchestrator either dispatches a worker (e.g. generalPurpose, explorer) or does the work directly, depending on the request.

No skill ⇒ no lead ⇒ generalPurpose path.

## Decision Tree

1. **User invokes a skill** (e.g. `/plan`, `/work`, `/investigate`) → skill runs → skill creates a **lead** → lead **dispatches workers** → lead synthesizes and reports.
2. **User asks without a skill** → **generalPurpose**: orchestrator handles via direct dispatch or direct execution, no lead.

## File Layout

| Location                 | Purpose                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| **.cursor/agents/\*.md** | Prompt templates for workers (and any lead-capable agents). One file per agent type.              |
| **docs/leads/\*.md**     | Documentation of **orchestration patterns** (how a lead is invoked, which workers it uses, flow). |
| **docs/leads/README.md** | Lead registry and index.                                                                          |

Agent files define _who_ does the work; lead docs explain _how_ orchestration runs for each pattern. See [docs/leads/README.md](leads/README.md) and [.cursor/agents/README.md](../.cursor/agents/README.md).
