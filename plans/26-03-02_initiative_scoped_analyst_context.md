---
name: Initiative-scoped analyst context
overview: When planning under Hivemind or any initiative, pass initiative-scoped tg status and crossplan summary into the planner-analyst prompt so containers of work are scoped by initiative from the start.
fileTree: |
  .cursor/skills/plan/
  └── SKILL.md                    (modify)
  .cursor/agents/
  └── planner-analyst.md          (modify)
risks:
  - description: Initiative-scoped status/crossplan (--initiative) may not be implemented yet (Hivemind Initiative plan)
    severity: low
    mitigation: Skill and template use --initiative when available; otherwise pass unfiltered status --projects and crossplan summary so analyst still gets project/crossplan context
tests:
  - "Plan skill Phase 1 instructs orchestrator to gather initiative context when planning under initiative"
  - "Planner-analyst template includes optional INITIATIVE_CONTEXT section"
todos:
  - id: plan-skill-initiative-context
    content: Add initiative-scoped context step to plan skill Phase 1
    agent: documenter
    changeType: modify
    intent: |
      In .cursor/skills/plan/SKILL.md Phase 1 (Dispatch Planner-Analyst), add a
      step: when the user is planning under an initiative (e.g. says "under
      Hivemind", "for Hivemind", or provides an initiative name/id), the
      orchestrator must (1) resolve initiative to id if needed (tg initiative
      list or show), (2) run tg status --projects --initiative <id> (or
      status --projects if --initiative not yet implemented) and tg crossplan
      summary --json (with --initiative <id> when available), (3) pass the
      output into the analyst prompt as {{INITIATIVE_CONTEXT}}. When no
      initiative is specified, leave {{INITIATIVE_CONTEXT}} empty or omit.
      Goal: containers of work are scoped by initiative from the start so the
      analyst sees projects and cross-plan summary for that initiative.
    suggestedChanges: |
      New bullet in Phase 1 after "Run pnpm tg status --tasks": "If planning
      under an initiative (user said so or initiative passed): run tg status
      --projects --initiative <id> and tg crossplan summary --json
      (--initiative <id> when available); inject as {{INITIATIVE_CONTEXT}} in
      analyst prompt. Otherwise omit INITIATIVE_CONTEXT."

  - id: planner-analyst-initiative-section
    content: Add optional INITIATIVE_CONTEXT section to planner-analyst template
    agent: documenter
    changeType: modify
    intent: |
      In .cursor/agents/planner-analyst.md, add to the prompt template an
      optional section that the orchestrator fills when planning under an
      initiative: "**Initiative-scoped context (containers of work)**\n
      {{INITIATIVE_CONTEXT}}\n" with instruction that when present, the analyst
      should use this to scope their analysis to projects and cross-plan
      summary under that initiative. Update Input contract to list
      {{INITIATIVE_CONTEXT}} as optional (initiative-scoped status --projects
      and crossplan summary output).
    suggestedChanges: |
      After "Request / feature" block in template, add conditional block:
      "**Initiative-scoped context (when planning under an initiative)**\n
      {{INITIATIVE_CONTEXT}}\n When present, use this to scope your analysis
      to the projects and cross-plan summary under this initiative."
      Input contract: add "Optionally: {{INITIATIVE_CONTEXT}} — initiative-
      scoped tg status --projects and tg crossplan summary output."
isProject: false
---

# Initiative-scoped analyst context — Analysis

## Why this approach

The user asked that when planning under Hivemind (or any initiative), we pass initiative-scoped `tg status --projects --initiative` and crossplan summary into the analyst prompt so "containers of work" are scoped by initiative from the start. That gives the planner-analyst visibility into existing projects and cross-plan dependencies within that initiative before they produce their analysis.

Two touchpoints: (1) the plan skill Phase 1 — orchestrator must detect "planning under initiative" and gather the data, then inject it into the analyst prompt; (2) the planner-analyst template — must accept an optional `{{INITIATIVE_CONTEXT}}` section and instruct the analyst to use it when present. No new CLI commands; we use existing (or soon-to-exist from Hivemind Initiative) status and crossplan with --initiative. If --initiative is not yet implemented, the skill can still run status --projects and crossplan summary and pass that, so analyst gets project/crossplan context; once --initiative exists, scope narrows to the initiative.

## Dependency graph

```
Parallel start (2 unblocked):
  ├── plan-skill-initiative-context   (Phase 1 step + {{INITIATIVE_CONTEXT}})
  └── planner-analyst-initiative-section (template + input contract)
```

## Proposed changes

- **plan-skill-initiative-context:** In SKILL.md Phase 1, after "Run pnpm tg status --tasks", add: when user is planning under an initiative, resolve initiative id, run `tg status --projects --initiative <id>` and `tg crossplan summary --json` (with `--initiative <id>` when available), inject output as `{{INITIATIVE_CONTEXT}}`; otherwise leave empty/omit.
- **planner-analyst-initiative-section:** In planner-analyst.md prompt template, add optional "**Initiative-scoped context (containers of work)** / {{INITIATIVE_CONTEXT}}" block with one-line instruction to use it when present. Input contract: add optional {{INITIATIVE_CONTEXT}}.

## Open questions

- None; scope is skill + agent template only. Initiative-scoped CLI (--initiative) is owned by Hivemind Initiative plan.

## Original prompt

<original_prompt>
/plan When planning under Hivemind (or any initiative), pass initiative-scoped tg status --projects --initiative (and crossplan summary) into the analyst prompt so "containers of work" are scoped by initiative from the start.

just add tasks for now. can you also update that prompt to say 1, 2 and 3 at the front so we can just give number select comands going forward for options for the user.

addressable data ++
</original_prompt>
