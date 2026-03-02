---
name: Verifier Agent and Orchestrator-Subagent Docs
overview: Add verifier sub-agent, document orchestrator-subagent patterns (when multi-agent, verifier in flow, when not to add agents), and produce AgentDex profile checklist for when dex exists. Based on reports/26-03-02_orchestrator_subagent_research.md.
fileTree: |
  .cursor/
  ├── agents/
  │   └── verifier.md                    (create)
  └── rules/
  └── available-agents.mdc               (modify)
  docs/
  ├── agent-strategy.md                 (modify)
  └── agent-dex-profile-checklist.md     (create)
risks:
  - description: Verifier and reviewer could be confused by orchestrator
    severity: low
    mitigation: Document in available-agents "Key boundaries" (reviewer = code vs spec; verifier = run tests/checks, skeptical of "done").
  - description: Scope creep into AgentDex implementation
    severity: medium
    mitigation: This plan only adds verifier agent, docs, and profile checklist. No schema, no tg dex add, no research-agents skill; those belong to plan "AgentDex and Agents (discovered)".
tests:
  - "No new automated tests; run-full-suite validates repo state after doc and agent file changes."
todos:
  - id: verifier-agent
    content: Create .cursor/agents/verifier.md with frontmatter and skeptical-validator prompt
    agent: documenter
    intent: |
      Create verifier.md following .cursor/agents/investigator.md pattern: YAML frontmatter with name (verifier), description (Validates completed work; use after implementer marks done to confirm implementations are functional. Run tests, check edge cases, report passed vs incomplete. Do not trust claims.). Purpose: skeptical validator that runs tests and checks after implementer (or optionally investigator) marks done; report VERIFIED / INCOMPLETE with short report. Model: inherit. Input: task id, intent, evidence string, diff or changed files. Output: VERIFIED or INCOMPLETE plus brief report. Include "When to use" (e.g. high-stakes tasks or after investigator). No code changes to /work or subagent-dispatch in this task; agent is available for manual or future dispatch.
    changeType: create
  - id: doc-orchestrator-subagent
    content: Add orchestrator-subagent section to docs/agent-strategy.md
    agent: documenter
    intent: |
      In docs/agent-strategy.md add a new section (e.g. "When we use multi-agent" or "Orchestrator-subagent patterns") that covers: (1) When we use multi-agent — context isolation, parallelization, specialization per Anthropic; (2) Where verifier fits — implementer to reviewer to optional verifier; (3) When NOT to add agents — cost 3-10x tokens; add only when benefits justify. Optionally link to reports/26-03-02_orchestrator_subagent_research.md. Keep section concise; if it grows beyond one screen, consider extracting to docs/orchestrator-subagent-patterns.md and linking from agent-strategy.
    changeType: modify
  - id: agent-dex-profile-checklist
    content: Create docs/agent-dex-profile-checklist.md with initial researched profiles to add
    agent: documenter
    intent: |
      Create docs/agent-dex-profile-checklist.md listing which researched profiles to add first once AgentDex is implemented (per plan "AgentDex and Agents (discovered)"): Cursor (verifier, orchestrator pattern), Gastown (Mayor, Polecat, Witness, Refinery, mail protocol), Superpowers (verification-before-completion, subagent-driven-development, systematic-debugging), Anthropic (when to use multi-agent). One line per profile or source with short rationale. Note that docs/agent-dex.md will be created by the other plan and can link to this checklist. Add slug to docs/domains.md if domains.md lists agent-dex or agent-system; otherwise add agent-dex-profile-checklist under agent-system or as new row.
    changeType: create
  - id: register-verifier-available-agents
    content: Register verifier in .cursor/rules/available-agents.mdc
    agent: documenter
    blockedBy: [verifier-agent]
    intent: |
      In .cursor/rules/available-agents.mdc: (1) Add verifier to the Agent role reference table — Read/Write (verifier runs tests), Dispatched when "After implementer marks done for independent verification; optional after investigator", Output "VERIFIED or INCOMPLETE + report". (2) Add one line under Key boundaries: verifier vs reviewer (reviewer = code/spec quality; verifier = run tests/checks, skeptical of "done") and verifier vs run-full-suite task (task runs gate; verifier is a sub-agent that can be dispatched for spot-check). (3) Add ## verifier subsection with 1-2 sentences and "See .cursor/agents/verifier.md. When AgentDex exists, add as researched profile."
    changeType: modify
  - id: link-strategy-to-checklist
    content: Link agent-strategy to agent-dex-profile-checklist
    agent: documenter
    blockedBy: [agent-dex-profile-checklist, doc-orchestrator-subagent]
    intent: |
      In docs/agent-strategy.md, in the new orchestrator-subagent section, add a short link to docs/agent-dex-profile-checklist.md for "initial AgentDex researched profiles to add when dex is ready."
    changeType: modify
  - id: run-full-suite
    content: Run full test suite (pnpm gate:full) and record result in evidence
    agent: implementer
    blockedBy:
      [
        verifier-agent,
        doc-orchestrator-subagent,
        agent-dex-profile-checklist,
        register-verifier-available-agents,
        link-strategy-to-checklist,
      ]
    intent: |
      Run pnpm gate:full (or bash scripts/cheap-gate.sh --full). Record result in tg done evidence: "gate:full passed" or "gate:full failed: <summary>". If failed, add tg note with failure reason.
    changeType: modify
