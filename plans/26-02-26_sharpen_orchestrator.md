---
name: Sharpen Orchestrator Compliance
overview: |
  Fix contradictions and gaps in orchestrator rules so it reliably dispatches sub-agents, uses the planner-analyst, and produces parallel-friendly plans. Five independent edits plus a template sync.
todos:
  - id: enforce-parallel-plans
    content: Add parallel-task requirement to plan-authoring.mdc
    status: completed
  - id: add-decision-audit
    content: Require tg note for direct execution decisions
    status: completed
  - id: fix-workflow-dispatch-primary
    content: "Rewrite taskgraph-workflow.mdc execution loop: dispatch is primary, direct is fallback"
    status: completed
  - id: prime-session-start
    content: Add key behavioral constraints to session-start.mdc
    status: completed
  - id: add-compliance-checklist
    content: Add pre-response compliance checklist to AGENT.md
    status: completed
  - id: sync-template
    content: Sync all changes to src/template/ copies
    status: completed
    blockedBy:
      - enforce-parallel-plans
      - add-decision-audit
      - fix-workflow-dispatch-primary
      - prime-session-start
      - add-compliance-checklist
isProject: false
---
