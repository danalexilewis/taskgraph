---
name: Enforce Task Orchestration UI for Sub-Agent Dispatch
overview: |
  Upgrade rules, skills, and agent templates so the orchestrator **always** triggers
  Cursor's "Task orchestration for autonomous execution" panel when dispatching
  sub-agents for tg tasks. The mechanism: call TodoWrite with the full task list
  before dispatching, update statuses via TodoWrite as tasks complete. This replaces
  the current soft guidance ("enumerate the task list") with a hard structural
  requirement that reliably surfaces the orchestration UI.
fileTree: |
  .cursor/
  ├── rules/
  │   ├── subagent-dispatch.mdc         (modify)
  │   └── taskgraph-workflow.mdc        (modify)
  ├── skills/
  │   └── work/SKILL.md                 (modify)
  ├── agents/
  │   └── README.md                     (modify)
  └── memory.md                         (modify)
  AGENT.md                              (modify)
  docs/
  ├── agent-contract.md                 (modify)
  └── skills/
      ├── subagent-dispatch.md          (modify)
      └── taskgraph-lifecycle-execution.md (modify)
  src/template/
  ├── AGENT.md                          (modify)
  ├── .cursor/rules/
  │   ├── subagent-dispatch.mdc         (modify)
  │   └── taskgraph-workflow.mdc        (modify)
  └── docs/skills/
      ├── subagent-dispatch.md          (modify)
      └── taskgraph-lifecycle-execution.md (modify)
risks:
  - description: TodoWrite has a minimum of 2 items; single-task batches need padding or a wrapper
    severity: low
    mitigation: When only 1 tg task, include a "Review & gate" todo as the second item
  - description: Cursor may change TodoWrite behavior in future versions
    severity: low
    mitigation: The pattern is standard Cursor API; if it changes we update the rules
  - description: Over-specifying the exact tool call format may make rules brittle
    severity: medium
    mitigation: Describe the pattern and intent, not the exact JSON; provide an example but allow flexibility
tests:
  - "Verify that the work skill loop calls TodoWrite before first dispatch"
  - "Verify that subagent-dispatch Pattern 1 includes TodoWrite step"
  - "Verify that template files match repo-root files for orchestration sections"
todos:
  - id: rewrite-dispatch-orchestration
    content: "Rewrite subagent-dispatch.mdc orchestration section with TodoWrite protocol"
    agent: implementer
    intent: |
      Replace the current soft "Task orchestration UI" section in subagent-dispatch.mdc
      with a hard protocol that requires calling TodoWrite before dispatching.

      The new section should:
      1. REQUIRE the orchestrator to call TodoWrite with all runnable tasks mapped from
         `tg next` output BEFORE dispatching any Task tool calls.
      2. Each todo item: id = task external_key or taskId, content = task title,
         status = "in_progress" for the current batch / "pending" for later tasks.
      3. After each sub-agent completes: call TodoWrite with merge=true to update
         that item to "completed" (or "cancelled" on failure).
      4. Provide a concrete example showing the TodoWrite call shape.
      5. Explain WHY: this is what triggers Cursor's orchestration panel.

      Also update Pattern 1 (parallel) and Pattern 2 (sequential) to reference
      the TodoWrite step as step 0 before dispatch.
    suggestedChanges: |
      In `.cursor/rules/subagent-dispatch.mdc`, replace the current
      "## Task orchestration UI" section with:

      ## Task orchestration UI — TodoWrite protocol (MANDATORY)

      Before dispatching ANY sub-agents for tg tasks, you MUST call TodoWrite
      to register the task list. This triggers Cursor's orchestration panel.

      **Protocol:**
      1. Get tasks: `tg next --json --limit 20`
      2. Call TodoWrite with merge=false:
         - Each task → {id: taskId, content: title, status: "in_progress"} for current batch
         - Remaining tasks → {id: taskId, content: title, status: "pending"}
      3. Dispatch sub-agents via Task tool
      4. As each completes → TodoWrite merge=true to update status to "completed"
      5. On failure → TodoWrite merge=true to update status to "cancelled"

      Then in Pattern 1 step list, insert as step 0:
      "0. **TodoWrite**: Call TodoWrite with the batch (see orchestration protocol above)."
    changeType: modify
    skill: [subagent-dispatch]

  - id: update-work-skill-todowrite
    content: "Update work skill loop to use TodoWrite at each batch boundary"
    agent: implementer
    intent: |
      Update `.cursor/skills/work/SKILL.md` to replace the current soft
      "Task orchestration UI" section with explicit TodoWrite calls.

      Changes:
      1. In "Before each batch" — replace "enumerate the task list explicitly"
         with "call TodoWrite with the task list" and show the pattern.
      2. In the Loop pseudocode — add a TodoWrite call between step 1 (get tasks)
         and step 3 (batch selection). After step 6 (sub-agent results), add
         TodoWrite merge=true calls to update statuses.
      3. In Progress Reporting — note that TodoWrite IS the progress report;
         the orchestration panel shows it live.
    changeType: modify

  - id: update-agent-md-todowrite
    content: "Update AGENT.md and template AGENT.md with TodoWrite requirement"
    agent: implementer
    intent: |
      In both `AGENT.md` (repo root) and `src/template/AGENT.md`:

      Replace the current "Task orchestration UI" paragraph with a stronger version
      that says: "You MUST call TodoWrite with the task list from tg next before
      dispatching sub-agents. This triggers Cursor's orchestration panel. Update
      TodoWrite statuses as tasks complete."

      Keep it concise (3-4 sentences) since AGENT.md is the summary; the full
      protocol lives in subagent-dispatch.mdc.
    changeType: modify
    blockedBy: [rewrite-dispatch-orchestration]

  - id: update-workflow-rule
    content: "Update taskgraph-workflow.mdc (both repo and template) with TodoWrite reference"
    agent: implementer
    intent: |
      In `.cursor/rules/taskgraph-workflow.mdc` and
      `src/template/.cursor/rules/taskgraph-workflow.mdc`:

      Replace the current one-liner about the orchestration panel with:
      "**TodoWrite protocol**: Before dispatching sub-agents, call TodoWrite with
      the task list from tg next. Update statuses as tasks complete. See
      subagent-dispatch.mdc for the full protocol."
    changeType: modify

  - id: update-docs-and-readme
    content: "Update docs (agent-contract, skill docs, agents README) with TodoWrite protocol"
    agent: implementer
    intent: |
      Update these files to reference the TodoWrite protocol:

      1. `docs/agent-contract.md` — replace the orchestration UI paragraph with
         the TodoWrite requirement.
      2. `docs/skills/subagent-dispatch.md` — add TodoWrite mention in Purpose.
      3. `docs/skills/taskgraph-lifecycle-execution.md` — update the orchestration
         line to reference TodoWrite.
      4. `.cursor/agents/README.md` — in "How dispatch works", add that the
         orchestrator calls TodoWrite before dispatching.
      5. Template equivalents: `src/template/docs/skills/subagent-dispatch.md`,
         `src/template/docs/skills/taskgraph-lifecycle-execution.md`.
    changeType: modify
    blockedBy: [rewrite-dispatch-orchestration]

  - id: update-memory
    content: "Update memory.md with TodoWrite orchestration pattern"
    agent: implementer
    intent: |
      In `.cursor/memory.md`, update the "Task orchestration UI" entry to say:
      "Always call TodoWrite with the task list from tg next before dispatching
      sub-agents. This triggers Cursor's orchestration panel. Update statuses
      via TodoWrite(merge=true) as tasks complete."
    changeType: modify
    blockedBy: [rewrite-dispatch-orchestration]
