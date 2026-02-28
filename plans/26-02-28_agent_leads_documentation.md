---
name: Agent and Leads Documentation
overview: Create high-level agent strategy doc, docs/leads/ with per-lead-type docs, skill-lead cross-references, and update existing agent docs to reference the new architecture.
fileTree: |
  docs/
  ├── agent-strategy.md                (create — high-level agent strategy)
  ├── leads/
  │   ├── README.md                    (create — lead concept and registry)
  │   ├── investigator.md              (create — investigator lead)
  │   ├── planner-analyst.md           (create — planner-analyst lead)
  │   ├── execution.md                 (create — execution lead from /work)
  │   └── test-review.md              (create — test-review lead)
  ├── agent-contract.md                (modify — reference strategy and leads)
  .cursor/
  ├── agents/
  │   └── README.md                    (modify — lead vs worker distinction)
  ├── rules/
  │   └── available-agents.mdc         (modify — reference lead docs)
  ├── skills/
  │   ├── investigate/SKILL.md         (modify — cross-ref leads/investigator.md)
  │   ├── plan/SKILL.md                (modify — cross-ref leads/planner-analyst.md)
  │   ├── work/SKILL.md                (modify — cross-ref leads/execution.md)
  │   └── test-review/SKILL.md         (modify — cross-ref leads/test-review.md)
  AGENT.md                             (modify — reference agent-strategy.md)
risks:
  - description: Duplication between agent files (prompt templates) and lead docs (orchestration patterns)
    severity: medium
    mitigation: Lead docs explain the orchestration pattern and how skill+agent work together; agent files remain prompt templates only. Lead docs reference agent files, not duplicate them.
  - description: Lead docs may become stale as skills evolve
    severity: low
    mitigation: Each skill cross-references its lead doc; when a skill changes, the lead doc is in the same change surface.
