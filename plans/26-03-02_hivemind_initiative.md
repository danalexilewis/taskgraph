---
name: Hivemind Initiative
overview: Add the Hivemind initiative and improve sub-agent coordination, research-agent containers of work across projects, and suggest follow-up plan options after plan finalization to encourage mapping of large work containers.
fileTree: |
  .cursor/skills/plan/
  └── SKILL.md                    (modify)
  src/
  ├── cli/
  │   ├── context.ts              (modify - if hive not in 26-03-02)
  │   ├── initiative.ts           (reference)
  │   ├── status.ts               (modify)
  │   └── crossplan.ts            (modify)
  ├── plan-import/
  │   └── parser.ts               (modify)
  src/domain/
  └── hive.ts                     (create - if not from 26-03-02)
  docs/
  ├── plan-format.md              (modify)
  ├── cli-reference.md            (modify)
  └── agent-strategy.md           (modify)
risks:
  - description: Hive context (tg context --hive) is already planned in 26-03-02; this plan should not duplicate it
    severity: low
    mitigation: Reference or block on 26-03-02_hive_context; one task verifies alignment or defers to that plan
  - description: Suggest follow-ups is skill-only; orchestrators must follow the updated Phase 3
    severity: low
    mitigation: Document clearly in SKILL.md and session-start or plan rules
  - description: Initiative-scoped status/crossplan adds filter paths; execa Dolt semaphore may serialize more queries
    severity: low
    mitigation: Same pattern as existing status; optional --initiative filter
tests:
  - "Import plan with initiative in frontmatter sets project.initiative_id"
  - "tg status --projects --initiative <id> returns only projects under that initiative"
  - "Plan skill Phase 3 instructs orchestrator to suggest follow-up plan options when appropriate"