---

## The core insight

The orchestration panel is driven by the **TodoWrite tool**, not just text output. When the agent calls TodoWrite with a structured task list before dispatching sub-agents, Cursor renders the "Task orchestration for autonomous execution" panel with checkmarks and progress tracking. Our current rules say "enumerate the task list" but don't say "call TodoWrite" — that's why it's inconsistent.

## What changes

Replace all soft "enumerate the task list" guidance with a **hard TodoWrite protocol**:

1. **Before dispatching** any sub-agents: map `tg next` output to TodoWrite items and call it.
2. **During execution**: call `TodoWrite(merge=true)` to update each item to `completed` as sub-agents finish.
3. **On failure**: update to `cancelled`.

This is the structural enforcement — the orchestrator must call TodoWrite, which always triggers the panel.

## Tasks (6 total, 2 unblocked to start)

| Task                           | Summary                                                                         | Blocked by                     |
| ------------------------------ | ------------------------------------------------------------------------------- | ------------------------------ |
| rewrite-dispatch-orchestration | Rewrite subagent-dispatch.mdc with TodoWrite protocol                           | —                              |
| update-work-skill-todowrite    | Update work skill loop to use TodoWrite at each batch boundary                  | —                              |
| update-agent-md-todowrite      | Update AGENT.md (both repo and template) with TodoWrite requirement             | rewrite-dispatch-orchestration |
| update-workflow-rule           | Update taskgraph-workflow.mdc (both repo and template) with TodoWrite reference | —                              |
| update-docs-and-readme         | Update docs (agent-contract, skill docs, agents README) with TodoWrite protocol | rewrite-dispatch-orchestration |
| update-memory                  | Update memory.md with TodoWrite orchestration pattern                           | rewrite-dispatch-orchestration |

## Dependency graph

```
Parallel start (2 unblocked):
  ├── rewrite-dispatch-orchestration (core protocol)
  └── update-work-skill-todowrite

After rewrite-dispatch-orchestration:
  ├── update-agent-md-todowrite
  ├── update-workflow-rule
  ├── update-docs-and-readme
  └── update-memory
```

## Key risk

TodoWrite requires a minimum of 2 items. For single-task batches, the protocol includes a companion item (e.g. "Review & gate checks") as the second entry.

<original_prompt>
can we update the rules to try to enforce the triggering of cursors multi agent orchestration mode when using sub-agents? I really want it on whenever we are using tasks to generate agents regardless of what the defaults base context says. We want to enforce this somehow.

make a plan to upgrade this part of the system
</original_prompt>