tests: []
todos:
  - id: agent-strategy-doc
    content: Create docs/agent-strategy.md with high-level agent architecture
    agent: implementer
    intent: |
      Create docs/agent-strategy.md as the canonical reference for the agent system. Cover:
      1. **Orchestrator** — The session-model agent that interprets user intent, chooses skills or defaults to generalPurpose, dispatches leads and workers. It coordinates; it does not do bounded work itself (except fallback after 2 failures).
      2. **Leads** — Specialized orchestration patterns created by skill invocation. A lead receives a directive from the orchestrator, dispatches workers, synthesizes results, and returns structured output. Each lead type is defined by a skill and documented in docs/leads/. Examples: investigator (from /investigate), planner-analyst (from /plan), execution lead (from /work), test-review lead (from /test-review).
      3. **Workers** — Task-level executors dispatched by leads or the orchestrator. They do bounded work with injected context and return results. Examples: implementer, reviewer, explorer, spec-reviewer, quality-reviewer, test-quality-auditor, test-infra-mapper, test-coverage-scanner.
      4. **generalPurpose default** — When the user asks for something without invoking a skill, the orchestrator uses a generalPurpose profile: no specialized lead, direct dispatch of workers or direct execution. This is the fallback behavior.
      5. **Decision tree** — When to use which: user invokes skill -> skill creates lead -> lead dispatches workers. User asks without skill -> orchestrator uses generalPurpose -> dispatches workers directly or does the work.
      6. **Agent files vs lead docs** — Agent files (.cursor/agents/*.md) are prompt templates for sub-agents. Lead docs (docs/leads/*.md) explain orchestration patterns. They complement each other.
      Reference docs/leads/README.md for the lead registry and individual lead docs.
    suggestedChanges: |
      Structure: # Agent Strategy, ## Orchestrator, ## Leads, ## Workers, ## generalPurpose Default, ## Decision Tree, ## File Layout.
      Keep it under 150 lines. Link to docs/leads/README.md, .cursor/agents/README.md, .cursor/rules/subagent-dispatch.mdc.
    changeType: create
    docs: [architecture, agent-contract]
    skill: documentation-sync

  - id: leads-readme
    content: Create docs/leads/README.md with lead concept and registry
    agent: implementer
    intent: |
      Create docs/leads/README.md explaining:
      1. **What is a lead** — A specialized orchestration pattern created by skill invocation. The orchestrator invokes a skill; the skill creates a lead that dispatches workers, synthesizes results, and returns structured output. Leads are not separate agent files; they are patterns within skills that use agent files as prompt templates for the workers they dispatch.
      2. **Lead registry** — Table of lead types with columns: Lead, Skill, Agent file(s), Purpose. Include: investigator (/investigate, investigator.md), planner-analyst (/plan, planner-analyst.md), execution (/work, implementer.md + reviewer.md), test-review (/test-review, test-quality-auditor.md + test-infra-mapper.md + test-coverage-scanner.md).
      3. **How leads differ from workers** — Leads orchestrate; workers execute. Leads are created by skills; workers are dispatched by leads or the orchestrator.
      4. **Adding a new lead** — Create a skill in .cursor/skills/, optionally create an agent file in .cursor/agents/ if the lead needs a dedicated sub-agent, document the lead in docs/leads/<name>.md, add to this registry.
    changeType: create
    docs: [agent-contract]
    skill: documentation-sync

  - id: lead-doc-investigator
    content: Create docs/leads/investigator.md documenting the investigator lead
    agent: implementer
    blockedBy: [leads-readme]
    intent: |
      Create docs/leads/investigator.md. Cover:
      1. **Created by** — /investigate skill (.cursor/skills/investigate/SKILL.md)
      2. **Agent file** — .cursor/agents/investigator.md (read-only sub-agent)
      3. **Pattern** — Skill reads end-of-chat context + quick docs/ scan -> drafts investigation areas -> dispatches investigator sub-agent with tactical directives -> synthesizes findings -> produces plan and tasks.
      4. **What it orchestrates** — Only the investigator sub-agent (read-only). No implementer, no reviewer.
      5. **Input** — Tactical directive, optional scope and context (from chat history and docs/ scan).
      6. **Output** — Structured findings (files, function chains, architecture, schemas, API facades, risks, suggested follow-up tasks).
      7. **When to use** — After sub-agent reports, post-action summaries, or when the user says /investigate. For understanding what to do next based on recent work or failures.
    changeType: create
    skill: documentation-sync

  - id: lead-doc-planner-analyst
    content: Create docs/leads/planner-analyst.md documenting the planner-analyst lead
    agent: implementer
    blockedBy: [leads-readme]
    intent: |
      Create docs/leads/planner-analyst.md. Cover:
      1. **Created by** — /plan skill (.cursor/skills/plan/SKILL.md)
      2. **Agent file** — .cursor/agents/planner-analyst.md
      3. **Pattern** — Skill dispatches planner-analyst to gather codebase context (files, patterns, risks, task-graph state, rough breakdown) -> orchestrator uses output to write the plan (architecture, dependencies, task design).
      4. **Two-phase workflow** — Phase 1: analyst gathers facts. Phase 2: orchestrator writes the plan. The analyst does not write the plan.
      5. **Input** — User's feature request, optionally tg status output.
      6. **Output** — Structured analysis (relevant files, existing data, patterns, risks, related prior work, rough task breakdown, recommended docs/skills).
      7. **When to use** — Mandatory before any plan creation. AGENT.md and plan-authoring.mdc require it.
    changeType: create
    skill: documentation-sync

  - id: lead-doc-execution
    content: Create docs/leads/execution.md documenting the execution lead
    agent: implementer
    blockedBy: [leads-readme]
    intent: |
      Create docs/leads/execution.md. Cover:
      1. **Created by** — /work skill (.cursor/skills/work/SKILL.md)
      2. **Agent files** — .cursor/agents/implementer.md, .cursor/agents/reviewer.md (and spec-reviewer, quality-reviewer for two-stage review)
      3. **Pattern** — Skill enters autonomous execution loop: tg next -> dispatch implementers (up to 5 parallel) -> wait -> review (two-stage) -> re-dispatch on failure -> repeat until plan complete or escalation.
      4. **Orchestration details** — File conflict check before parallel dispatch. 90s timeout per sub-agent. Follow-up from notes/evidence. Human escalation after 2 failures or ambiguity.
      5. **Input** — Plan name or multi-plan mode (from chat context or user directive).
      6. **Output** — Progress reports per batch, final summary (done/failed/skipped/duration).
      7. **When to use** — User says /work, "go", "execute", "grind", or wants tasks completed autonomously.
    changeType: create
    skill: documentation-sync

  - id: lead-doc-test-review
    content: Create docs/leads/test-review.md documenting the test-review lead
    agent: implementer
    blockedBy: [leads-readme]
    intent: |
      Create docs/leads/test-review.md. Cover:
      1. **Created by** — /test-review skill (.cursor/skills/test-review/SKILL.md)
      2. **Agent files** — .cursor/agents/test-quality-auditor.md, .cursor/agents/test-infra-mapper.md, .cursor/agents/test-coverage-scanner.md
      3. **Pattern** — Skill dispatches 3 scanner sub-agents in parallel (quality auditor, infra mapper, coverage scanner) -> orchestrator synthesizes their findings -> produces a report and a Cursor-format plan with tasks.
      4. **Input** — User request to review tests, audit coverage, or assess test health.
      5. **Output** — Report (findings from 3 scanners) + plan with tasks (each task has agent field for execution).
      6. **When to use** — User asks to review tests, audit test coverage, improve testing strategy, or assess test health.
    changeType: create
    skill: documentation-sync

  - id: cross-refs-and-updates
    content: Add skill-lead cross-references and update existing agent docs
    agent: implementer
    blockedBy:
      [
        agent-strategy-doc,
        lead-doc-investigator,
        lead-doc-planner-analyst,
        lead-doc-execution,
        lead-doc-test-review,
      ]
    intent: |
      1. **Skill cross-references** — Add a short "Lead documentation" section or line to each skill that creates a lead, pointing to its lead doc:
         - .cursor/skills/investigate/SKILL.md -> "See docs/leads/investigator.md for the investigator lead pattern."
         - .cursor/skills/plan/SKILL.md -> "See docs/leads/planner-analyst.md for the planner-analyst lead pattern."
         - .cursor/skills/work/SKILL.md -> "See docs/leads/execution.md for the execution lead pattern."
         - .cursor/skills/test-review/SKILL.md -> "See docs/leads/test-review.md for the test-review lead pattern."
      2. **AGENT.md** — Add a short section or line referencing docs/agent-strategy.md as the canonical agent architecture doc.
      3. **.cursor/agents/README.md** — Add a "Leads vs Workers" section explaining that some agents are used as leads (orchestration patterns created by skills) and some as workers (task-level executors). Reference docs/leads/README.md for lead details.
      4. **.cursor/rules/available-agents.mdc** — Add a note that lead types are documented in docs/leads/ and that the investigator entry references docs/leads/investigator.md.
      5. **docs/agent-contract.md** — Add a reference to docs/agent-strategy.md and docs/leads/.
    changeType: modify
    docs: [agent-contract]
    skill: documentation-sync
isProject: false
---

## Analysis

The agent system has three tiers: **orchestrator** (session model), **leads** (skill-invoked orchestration patterns), and **workers** (task-level executors). This is implicit in the codebase but not documented anywhere as a coherent architecture. Agent files in `.cursor/agents/` are prompt templates; skills in `.cursor/skills/` define orchestration patterns. Some skills create "leads" — specialized orchestration flows that dispatch workers, synthesize results, and return structured output. When no skill is invoked, the orchestrator uses a generalPurpose default.

**Key decisions:**

- **Lead docs explain orchestration patterns, not prompt templates.** Agent files remain the prompt templates; lead docs explain how the skill + agent work together and what the lead orchestrates.
- **docs/leads/ is the canonical location** for lead documentation. Each skill that creates a lead cross-references its lead doc.
- **docs/agent-strategy.md** is the high-level architecture doc that explains the three tiers and the decision tree.
- **No code changes.** This is pure documentation.

## Dependency graph

```
Parallel start (2 unblocked):
  ├── agent-strategy-doc
  └── leads-readme

After leads-readme (4 parallel):
  ├── lead-doc-investigator
  ├── lead-doc-planner-analyst
  ├── lead-doc-execution
  └── lead-doc-test-review

After all above:
  └── cross-refs-and-updates
```

## Proposed changes

- **docs/agent-strategy.md**: Orchestrator / Leads / Workers / generalPurpose Default / Decision Tree / File Layout. Under 150 lines. Links to docs/leads/README.md, .cursor/agents/README.md, .cursor/rules/subagent-dispatch.mdc.
- **docs/leads/README.md**: Lead concept, registry table (Lead | Skill | Agent file(s) | Purpose), how to add a new lead.
- **docs/leads/investigator.md**: Created by /investigate; dispatches investigator sub-agent (read-only); tactical directive -> findings -> plan.
- **docs/leads/planner-analyst.md**: Created by /plan; two-phase (analyst gathers facts, orchestrator writes plan).
- **docs/leads/execution.md**: Created by /work; autonomous loop (next -> dispatch implementers -> review -> repeat).
- **docs/leads/test-review.md**: Created by /test-review; 3 parallel scanners -> synthesis -> report + plan.
- **Cross-refs**: Each skill gets a one-liner pointing to its lead doc. AGENT.md, agents/README.md, available-agents.mdc, agent-contract.md get short references.

<original_prompt>
we should probably have a high level doc that explains what all the agents are and our general strategy for them. including an explanation of how the orchestrator works with them. Investigator is a particular type of lead. created through invocation of a skill. Other types are also defined by skills.

Each lead type should be carefully documented in a ./docs/leads file. each skill references this for context of how they work together and what kind of job each does.

If I ever ask for an agent to do something for me without use of a skill it uses a generalPurpose profile.

make a plan for this update
</original_prompt>
