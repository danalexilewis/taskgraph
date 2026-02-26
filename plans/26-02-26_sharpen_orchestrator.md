---
name: Sharpen Orchestrator Compliance
overview: >
  Fix contradictions and gaps in orchestrator rules so it reliably dispatches sub-agents,
  uses the planner-analyst, and produces parallel-friendly plans. Five independent edits
  plus a template sync.
fileTree: |
  .cursor/rules/taskgraph-workflow.mdc    (modify)
  .cursor/rules/session-start.mdc         (modify)
  .cursor/rules/subagent-dispatch.mdc     (modify)
  .cursor/rules/plan-authoring.mdc        (modify)
  AGENT.md                                (modify)
  src/template/.cursor/rules/taskgraph-workflow.mdc  (modify)
  src/template/.cursor/rules/session-start.mdc       (modify)
  src/template/.cursor/rules/subagent-dispatch.mdc   (modify)
  src/template/.cursor/rules/plan-authoring.mdc      (modify)
  src/template/AGENT.md                              (modify)
risks:
  - description: Rules become too long or redundant across files
    severity: medium
    mitigation: Keep each file focused; cross-reference rather than duplicate
  - description: Template and repo copies drift
    severity: low
    mitigation: sync-template task explicitly checks parity
tests:
  - "Create a plan with 5 tasks, verify tg next --limit 3 returns 3 unblocked tasks (manual or integration test)"
  - "Read taskgraph-workflow.mdc and confirm dispatch is described as the primary execution path"
  - "Read AGENT.md and confirm pre-response compliance checklist exists"
