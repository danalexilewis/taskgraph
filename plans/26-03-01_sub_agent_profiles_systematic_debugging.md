---
name: Sub-Agent Profiles and Systematic Debugging
overview: Add a dedicated debugger sub-agent and systematic-debugging skill (4-phase process), wire it into the agent registry and dispatch, document usage, and optionally add one more sub-agent profile (documenter). No schema or parser changes—task.agent and dispatch already support arbitrary agent templates.
fileTree: |
  .cursor/
  ├── agents/
  │   ├── debugger.md          (create)
  │   └── documenter.md        (create, optional)
  ├── skills/
  │   └── debug/
  │       └── SKILL.md         (create)
  └── rules/
      ├── available-agents.mdc (modify)
      └── subagent-dispatch.mdc (modify)
  docs/
  ├── leads/
  │   ├── debug.md             (create)
  │   └── README.md            (modify)
  └── plan-format.md           (modify)
risks:
  - description: Debugger used for non-debug tasks could over-process simple fixes
    severity: low
    mitigation: "Plan author sets agent per task; implementer remains default"
  - description: 4-phase discipline might be too heavy for trivial one-line fixes
    severity: low
    mitigation: "Skill and lead doc describe when to use (unclear root cause, repro needed); trivial fixes keep agent implementer"
tests:
  - "Import plan with todos[].agent set to debugger, verify tg context --json includes agent and dispatch uses debugger.md"
  - "Optional: manual or automated check that debugger template follows 4-phase structure"
todos:
  - id: debug-skill
    content: Add systematic debugging skill and lead doc
    intent: |
      Create .cursor/skills/debug/SKILL.md that defines when to use systematic debugging (e.g. /debug, or tasks with unclear root cause, failing test with unknown cause). Document the 4-phase process: (1) Root Cause Investigation — read errors, reproduce, check recent changes, trace data flow; no fix until done. (2) Pattern Analysis — find working examples, compare differences. (3) Hypothesis and Testing — one change at a time, verify. (4) Implementation — create failing test first, implement fix, verify. Escalation: after 3 failed fix attempts, stop and report; orchestrator creates investigate task or escalates to human.
      Create docs/leads/debug.md describing the lead pattern and when the skill runs. Add debug to docs/leads/README.md.
    blockedBy: []
    agent: implementer
    changeType: create
  - id: debugger-agent
    content: Add debugger sub-agent template
    intent: |
      Create .cursor/agents/debugger.md following the pattern of implementer.md and fixer.md. Purpose: bounded debugging with no fix until root cause is established. Model: fast (or document when orchestrator may use stronger model for escalation). Input contract: TASK_ID, AGENT_NAME, task context (title, intent, change_type, doc_paths, skill_docs, suggested_changes, file_tree, risks), plus failure summary / error output / repro steps if any. Output contract: tg done with evidence, or escalation note (after 3 failed fix attempts) via tg note with structured format so orchestrator can create investigate task.
      Prompt template must encode the 4 phases explicitly and include MUST NOT DO (no fix before root cause, no multiple changes at once, no 4th fix attempt — stop and report). Include scope exclusion and verification steps. Add a Learnings section (empty initially).
    blockedBy: []
    agent: implementer
    changeType: create
  - id: wire-debugger
    content: Register debugger in agent registry and dispatch
    intent: |
      In .cursor/rules/available-agents.mdc add an entry for "debugger" with one-line description and pointer to docs/leads/debug.md. In .cursor/rules/subagent-dispatch.mdc add one sentence in the dispatch section: for tasks with agent debugger, use .cursor/agents/debugger.md; ensure failure or escalation note from debugger is handled by Follow-up from notes/evidence (orchestrator creates investigate task or escalates). No code changes to CLI or schema.
    blockedBy: [debugger-agent]
    agent: implementer
    changeType: modify
  - id: doc-agent-debugger
    content: Document agent field for debugging in plan format and authoring
    intent: |
      In docs/plan-format.md (per-task fields) add a short example or note that agent: debugger is used for debugging tasks (root-cause investigation, failing tests with unknown cause). In .cursor/rules/plan-authoring.mdc (or plan skill) add a bullet: for fix/debug tasks where root cause is unclear or repro is needed, set agent: debugger so the dispatcher uses the systematic debugging template.
    blockedBy: [wire-debugger]
    agent: implementer
    changeType: modify
  - id: documenter-profile
    content: Add documenter sub-agent profile (optional)
    intent: |
      Create .cursor/agents/documenter.md for tasks that are documentation-only (README, CHANGELOG, docs/). Purpose: sole owner of doc writes when task is explicitly documentation. Input/output contract similar to implementer but with scope limited to markdown/docs; MUST NOT DO: no code changes. Add documenter to .cursor/rules/available-agents.mdc. Plan authors can set agent: documenter for doc-only tasks. Optional: add docs/leads/documenter.md or reference in existing lead doc.
    blockedBy: [wire-debugger]
    agent: implementer
    changeType: create
  - id: add-tests-agent
    content: Add or extend tests for task.agent in import and context
    intent: |
      Ensure import preserves task.agent (Cursor todos[].agent and legacy AGENT:) and tg context --json includes agent. Add or extend an integration test or unit test that imports a plan with at least one task with agent set (e.g. debugger) and asserts the task row has agent set and that tg context output for that task includes the agent field. Prefer __tests__/integration or __tests__/db as appropriate.
    blockedBy: [doc-agent-debugger]
    agent: implementer
    changeType: modify
  - id: run-gate-full
    content: Run full test suite and gate
    intent: |
      Run pnpm gate:full. Record result in evidence (e.g. "gate:full passed" or "gate:full failed: <summary>"). If failed, add tg note with failure reason for orchestrator follow-up.
    blockedBy:
      [
        debug-skill,
        debugger-agent,
        wire-debugger,
        doc-agent-debugger,
        documenter-profile,
        add-tests-agent,
      ]
    agent: implementer
    changeType: modify
