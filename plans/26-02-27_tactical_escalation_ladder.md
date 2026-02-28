---
name: Tactical Escalation Ladder
overview: >
  Add a structured escalation ladder to the orchestrator (team lead) for handling sub-agent
  non-success outcomes. Three levels: redirect (re-dispatch fast agent with better context),
  delegate (dispatch stronger model), escalate (present distilled summary to human). Integrates
  with the existing Follow-up from notes/evidence protocol.
fileTree: |
  .cursor/
  ├── rules/
  │   └── subagent-dispatch.mdc          (modify — escalation ladder, model parameterization)
  ├── skills/
  │   └── work/SKILL.md                  (modify — escalation in autonomous loop)
  └── agents/
      ├── README.md                      (modify — document fixer agent, escalation model tiers)
      ├── implementer.md                 (modify — structured failure reporting)
      ├── fixer.md                       (create — stronger-model agent for escalated tasks)
      └── reviewer.md                    (modify — escalation-aware failure output)
  docs/
  ├── agent-contract.md                  (modify — escalation protocol)
  └── architecture.md                    (modify — tactical decision model)
  AGENT.md                               (modify — escalation ladder summary)
risks:
  - description: Cursor Task tool model parameter may not support all desired models
    severity: medium
    mitigation: Use the model parameter that is available; document the mapping from conceptual tiers to actual model names
  - description: Orchestrator on lighter model may make poor escalation decisions
    severity: medium
    mitigation: Escalation criteria are rule-based (not reasoning-heavy); decision tree is explicit in the dispatch rule
  - description: Stronger-model dispatch increases cost per task
    severity: low
    mitigation: Only triggered after fast agent fails; criteria are conservative (2 fast failures before escalation)
tests:
  - "Escalation ladder decision tree is documented with clear trigger conditions"
  - "Fixer agent template exists with correct placeholders and model annotation"
  - "Work skill loop references escalation ladder instead of direct execution fallback"
  - "Implementer template includes structured failure reporting guidance"
  - "AGENT.md and agent-contract.md describe the three escalation levels"