todos:
  - id: create-hivemind-initiative
    content: Create Hivemind initiative and document it
    agent: documenter
    changeType: modify
    intent: |
      Create the initiative "Hivemind" so plans can be grouped under it. Run
      `tg initiative new "Hivemind" "<description>"` (or equivalent) where description
      states the initiative improves sub-agent coordination and research agents'
      ability to set up containers of work across project structures; the system
      thrives with many plans and entangled dependency trees. Document in docs/
      or .cursor/rules how to assign plans to Hivemind (import --initiative, or
      initiative assign-project). No schema change; initiative table already exists.
    suggestedChanges: |
      After creating initiative: add one short subsection to docs/glossary.md or
      multi-agent.md listing Hivemind and its purpose, and reference tg initiative
      list/show in cli-reference.

  - id: plan-skill-follow-up-options
    content: Add suggest follow-up plan options to plan skill Phase 3
    agent: documenter
    changeType: modify
    intent: |
      In .cursor/skills/plan/SKILL.md Phase 3 (Validate and Present), add a step
      after "Interpret the user's response": when the user acknowledges (thanks,
      looks good, ok) or after any plan finalization, the orchestrator should
      optionally suggest follow-up plan options. Source data: tg status --projects,
      tg status --initiatives, tg crossplan summary --json. Goal: encourage more
      plans and dependency mapping. No CLI change; skill text and table only.
    suggestedChanges: |
      New subsection "Suggest follow-up plans" under Phase 3. Bullet: "After
      presenting the plan (and when user says thanks/looks good/ok), optionally
      suggest 2-3 follow-up plan ideas drawn from status --projects, --initiatives,
      or crossplan summary to encourage mapping of large containers of work."

  - id: initiative-in-plan-frontmatter
    content: Parse initiative from plan frontmatter and set on import
    agent: implementer
    changeType: modify
    blockedBy: [create-hivemind-initiative]
    docs: [schema, plan-format, plan-import]
    intent: |
      Plan format already documents initiative (ID or title) in frontmatter.
      Parser does not read it. Add optional `initiative` to parsed plan schema in
      src/plan-import/parser.ts (string: initiative id or title). On import, when
      initiative is present in the plan file, resolve it (by title or id) to
      initiative_id and set project.initiative_id. If initiative not in frontmatter,
      keep current behavior (CLI --initiative or Unassigned). See docs/plan-format.md
      and existing import --initiative handling in src/cli/import.ts.
    suggestedChanges: |
      parser.ts: add initiative?: string to frontmatter type and parse it.
      import.ts: when parsing plan from file, pass through initiative from parsed
      plan; resolve title to id via initiative table if needed; pass to existing
      project update path that sets initiative_id.

  - id: initiative-scoped-status-crossplan
    content: Add --initiative filter to status and crossplan
    agent: implementer
    changeType: modify
    blockedBy: [create-hivemind-initiative]
    docs: [schema, cli-reference]
    intent: |
      Allow status and crossplan to be scoped by initiative. Add optional
      --initiative <id|title> to tg status --projects and tg status --tasks so
      only projects/tasks under that initiative are returned. Add same optional
      filter to tg crossplan (plans, summary, domains, skills, files, edges) so
      research agents can request "all projects under Hivemind." Resolve title
      to id using initiative table when needed. See src/cli/status.ts and
      src/cli/crossplan.ts; follow existing filter patterns.
    suggestedChanges: |
      status.ts: add --initiative to projects and tasks branches; WHERE
      project.initiative_id = ? (resolve title to id once). crossplan.ts: add
      --initiative; filter project rows by initiative_id in all subcommands.

  - id: hive-context-alignment
    content: Align with or verify Hive Context plan (tg context --hive)
    agent: documenter
    changeType: modify
    intent: |
      Hive context (HiveSnapshot, tg context --hive) is specified in
      plans/26-03-02_hive_context.md. This task does not duplicate that plan.
      Either (a) add a short note in docs/agent-strategy.md or multi-agent.md
      that Hivemind initiative encompasses hive coordination and reference
      the hive context plan for implementation, or (b) if 26-03-02 is already
      done, verify docs and implementer template reference tg context --hive
      and update this plan's fileTree/risks accordingly. No code change in
      this repo for the actual --hive flag unless 26-03-02 is not executed.
    suggestedChanges: |
      One paragraph in agent-strategy or multi-agent: "The Hivemind initiative
      groups work on sub-agent coordination; hive visibility is implemented
      via tg context --hive (see plan Hive Context)."

  - id: crossplan-dependency-visibility-docs
    content: Document cross-plan dependency visibility for research agents
    agent: documenter
    changeType: modify
    blockedBy: [initiative-scoped-status-crossplan]
    docs: [architecture, cli-reference, agent-strategy]
    intent: |
      Research agents (planner-analyst, explore, reviewer research mode) need
      to set up "containers of work" across project structures. Document how
      to use tg status --projects, tg status --initiatives, tg crossplan
      summary/edges (and when available --initiative) to scope context for
      analysts. Add a short section to docs/agent-strategy.md or a new
      docs/research-context.md on initiative-scoped and cross-plan context
      for leads and workers. Optionally document export mermaid/dot by
      initiative if implemented elsewhere.
    suggestedChanges: |
      agent-strategy or research-context: "Containers of work for research:
      use tg status --initiatives and tg status --projects --initiative <id>
      to see plans under an initiative; use tg crossplan summary --json
      (and --initiative when available) to see domains, skills, file overlap,
      and proposed edges across plans."

  - id: docs-and-skill-updates
    content: Update agent contract, plan skill refs, and CLI reference for Hivemind
    agent: documenter
    changeType: modify
    blockedBy:
      [
        plan-skill-follow-up-options,
        hive-context-alignment,
        initiative-scoped-status-crossplan,
      ]
    intent: |
      Final doc pass: ensure docs/agent-contract.md, docs/cli-reference.md,
      and .cursor/rules that reference plan flow or initiatives mention
      Hivemind where appropriate (e.g. as the initiative for coordination
      work). Ensure plan skill Phase 3 table and import command are still
      correct after adding suggest follow-up step. List tg initiative and
      --initiative filter in cli-reference if not already there.
    suggestedChanges: |
      cli-reference: status --initiative, crossplan --initiative. Plan
      skill: no structural change beyond follow-up step. Glossary or
      agent-strategy: one-line Hivemind definition.

