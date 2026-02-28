---
name: Orchestration UI and Batch Dispatch
overview: Enforce Cursor's task orchestration panel and parallel sub-agent behavior by adding the TodoWrite protocol and requiring multiple Task/mcp_task calls in one message when dispatching batches.
fileTree: |
  .cursor/
  ├── rules/
  │   ├── subagent-dispatch.mdc         (modify)
  │   └── taskgraph-workflow.mdc         (modify)
  ├── skills/
  │   └── work/SKILL.md                  (modify)
  ├── agents/
  │   └── README.md                      (modify)
  └── memory.md                          (modify)
  AGENT.md                               (modify)
  docs/
  ├── agent-contract.md                  (modify)
  └── skills/
      ├── subagent-dispatch.md           (modify)
      └── taskgraph-lifecycle-execution.md (modify)
  src/template/
  ├── AGENT.md                           (modify)
  ├── .cursor/rules/
  │   ├── subagent-dispatch.mdc          (modify)
  │   └── taskgraph-workflow.mdc         (modify)
  └── docs/skills/
      ├── subagent-dispatch.md           (modify)
      └── taskgraph-lifecycle-execution.md (modify)
risks:
  - description: TodoWrite has a minimum of 2 items; single-task batches need padding
    severity: low
    mitigation: When only 1 tg task, add a second TodoWrite item (e.g. "Review & gate checks")
  - description: Cursor may change TodoWrite or Task batching behavior in future
    severity: low
    mitigation: Document intent in rules; adapt if Cursor docs change
  - description: Over-specifying exact tool call shape may make rules brittle
    severity: medium
    mitigation: Describe pattern and intent; one short example each for TodoWrite and batch dispatch
tests:
  - "Subagent-dispatch Pattern 1 includes TodoWrite step and same-message batch dispatch wording"
  - "Work skill loop calls TodoWrite before first dispatch and documents batch-in-one-turn"
  - "Template subagent-dispatch.mdc matches repo for orchestration and batch sections"
todos:
  - id: rewrite-dispatch-orchestration
    content: "Rewrite subagent-dispatch.mdc with TodoWrite protocol and batch-in-one-turn"
    agent: implementer
    intent: |
      Replace the current "Task orchestration UI" section with a mandatory protocol that (a) requires TodoWrite before any sub-agent dispatch for tg tasks, and (b) requires that when dispatching a batch of N runnable tasks, the orchestrator emits N Task (or mcp_task) invocations in the same message/turn — not one call per turn. Cursor docs state "Agent sends multiple Task tool calls in a single message, so subagents run simultaneously"; one call per turn may not trigger the orchestration panel or parallel execution.
      In Pattern 1: add step 0 (TodoWrite with full task list); in step 5, state explicitly that all batch dispatches must be issued in the same response (one Task/mcp_task call per task in the batch). In Pattern 2, add step 0 (TodoWrite) for consistency. Reuse TodoWrite protocol text from plans/26-02-28_enforce_orchestration_ui.md (get tasks, TodoWrite merge=false with ids/status, dispatch, TodoWrite merge=true on complete/fail). Single-task batch: TodoWrite still required; use 2 items (task + e.g. "Review & gate") if Cursor expects min 2.
    suggestedChanges: |
      ## Task orchestration UI — TodoWrite protocol (MANDATORY)
      Before dispatching ANY sub-agents for tg tasks, you MUST call TodoWrite to register the task list. This triggers Cursor's orchestration panel.
      Protocol: (1) Get tasks: tg next --json --limit 20. (2) TodoWrite merge=false: each task → {id, content: title, status: "in_progress"|"pending"}. (3) Dispatch: when dispatching a batch of N tasks, emit N Task (or mcp_task) calls in the SAME message/turn — do not dispatch one task per turn. (4) As each completes → TodoWrite merge=true to "completed" or "cancelled".
      Pattern 1 step 0: TodoWrite with the batch (see above). Pattern 1 step 5: "In the same response, issue one Task (or mcp_task) call per task in the batch so Cursor runs them in parallel and surfaces the orchestration UI."
    changeType: modify
    skill: [subagent-dispatch]

  - id: update-work-skill
    content: "Update work skill to TodoWrite at batch boundary and batch-in-one-turn"
    agent: implementer
    intent: |
      Update .cursor/skills/work/SKILL.md so "Before each batch" requires calling TodoWrite with the task list (from tg next) before dispatching, and so the Loop states that all Task/mcp_task calls for the current batch must be emitted in the same turn. Add TodoWrite merge=true after each completion in the loop description. Replace "Enumerate the task list explicitly" with "Call TodoWrite with the task list (see subagent-dispatch.mdc TodoWrite protocol)". Note that TodoWrite IS the progress report for the orchestration panel.
    changeType: modify

  - id: sync-template-dispatch
    content: "Sync src/template/.cursor/rules/subagent-dispatch.mdc with repo"
    agent: implementer
    blockedBy: [rewrite-dispatch-orchestration]
    intent: |
      After rewrite-dispatch-orchestration is done, copy the updated orchestration section and Pattern 1/2 step changes from .cursor/rules/subagent-dispatch.mdc to src/template/.cursor/rules/subagent-dispatch.mdc so template and repo stay in sync.
    changeType: modify

  - id: update-agent-md
    content: "Update AGENT.md (root and template) with TodoWrite and batch-in-one-turn"
    agent: implementer
    blockedBy: [rewrite-dispatch-orchestration]
    intent: |
      In AGENT.md and src/template/AGENT.md, replace the current "Task orchestration UI" paragraph with a requirement to call TodoWrite with the task list from tg next before dispatching, update statuses as tasks complete, and to emit multiple Task/mcp_task calls in the same turn when dispatching a batch. Keep concise; full protocol lives in subagent-dispatch.mdc.
    changeType: modify

  - id: update-workflow-rule
    content: "Update taskgraph-workflow.mdc (repo and template) with TodoWrite and batch reference"
    agent: implementer
    blockedBy: [rewrite-dispatch-orchestration]
    intent: |
      In both .cursor/rules/taskgraph-workflow.mdc and src/template/.cursor/rules/taskgraph-workflow.mdc, replace the one-liner about the orchestration panel with a short reference to the TodoWrite protocol and same-message batch dispatch; point to subagent-dispatch.mdc for the full protocol.
    changeType: modify

  - id: update-docs-and-readme
    content: "Update agent-contract, skill docs, agents README and template copies"
    agent: implementer
    blockedBy: [rewrite-dispatch-orchestration]
    intent: |
      Update docs/agent-contract.md, docs/skills/subagent-dispatch.md, docs/skills/taskgraph-lifecycle-execution.md, .cursor/agents/README.md, and template copies (src/template/docs/skills/subagent-dispatch.md, taskgraph-lifecycle-execution.md) so any mention of the orchestration UI or execution loop references the TodoWrite protocol and batch-in-one-turn (same-message dispatch). Purpose and contract text only; no duplicate of full protocol.
    changeType: modify

  - id: update-memory
    content: "Update memory.md orchestration entry with TodoWrite and batch-in-one-turn"
    agent: implementer
    blockedBy: [rewrite-dispatch-orchestration]
    intent: |
      In .cursor/memory.md, update the "Task orchestration UI" and "Cursor parallel subagents" entries to state that both are required: (1) call TodoWrite with the task list before dispatching and update via TodoWrite(merge=true) as tasks complete; (2) when dispatching a batch, emit N Task/mcp_task calls in the same turn. Keep under 300 lines total.
    changeType: modify
