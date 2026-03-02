---
name: Sub-Agent Task Batching
overview: Add optional task batching so one implementer or documenter can run 2-3 small, atomic tasks in one session (sequential start to work to done per task), reducing orchestration overhead while keeping worktrees and per-task evidence unchanged.
fileTree: |
  .cursor/
  ├── rules/
  │   ├── subagent-dispatch.mdc    (modify)
  │   └── plan-authoring.mdc       (modify)
  ├── skills/
  │   └── work/
  │       └── SKILL.md             (modify)
  └── agents/
  ├── implementer.md              (modify)
  ├── documenter.md               (modify)
  └── README.md                   (modify)
  docs/
  ├── leads/
  │   └── execution.md            (modify)
  └── plan-format.md              (modify)
risks:
  - description: Per-task diff for review after a batch may be unclear if merge commits are not one-per-task
    severity: low
    mitigation: Keep one worktree and one merge per task; orchestrator gets diff per task from that task's merge commit on plan branch
  - description: Batching logic could group tasks that share files or have hidden dependencies
    severity: low
    mitigation: Reuse existing file-overlap check; only batch tasks from tg next runnable set (no blockedBy between them)
tests:
  - "With batching enabled, Hivemind Wave 1 documenter tasks (plan-skill-follow-up-options, hive-context-alignment) complete as one documenter run with evidence per task"
todos:
  - id: document-batching-policy
    content: Document task batching policy in execution lead and dispatch rule
    agent: documenter
    changeType: modify
    docs: [agent-contract, plan-format]
    intent: |
      Add an optional "Task batching" section to docs/leads/execution.md and/or
      .cursor/rules/subagent-dispatch.mdc. Describe when the lead may assign 2-3
      tasks to one implementer or documenter: risk=low, estimate_mins small (e.g.
      <= 15 per task), change_type in [modify, fix, test, document]; same agent
      type; no file overlap. Describe how to build the multi-task prompt (N task
      IDs + N context blocks) and that the agent runs start to work to done per
      task in order; worktree remains one per task. Reference task size signals
      from tg next (risk, estimate_mins) and tg context (change_type,
      token_estimate).
    suggestedChanges: |
      execution.md: new subsection "Task batching" under Pattern. subagent-dispatch.mdc:
      new optional section after "Pattern 1" or in "Building prompts" describing
      batching policy and multi-task prompt shape.

  - id: implementer-batch-template
    content: Add implementer template variant for N tasks in one session
    agent: implementer
    changeType: modify
    docs: [agent-contract]
    intent: |
      In .cursor/agents/implementer.md add a batch variant: when the orchestrator
      passes {{TASK_IDS}} (ordered list) and {{CONTEXT_BLOCKS}} (one block per
      task with title, intent, suggested changes, etc.), the implementer runs
      for each task in order: tg start <id> --worktree, cd to worktree, do work,
      tg done <id> --merge; do not mix scope between tasks. One worktree per
      task. Can be a new section "Batch mode (N tasks)" or conditional
      instructions at top of template. Keep single-task as default when
      {{TASK_ID}} is present.
    suggestedChanges: |
      implementer.md: add "Batch mode" section with placeholders {{TASK_IDS}},
      {{CONTEXT_BLOCKS}} and step loop "for each task: start, cd, load context
      for that task, work, done --merge".

  - id: documenter-batch-template
    content: Add documenter template variant for N tasks in one session
    agent: documenter
    changeType: modify
    docs: [agent-contract]
    intent: |
      In .cursor/agents/documenter.md add the same batch variant as implementer:
      {{TASK_IDS}} and {{CONTEXT_BLOCKS}}; for each task in order run tg start,
      do doc work, tg done with evidence; no worktree (documenter runs from repo
      root). Do not mix scope between tasks.
    suggestedChanges: |
      documenter.md: add "Batch mode" section with {{TASK_IDS}}, {{CONTEXT_BLOCKS}}
      and sequential start/work/done per task from repo root.

  - id: orchestrator-batching-logic
    content: Add batching logic to work skill and dispatch rule before dispatch
    agent: implementer
    changeType: modify
    blockedBy:
      [
        document-batching-policy,
        implementer-batch-template,
        documenter-batch-template,
      ]
    docs: [plan-format, agent-contract]
    intent: |
      In .cursor/skills/work/SKILL.md and .cursor/rules/subagent-dispatch.mdc,
      after getting runnable tasks and applying file-conflict filter, add an
      optional grouping step: (a) optionally fetch tg context for each runnable
      task; (b) group by agent type and by size (small = risk=low, estimate_mins
      <= 15 or null, change_type in [modify, fix, test, document]); (c) for
      groups of 2-3 same-agent tasks with no file overlap, build one multi-task
      prompt and dispatch one implementer or documenter for that group; (d)
      for the rest, keep 1:1. TodoWrite stays one todo per task; when a batch
      returns, mark all tasks in that batch completed. Review remains per-task
      (orchestrator gets diff per task from each task's merge commit).
    suggestedChanges: |
      work/SKILL.md: in loop, after "build batch" add "optionally group into
      batches of 2-3 using policy"; then build prompt per dispatch unit (single
      or batch). subagent-dispatch.mdc: in Pattern 1, add step 2b "Optional
      batching" with same policy and prompt-building note.

  - id: plan-authoring-batching-note
    content: Note in plan-authoring and plan-format that batchable tasks should be atomic and same-agent
    agent: documenter
    changeType: modify
    intent: |
      In .cursor/rules/plan-authoring.mdc and/or docs/plan-format.md add a short
      note: tasks intended for batching should be atomic, same agent type, and
      avoid blocking each other within the batch. No structural change to plan
      format; authoring guidance only.
    suggestedChanges: |
      plan-authoring.mdc: under "Dependency and scope" or "Parallel-ready", add
      bullet on batchable tasks. plan-format.md: optional one-line in Todo
      fields or in body.

  - id: validate-batching-hivemind
    content: Validate batching on Hivemind Wave 1 documenter tasks
    agent: implementer
    changeType: test
    blockedBy: [orchestrator-batching-logic]
    intent: |
      With batching enabled, run Hivemind plan (import if needed from
      plans/26-03-02_hivemind_initiative.md). In Wave 1, assign one documenter
      to the two doc-only tasks plan-skill-follow-up-options and
      hive-context-alignment (same agent, no file overlap). Confirm both tasks
      done with evidence and notes per task; compare overhead vs two separate
      documenter runs. Record outcome in task evidence or a short note.
    suggestedChanges: |
      Run tg next --plan "Hivemind Initiative" to get runnable tasks; trigger
      work loop with batching; verify one documenter run completes both tasks
      and tg status shows both done.

  - id: run-full-suite-batching
    content: Run full test suite after batching changes and record result
    agent: implementer
    changeType: test
    blockedBy: [validate-batching-hivemind]
    intent: |
      Run pnpm gate:full (or scripts/cheap-gate.sh --full) and record result in
      evidence. Ensures doc, rule, and template changes do not break existing
      tests or typecheck.
    suggestedChanges: |
      Standard run-full-suite task; evidence "gate:full passed" or "gate:full
      failed: <summary>".