---

## Analysis

We want more sub-agent profiles inspired by oh-my-cursor, with the systematic debugging workflow as the main addition. The codebase already supports task-level `agent` end-to-end: plan YAML `todos[].agent` (and legacy `AGENT:`), stored in `task.agent`, exposed by `tg context <taskId> --json`, and used by subagent-dispatch to select `.cursor/agents/{{AGENT}}.md`. No Dolt or parser changes are required.

The **debugger** agent encodes a 4-phase discipline so agents don’t guess at fixes: (1) Root Cause Investigation before any fix, (2) Pattern Analysis (working examples, compare differences), (3) Hypothesis and Testing (one change at a time), (4) Implementation (failing test first, then fix, verify). After 3 failed fix attempts the debugger stops and reports; the orchestrator uses existing “Follow-up from notes/evidence” and “Architectural escalation” to create an investigate task or escalate to human.

The **documenter** profile is a lightweight second profile: documentation-only tasks can use `agent: documenter` so the right template (scope limited to docs, no code) is used without overloading the implementer prompt.

## Dependency graph

```text
Parallel (2 unblocked):
  ├── debug-skill
  └── debugger-agent

After debugger-agent:
  ├── wire-debugger

After wire-debugger:
  ├── doc-agent-debugger
  ├── documenter-profile
  └── (next wave)

After doc-agent-debugger:
  └── add-tests-agent

After add-tests-agent, debug-skill, documenter-profile:
  └── run-gate-full
```

## Out of scope

- Adding `change_type: debug` and auto-routing to debugger when agent is unset (can be done later; `agent: debugger` is sufficient).
- More than one extra profile beyond documenter (explorer-for-task, shell-runner, etc.) — add later using the same pattern.
- Changing implementer or reviewer behavior; they remain the default and for general implementation/review.

## Open questions

- None; analyst confirmed schema and dispatch already support new agents.

<original_prompt>
Create a plan for adding more sub-agent profiles inspired by oh-my-cursor. Priority: a systematic debugging agent/skill with 4 phases — Root Cause Investigation, Pattern Analysis, Hypothesis and Testing, Implementation (create failing test, implement fix, verify). Also like the idea of adding more sub-agent profiles in general.
</original_prompt>