isProject: false
---

## Analysis

Research showed two mechanisms that affect whether Cursor shows the "Task orchestration for autonomous execution" panel and runs sub-agents in parallel:

1. **TodoWrite** — Cursor renders the orchestration panel when the agent calls TodoWrite with a structured task list. Our current rules say "enumerate the task list" but do not require calling the TodoWrite tool; that gap makes the panel inconsistent. Plan 26-02-28_enforce_orchestration_ui.md specified the TodoWrite protocol but was never imported.

2. **Multiple Task calls in one message** — Cursor docs state: "Agent sends multiple Task tool calls in a single message, so subagents run simultaneously." Dispatching one Task or one mcp_task per turn may not trigger parallel execution or the panel. We need an explicit requirement: when dispatching a batch of N runnable tg tasks, emit N invocations in the same turn.

This plan merges both into one deliverable: TodoWrite protocol across rules, work skill, AGENT.md, and docs; plus batch-in-one-turn wording in subagent-dispatch and the work skill. No schema or Dolt changes; all edits are rules, skills, templates, and docs. Template copies must stay in sync with repo.

## Dependency graph

```
Parallel start (2 unblocked):
  ├── rewrite-dispatch-orchestration   (TodoWrite + batch-in-one-turn in subagent-dispatch.mdc)
  └── update-work-skill                (TodoWrite + batch-in-one-turn in work/SKILL.md)

After rewrite-dispatch-orchestration:
  ├── sync-template-dispatch           (copy repo rule to src/template)
  ├── update-agent-md                  (AGENT.md root + template)
  ├── update-workflow-rule             (taskgraph-workflow.mdc repo + template)
  ├── update-docs-and-readme          (agent-contract, skill docs, agents README + template)
  └── update-memory                    (memory.md)
```

## Proposed changes

- **subagent-dispatch.mdc**: New "Task orchestration UI — TodoWrite protocol (MANDATORY)" section with get-tasks → TodoWrite(merge=false) → dispatch (N calls in same message) → TodoWrite(merge=true) on complete/fail. Pattern 1 step 0 = TodoWrite; step 5 = "in the same response, issue one Task/mcp_task call per task in the batch". Pattern 2 step 0 = TodoWrite. Single-task batch: still call TodoWrite; if Cursor expects ≥2 items, add a second item (e.g. "Review & gate").
- **work/SKILL.md**: "Before each batch" → call TodoWrite with task list; loop text → "emit all Task/mcp_task calls for the batch in the same turn"; add TodoWrite merge=true after completions.
- **AGENT.md / taskgraph-workflow.mdc / docs**: Short references to TodoWrite protocol and same-message batch; link to subagent-dispatch.mdc for full protocol.
- **memory.md**: Orchestration entry = TodoWrite + batch-in-one-turn required.

## Open questions

- None; Cursor docs and prior plan 26-02-28 provide enough to specify the protocol and batch requirement.

<original_prompt>
make a plan for fixing this /plan

(Context: fix sub-agent orchestration so Cursor's task orchestration panel triggers reliably — TodoWrite protocol + multiple Task/mcp_task calls in one message when dispatching batches.)
</original_prompt>