isProject: false
---

# Sub-Agent Task Batching — Plan

## Analysis

The review report (reports/review-26-03-02-subagent-batching.md) concluded that reusing one agent for 2–3 atomic, file-edit-heavy tasks in one session is feasible: the implementer runs `tg start` → work → `tg done --merge` per task in order; each task keeps its own worktree and merge. Task size signals (risk, estimate_mins from `tg next`; change_type, token_estimate from `tg context`) already exist. This plan adds optional batching as a policy and implementation in the execution lead and work skill, plus template variants for implementer and documenter, and validates on Hivemind Wave 1.

## Dependency graph

```
Parallel start (3 unblocked):
  ├── document-batching-policy
  ├── implementer-batch-template
  └── documenter-batch-template

Parallel (after above):
  └── plan-authoring-batching-note

After document-batching-policy, implementer-batch-template, documenter-batch-template:
  └── orchestrator-batching-logic

After orchestrator-batching-logic:
  └── validate-batching-hivemind

After validate-batching-hivemind:
  └── run-full-suite-batching
```

## Proposed changes

- **document-batching-policy:** New "Task batching" section in execution.md and/or subagent-dispatch.mdc: when to batch (risk=low, small estimate, change_type), how to build multi-task prompt, one worktree per task.
- **implementer-batch-template:** Batch mode in implementer.md: {{TASK_IDS}}, {{CONTEXT_BLOCKS}}, loop start→work→done per task.
- **documenter-batch-template:** Same in documenter.md for doc-only tasks (no worktree).
- **orchestrator-batching-logic:** Work skill and dispatch rule: group runnable tasks by agent and size, build 2–3 task batches when policy allows, dispatch one agent per batch; TodoWrite and review stay per-task.
- **plan-authoring-batching-note:** Short note in plan-authoring and plan-format: batchable tasks = atomic, same-agent, no mutual block.
- **validate-batching-hivemind:** One documenter for two Hivemind Wave 1 doc tasks; confirm both done and evidence per task.
- **run-full-suite-batching:** gate:full; record result in evidence.

## Open questions

- Whether to cap batch size at 2 vs 3 in the first iteration (report suggested 2–3; start with 2 to reduce risk).
- Whether to fetch `tg context` for every runnable task before grouping (adds latency) or only when forming batches (lazy).

## Original prompt

<original_prompt>
/plan based on reports/review-26-03-02-subagent-batching.md
</original_prompt>