isProject: false
---

# Verifier Agent and Orchestrator-Subagent Docs

## Analysis

This plan implements the high-impact, low-effort recommendations from the orchestrator/sub-agent research (reports/26-03-02_orchestrator_subagent_research.md): add a **verifier** sub-agent (skeptical validator post-implementer), document **when we use multi-agent** and when not to add agents, and produce an **AgentDex profile checklist** for use once the separate "AgentDex and Agents (discovered)" plan delivers the dex schema, `tg dex add`, and research-agents skill. No overlap with that plan: we do not create agent_dex table, dashboard changes, or research-agents skill.

## Dependency graph

```
Parallel start (3 unblocked):
  ├── verifier-agent          (create .cursor/agents/verifier.md)
  ├── doc-orchestrator-subagent (add section to docs/agent-strategy.md)
  └── agent-dex-profile-checklist (create docs/agent-dex-profile-checklist.md)

After verifier-agent:
  └── register-verifier-available-agents

After agent-dex-profile-checklist and doc-orchestrator-subagent:
  └── link-strategy-to-checklist

After all feature tasks:
  └── run-full-suite
```

## Proposed changes

- **verifier.md**: Same structure as investigator.md — frontmatter (name, description), Purpose, Model (inherit), Input (task context, evidence, diff), Output (VERIFIED/INCOMPLETE + report). Verifier does not replace reviewer; it runs tests and checks and reports whether claimed-done work actually works.
- **agent-strategy.md**: New section "When we use multi-agent" (or "Orchestrator-subagent patterns") with three bullets: when we use (context, parallel, specialization), where verifier fits, when not to add (cost). Link to research report and to agent-dex-profile-checklist.
- **agent-dex-profile-checklist.md**: Markdown list or table of sources and profiles (Cursor, Gastown, Superpowers, Anthropic) with one-line rationale. Referenced by docs/agent-dex.md when that doc is created in the other plan.
- **available-agents.mdc**: One table row, one Key-boundaries line, one ## verifier block.

## Open questions

None. Checklist placement is decided: standalone doc so docs/agent-dex.md can link to it later.

## Related

- reports/26-03-02_orchestrator_subagent_research.md (source of recommendations)
- plans/26-03-02_agent_dex_research_agents.md (AgentDex implementation; do not duplicate)

<original_prompt>
create /plan based on context
</original_prompt>