todos:
  - id: fix-workflow-dispatch-primary
    content: "Rewrite taskgraph-workflow.mdc execution loop: dispatch is primary, direct is fallback"
    intent: |
      The execution loop (lines 31-44) currently describes direct execution (you start, you work,
      you done) as the primary path, with sub-agent dispatch as an optional subsection below.
      This contradicts AGENT.md which says dispatch is MANDATORY.

      Rewrite the section so:
      - The primary execution loop says: "Dispatch implementer sub-agents per subagent-dispatch.mdc.
        Do not do the work yourself." Then reference the dispatch patterns.
      - Move the direct execution steps (start → work → done) into a "Fallback: direct execution"
        subsection, qualified with "only after 2 sub-agent failures or explicitly exploratory work."
      - Remove the words "optional" from the sub-agent section heading.
      - Keep the "Multi-task discipline" and "Plan completion" subsections as-is.
    suggestedChanges: |
      Replace lines 31-44 with:

      ## Execution Loop — MANDATORY sub-agent dispatch

      Task execution uses sub-agents. Follow `.cursor/rules/subagent-dispatch.mdc` Pattern 1 (parallel)
      or Pattern 2 (sequential). The orchestrator coordinates; sub-agents do the work.

      1. `pnpm tg next --plan "<Plan>" --json --limit 3` — get runnable tasks
      2. For each task: build implementer prompt from `tg context` and `.cursor/agents/implementer.md`;
         dispatch via Task tool, agent CLI, or mcp_task.
      3. After implementer completes: dispatch reviewer with task context + diff.
      4. If reviewer FAILs, re-dispatch implementer once. After 2 failures, fall back to direct execution.

      ### Fallback: direct execution

      Use only when: a sub-agent has failed twice on the same task, or the task is explicitly
      exploratory/ambiguous. In this case follow the direct steps:
      1. `tg start <taskId> --agent <name>`
      2. `tg context <taskId>` — read and load docs
      3. Do the work
      4. `tg done <taskId> --evidence "..."`
      5. Log the reason: `tg note <taskId> --msg "Direct execution: <reason>"`
    domain: []
    skill: []
    changeType: modify

  - id: add-compliance-checklist
    content: "Add pre-response compliance checklist to AGENT.md"
    intent: |
      Model the pattern from memory.mdc's "Before you consider your response complete" hook.
      Add a similar section to AGENT.md that the orchestrator must check before completing
      any response where it did planning or execution work:

      ## Before completing your response (compliance check)

      If you did planning or execution work in this response, verify:
      - If user asked for a plan: Did I dispatch the planner-analyst first? (If no: stop, dispatch it now.)
      - If I executed tasks: Did I dispatch implementer sub-agents? (If no and no valid reason: stop, dispatch.)
      - If I did any task directly: Is the reason valid? (2 sub-agent failures, or explicitly exploratory.)
        If direct execution was used, did I log it with `tg note`?
      - If I produced a plan: Does it have at least 2 tasks with no blockedBy (parallel-ready)?

      This is a self-check, not a separate agent. Place it after the "Per-task discipline" section
      and before "Recovery."
    suggestedChanges: |
      Add after "Per-task discipline" section in AGENT.md:

      Before completing your response (compliance check)

      If this response involved planning or execution, verify before responding:
      - Planning: Did I dispatch the planner-analyst before writing the plan?
      - Execution: Did I dispatch implementer sub-agents (not code myself)?
      - Direct execution: Is the reason valid (2 failures or exploratory)? Did I log with tg note?
      - Plan structure: Does the plan have ≥2 unblocked tasks (parallel-ready)?
      If any check fails, fix it before completing your response.
    domain: []
    skill: []
    changeType: modify

  - id: add-decision-audit
    content: "Require tg note for direct execution decisions"
    intent: |
      When the orchestrator does a task directly (instead of dispatching), it must log why with:
        `tg note <taskId> --msg "Direct execution: <reason>"`

      Add this requirement to:
      - AGENT.md in the operating loop (near "Direct execution only after...")
      - subagent-dispatch.mdc in the "direct execution" paragraph
      - The compliance checklist (task add-compliance-checklist covers this)

      This creates an audit trail in the task graph so drift is visible in `tg status` / event history.
    suggestedChanges: |
      In AGENT.md, after "Direct execution (you code) only after a sub-agent fails twice...":
        append: "When using direct execution, log the reason: `tg note <taskId> --msg 'Direct execution: <reason>'`."

      In subagent-dispatch.mdc, in the "Use direct execution..." paragraph:
        append: "Always log direct execution with `tg note <taskId> --msg 'Direct execution: <reason>'`."
    domain: []
    skill: []
    changeType: modify

  - id: prime-session-start
    content: "Add key behavioral constraints to session-start.mdc"
    intent: |
      session-start.mdc is alwaysApply: true and runs first. Currently it only says "run tg status."
      Add 3-4 bullet reminders of critical constraints so they're front-of-mind before the agent
      loads any other rules:

      **Key constraints (see AGENT.md for details):**
      - Sub-agent dispatch is **mandatory** for task execution — do not do the work yourself.
      - Planner-analyst dispatch is **mandatory** before writing any plan.
      - Max **3** tasks in flight at a time.
      - Plans must have parallel-ready tasks (≥2 with no blockedBy).

      Place after the "This surfaces:" list and before the multi-agent section.
    domain: []
    skill: []
    changeType: modify

  - id: enforce-parallel-plans
    content: "Add parallel-task requirement to plan-authoring.mdc"
    intent: |
      The critique checklist in subagent-dispatch.mdc says "minimize serial dependencies" but
      plan-authoring.mdc (which is the rule that fires when writing plans/) has no such guidance.
      An agent writing a plan may never load the dispatch rule.

      Add to plan-authoring.mdc's "Dependency and scope" section:

      - **Parallel-ready**: Plans MUST have at least 2 tasks with no `blockedBy` (runnable
        immediately). If every task depends on the previous one, the orchestrator can only
        dispatch 1 at a time and parallel execution is impossible. Restructure: split
        independent concerns (e.g. "add docs" and "add tests" don't need to block on each other).
      - For each `blockedBy`, ask: "Can this task work without the upstream?" If yes, remove
        the dependency.

      This mirrors the critique checklist but is placed where the agent will see it when authoring.
    suggestedChanges: |
      In plan-authoring.mdc, in the "Dependency and scope" section (lines 93-99), add after
      "Keep tasks scoped (~90 min or less); split large ones.":

      - **Parallel-ready**: Plans MUST have ≥2 tasks with no `blockedBy` so the orchestrator
        can dispatch in parallel. If all tasks are serial, restructure: docs, tests, and
        independent features rarely need to block on each other. For each `blockedBy`, ask
        "can this task work without the upstream?" — if yes, remove the dependency.
    domain: []
    skill: []
    changeType: modify

  - id: sync-template
    content: "Sync all changes to src/template/ copies"
    intent: |
      After all other tasks are done, copy the changes to the template versions:
      - src/template/.cursor/rules/taskgraph-workflow.mdc
      - src/template/.cursor/rules/session-start.mdc
      - src/template/.cursor/rules/plan-authoring.mdc
      - src/template/.cursor/rules/subagent-dispatch.mdc (direct-execution audit note)
      - src/template/AGENT.md

      Verify parity: diff each repo file against its template counterpart.
      The template AGENT.md may use "Task tool" only (not agent CLI / mcp_task) since consuming
      projects don't need dispatch-mechanism details — that's fine; only sync the compliance
      checklist, direct-execution audit, and structural changes.
    blockedBy:
      - fix-workflow-dispatch-primary
      - add-compliance-checklist
      - add-decision-audit
      - prime-session-start
      - enforce-parallel-plans
    domain: []
    skill: []
    changeType: modify
---

## Analysis

### The contradiction

`taskgraph-workflow.mdc` is `alwaysApply: true` — it loads on every request. Its execution loop (lines 31-44) describes the orchestrator doing start → work → done itself, with sub-agent dispatch as an "(optional)" subsection. `AGENT.md` says dispatch is **MANDATORY** and skipping it is a "critical failure." The always-applied rule wins the agent's attention, so the orchestrator defaults to direct execution.

### The tg next issue

`tg next` code is correct — it queries for all `todo` tasks with 0 unmet blockers, default `--limit 10`. The problem is plan design: when every task has `blockedBy: [previous-task]`, only 1 task is ever runnable. The orchestrator can call `tg next --limit 3` and still get 1 result. Task `enforce-parallel-plans` addresses this by requiring plans to have ≥2 parallel-ready tasks.

### Dependency graph

```mermaid
graph LR
    A[fix-workflow-dispatch-primary] --> F[sync-template]
    B[add-compliance-checklist] --> F
    C[add-decision-audit] --> F
    D[prime-session-start] --> F
    E[enforce-parallel-plans] --> F
```

Tasks A–E are fully independent — all 5 can run in parallel (they touch different files or different sections). Task F (sync-template) depends on all 5.

### Existing enforcement vs gaps

| Mechanism | What it does | Gap |
|---|---|---|
| memory.mdc "update last" | Forces memory write before response complete | No equivalent for dispatch compliance |
| AGENT.md "MANDATORY" language | States dispatch required | No verification hook; orchestrator can ignore |
| Critique checklist | Reviews plan quality | Only in subagent-dispatch.mdc; plan-authoring doesn't enforce parallelism |
| session-start.mdc | Runs tg status | Doesn't remind key constraints |
| taskgraph-workflow.mdc | Describes execution | Contradicts AGENT.md by framing dispatch as optional |

<original_prompt>
Is there anything else we can do to sharpen up the orchestrator? Make a plan. Also check pnpm tg returns a list of tasks that are actionable (not blocked by dependencies).
</original_prompt>