todos:
  - id: escalation-decision-tree
    content: "Define escalation decision tree in subagent-dispatch.mdc"
    agent: implementer
    intent: |
      Replace the current "re-dispatch once, then direct execution" pattern in subagent-dispatch.mdc
      with a three-level escalation ladder. The decision tree:

      Level 1 — Redirect (existing): Re-dispatch the same fast sub-agent with better context.
      Trigger: first failure or reviewer FAIL. Include the error/feedback in the re-dispatch prompt.

      Level 2 — Delegate to stronger model: Dispatch a new sub-agent (the "fixer") using a
      non-fast model. Trigger: fast agent has failed twice on the same task. The orchestrator
      builds a richer prompt including the fast agent's error output, the reviewer's feedback
      (if any), and the task context. Use model parameter on the Task tool (omit model="fast"
      to get the default/stronger model, or specify a named model if available).

      Level 3 — Escalate to human: Stop and present a distilled summary. Trigger: fixer agent
      also fails, OR the task requires credentials/external access, OR the orchestrator cannot
      determine the right approach. The summary must include: what was attempted (by whom, with
      what result), the key error or blocker, options the orchestrator sees, and a recommended
      action.

      Update these sections in subagent-dispatch.mdc:
      - Pattern 1 step 6-7 (parallel batch): replace "after 2 failures, do that task yourself"
        with the escalation ladder
      - Pattern 2 step 4 (sequential): same replacement
      - "Follow-up from notes/evidence": integrate — when follow-up IS warranted and involves
        a failure the orchestrator cannot resolve by creating a simple task, escalate
      - "Lifecycle and errors" section: update to reference the ladder

      Keep the existing "direct execution" as a last resort ONLY when the human explicitly
      asks the orchestrator to do it, or when the task is trivially simple (e.g. a one-line fix
      the orchestrator can see in the error output).
    suggestedChanges: |
      In subagent-dispatch.mdc, replace the retry/fallback logic with:

      ## Escalation Ladder

      When a sub-agent returns non-success (failure, reviewer FAIL, or environment error):

      ### Level 1: Redirect (fast agent, better context)
      - **Trigger**: First failure or reviewer FAIL
      - **Action**: Re-dispatch same fast agent with error output + feedback appended to prompt
      - **Max attempts**: 1 redirect (so 2 total fast attempts)

      ### Level 2: Delegate (stronger model)
      - **Trigger**: Fast agent failed twice on the same task
      - **Action**: Dispatch fixer agent (`.cursor/agents/fixer.md`) WITHOUT model="fast"
        (uses default/stronger model). Include in prompt: task context, both fast-agent
        error outputs, reviewer feedback if any.
      - **Max attempts**: 1 fixer dispatch

      ### Level 3: Escalate (human consult)
      - **Trigger**: Fixer also failed, OR task needs credentials/external access, OR
        orchestrator cannot determine approach
      - **Action**: Stop the execution loop. Present to human:
        1. **What was tried**: Agent attempts and their outcomes
        2. **Key error/blocker**: The specific failure or gap
        3. **Options**: What the orchestrator thinks could work
        4. **Recommendation**: The orchestrator's best guess
      - The human decides: retry with guidance, skip, or take over
    changeType: modify
    skill: [rule-authoring]

  - id: fixer-agent-template
    content: "Create fixer agent template for stronger-model escalation"
    agent: implementer
    intent: |
      Create `.cursor/agents/fixer.md` — a sub-agent template for Level 2 escalation.
      The fixer runs on the default (non-fast) model, giving it more reasoning capacity.

      Structure (similar to implementer.md but with escalation context):
      - Purpose: Fix a task that a fast sub-agent failed on twice. You have more reasoning
        capacity. Analyze the prior failures before acting.
      - Model: default (do NOT specify model="fast" when dispatching)
      - Input contract: Same as implementer PLUS:
        - {{FAILURE_LOG}} — concatenated output from both fast-agent attempts
        - {{REVIEWER_FEEDBACK}} — reviewer's FAIL reason if applicable
      - Prompt template: Includes a "Prior attempts" section with failure context.
        Step 1: Analyze what went wrong in prior attempts.
        Step 2: Claim task (tg start), load context.
        Step 3: Fix the issue, staying in scope.
        Step 4: tg done with evidence.
      - Output contract: Same as implementer (tg done + return message).

      The fixer should NOT just retry blindly — it should analyze the failure pattern first.
    suggestedChanges: |
      Template structure:
      ```
      # Fixer sub-agent

      ## Purpose
      Fix a task that fast sub-agents failed on twice. You run on a stronger model
      with more reasoning capacity. Analyze prior failures before acting.

      ## Model
      default (NOT fast) — dispatched without model="fast" parameter.

      ## Input contract
      Same as implementer, plus:
      - {{FAILURE_LOG}} — output from both fast-agent attempts
      - {{REVIEWER_FEEDBACK}} — reviewer feedback if applicable

      ## Prompt template
      [includes analysis-first approach, then standard implementer flow]
      ```
    changeType: create
    skill: [rule-authoring]

  - id: update-implementer-failure-reporting
    content: "Update implementer and reviewer templates for structured failure output"
    agent: implementer
    intent: |
      Update `.cursor/agents/implementer.md`:
      - In the prompt template Step 4 (evidence), add guidance: when the task fails or
        partially succeeds, structure the output so the orchestrator can make escalation
        decisions. Include: what was attempted, what failed (with error text), what the
        agent thinks the issue is, and whether a stronger model or human input would help.
      - Add a "When you cannot complete the task" section: run `tg note <taskId> --msg "..."`,
        return a structured failure message, do NOT run `tg done`.

      Update `.cursor/agents/reviewer.md`:
      - When returning FAIL, include: what specifically failed, whether this seems like a
        "needs more reasoning" issue vs a "needs different approach" issue vs a "needs human
        input" issue. This helps the orchestrator choose the right escalation level.
    changeType: modify
    skill: [rule-authoring]

  - id: update-work-skill-escalation
    content: "Update work skill loop to use escalation ladder instead of direct fallback"
    agent: implementer
    blockedBy: [escalation-decision-tree]
    intent: |
      Update `.cursor/skills/work/SKILL.md`:
      - In the loop step 6, replace the current escalation logic with the three-level ladder:
        a. SUCCESS → check notes, run follow-up protocol
        b. FAIL → Level 1: redirect (re-dispatch fast with feedback)
        c. FAIL again → Level 2: delegate (dispatch fixer agent, no model="fast")
        d. Fixer FAIL → Level 3: escalate to human (stop loop, present summary)
      - Update the "Escalation — When to Stop and Ask the Human" section to reference Level 3
        specifically and clarify that it's the final escalation level.
      - Update progress reporting to include escalation events (e.g. "[work] Task X: escalated
        to fixer agent" or "[work] Task X: escalated to human").
    changeType: modify
    skill: [rule-authoring]

  - id: update-agent-registry
    content: "Update agent README with fixer agent and model tier documentation"
    agent: implementer
    blockedBy: [fixer-agent-template]
    intent: |
      Update `.cursor/agents/README.md`:
      - Add fixer agent entry with description and model tier
      - Add a "Model Tiers" section documenting the conceptual model:
        - Fast (model="fast"): For well-scoped tasks with full context injection.
          Used by: implementer, reviewer, explorer, planner-analyst.
        - Default/Strong (no model parameter, or future named model): For escalated tasks
          requiring deeper reasoning. Used by: fixer.
        - Orchestrator: The session model (whatever the user's IDE is configured to use).
          Makes tactical decisions, coordinates, does not implement.
      - Update the dispatch mechanisms section to note model parameterization.

      Update `.cursor/rules/available-agents.mdc`:
      - Add fixer agent entry.
    changeType: modify
    skill: [rule-authoring, documentation-sync]

  - id: update-contracts-and-docs
    content: "Update AGENT.md, agent-contract.md, and architecture.md with escalation ladder"
    agent: implementer
    blockedBy: [escalation-decision-tree, fixer-agent-template]
    intent: |
      Update `AGENT.md` (root agent contract):
      - Add a brief section on the escalation ladder (3 levels) in the execution loop description.
      - Reference subagent-dispatch.mdc for full details.

      Update `docs/agent-contract.md`:
      - Expand the "When Blocked" section to include the escalation ladder.
      - Add a new section "Escalation Protocol" describing the three levels with trigger
        conditions and expected orchestrator behavior.
      - Update the "Agent Operating Loop" to reference escalation after step 5.

      Update `docs/architecture.md`:
      - Add a "Tactical Decision Model" subsection describing the orchestrator's role as
        tactical coordinator: it makes decisions about agent assignment, failure handling,
        and human escalation. Contrast with the strategic level (initiatives/projects defined
        by the human) and the execution level (sub-agents doing bounded work).
    changeType: modify
    skill: [documentation-sync]
---

# Analysis

## The Tactical Coordinator Model

The orchestrator operates as a **tactical coordinator** (team lead / sergeant) — it doesn't do the work itself, but it makes real-time decisions about who does what and what to do when things go wrong. This is distinct from:

- **Strategic level**: The human defines initiatives, projects, and task design (captured in plans)
- **Execution level**: Sub-agents do bounded, well-scoped work with injected context
- **Tactical level**: The orchestrator assigns tasks to agents, handles failures, and escalates when needed

The orchestrator runs on a lighter model (e.g. O4 Mini) because its job is coordination, not deep reasoning. When deep reasoning is needed, it delegates to a stronger model.

## The Escalation Ladder

```
Sub-agent returns non-success
        │
        ▼
┌─────────────────────┐
│ Level 1: Redirect   │  Re-dispatch fast agent with error context
│ (fast, better ctx)  │  Trigger: first failure
└────────┬────────────┘
         │ still fails
         ▼
┌─────────────────────┐
│ Level 2: Delegate   │  Dispatch fixer agent (stronger model)
│ (stronger model)    │  Trigger: 2 fast failures
└────────┬────────────┘
         │ still fails
         ▼
┌─────────────────────┐
│ Level 3: Escalate   │  Stop, present summary to human
│ (human consult)     │  Trigger: fixer fails, or needs credentials/decision
└─────────────────────┘
```

This replaces the current pattern of "re-dispatch once, then do it yourself (direct execution)." Direct execution becomes a rare last resort only when the human explicitly asks.

## Integration Points

- **Follow-up from notes/evidence**: Already in subagent-dispatch.mdc. The escalation ladder extends this — when a follow-up involves a failure that can't be resolved by creating a simple task, the orchestrator escalates instead.
- **Two-Stage Review**: The spec-reviewer and quality-reviewer feed into Level 1 (their FAIL triggers a redirect). If the redirected agent still fails, Level 2 kicks in.
- **Initiative-Project-Task Hierarchy**: This plan operates at the tactical level within that framework. No hard dependency — the hierarchy provides strategic context, the escalation ladder provides tactical decision-making. Connected via `relates` edge.

## What This Plan Does NOT Do

- **No schema changes**: Escalation events are recorded via existing `tg note` mechanism. No new DB tables or event kinds needed in this phase.
- **No code changes in `src/`**: This is entirely rules, templates, and documentation. The Task tool already supports model parameterization.
- **No specific model names**: We use "fast" vs "default/strong" as conceptual tiers. Actual model names depend on what Cursor/the environment supports and will evolve.

## Dependency Graph

```
Parallel start (3 unblocked):
  ├── escalation-decision-tree (core rule changes)
  ├── fixer-agent-template (new agent)
  └── update-implementer-failure-reporting (template updates)

After escalation-decision-tree:
  └── update-work-skill-escalation

After fixer-agent-template:
  └── update-agent-registry

After escalation-decision-tree + fixer-agent-template:
  └── update-contracts-and-docs
```

## Relationship to Initiative-Project-Task Hierarchy

This plan should have a `relates` edge to the Initiative-Project-Task Hierarchy plan (when both are imported). They operate at different levels:

- **Hierarchy plan**: Defines the strategic structure (Initiative → Project → Task)
- **This plan**: Defines tactical execution behavior within that structure

No blocking dependency — either can be implemented first. The architecture.md update in this plan will reference the strategic/tactical distinction that the hierarchy plan formalizes.

<original_prompt>
Add a tactical escalation ladder to the orchestrator. When a sub-agent completes with anything
other than clean success, the orchestrator follows a structured decision process: (1) redirect
the fast agent with better context, (2) delegate to a stronger model, (3) escalate to the human
with a distilled summary. The orchestrator is a tactical coordinator (team lead) that runs on a
lighter model and makes real-time decisions about agent assignment and failure handling. Should
be dependent on / aware of the Initiative-Project-Task Hierarchy plan.
</original_prompt>