isProject: false
---

# Hivemind Initiative — Analysis

## Why this approach

The user asked for a plan that (1) adds an initiative named "Hivemind" to group work on sub-agent coordination and research-agent "containers of work," (2) improves how sub-agents work together and how research agents operate across project structures, and (3) has the orchestrator suggest follow-up plan options after finalizing plans to encourage more plans and dependency mapping.

The analyst found that the initiative table and project.initiative_id already exist; the gap is creating the Hivemind initiative and optionally parsing initiative from plan frontmatter. Hive context (tg context --hive) is already planned in 26-03-02_hive_context.md — this plan aligns with it rather than re-implementing. Follow-up suggestions are a skill-only change to Phase 3. Initiative-scoped status and crossplan enable research agents to scope by initiative (e.g. "all Hivemind projects"). Cross-plan dependency visibility is partly covered by existing crossplan; we add filters and documentation.

## Dependency graph

```
Parallel start (3 unblocked):
  ├── create-hivemind-initiative   (tg initiative new + doc)
  ├── plan-skill-follow-up-options (SKILL.md Phase 3)
  └── hive-context-alignment       (doc ref to 26-03-02)

After create-hivemind-initiative:
  ├── initiative-in-plan-frontmatter (parser + import)
  └── initiative-scoped-status-crossplan (--initiative filter)

After initiative-scoped-status-crossplan:
  └── crossplan-dependency-visibility-docs

After plan-skill-follow-up-options, hive-context-alignment, initiative-scoped-status-crossplan:
  └── docs-and-skill-updates
```

## Proposed changes

- **create-hivemind-initiative:** Run CLI to create initiative; add 1–2 sentences to glossary or multi-agent. Description text: e.g. "Improves sub-agent coordination and research agents' ability to set up containers of work across project structures; thrives with many plans and entangled dependency trees."
- **plan-skill-follow-up-options:** In SKILL.md Phase 3, new subsection "Suggest follow-up plans" with one bullet: after user acknowledges or plan is finalized, optionally suggest 2–3 follow-up plan ideas from tg status --projects, tg status --initiatives, tg crossplan summary.
- **initiative-in-plan-frontmatter:** parser.ts add `initiative?: string`; import resolves by title/id and sets project.initiative_id when present.
- **initiative-scoped-status-crossplan:** status.ts and crossplan.ts add optional --initiative; filter project (and thus tasks) by initiative_id.
- **hive-context-alignment:** Doc-only; reference 26-03-02 and Hivemind in agent-strategy or multi-agent.
- **crossplan-dependency-visibility-docs:** Short section on using status/crossplan (and --initiative) for research context.
- **docs-and-skill-updates:** CLI reference for new flags; ensure Hivemind is mentioned where initiatives are documented.

## Open questions

- Whether to add `export markdown --initiative <id>` (or export mermaid/dot by initiative) in this plan or a follow-up; analyst noted it as optional and dependent on initiative filter in export.
- Whether planner-analyst prompt template should explicitly receive initiative-scoped context when the user is planning under Hivemind; could be a follow-up once --initiative filters exist.

## Original prompt

<original_prompt>
Add plan with initiative "Hivemind" which is a new initiative that we are taking on to improve the sub agents ability to work together. and for research agents to setup containers of work better by working across project structures.

This system thrives when there are lots of plans being added as it has the ability to map work with very entangled dependency trees.

Start suggesting follow up plan options after writing finalised plans for a user. That way we can encourage an increase in the mapping of large containers of work into the future.

/lplan. There are several parts to that mess
</original_prompt>
