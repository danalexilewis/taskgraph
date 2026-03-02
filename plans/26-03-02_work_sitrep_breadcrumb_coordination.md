---
name: Work Skill Sitrep Breadcrumb Coordination
overview: Add a sitrep breadcrumb so multiple /work instances can spin up without racing. The first agent claims making sitrep via a breadcrumb; others skip sitrep and pull tasks immediately, then cycle back to check and optionally refresh sitrep when done or stale.
fileTree: |
  .cursor/
  ├── skills/
  │   └── work/
  │       └── SKILL.md                    (modify)   # Phase 0 breadcrumb-first flow
  .taskgraph/
  │   └── sitrep-breadcrumb.json          (create)   # Ephemeral; convention + gitignore
  docs/
  ├── leads/
  │   ├── README.md                        (modify)   # Sitrep breadcrumb convention
  │   └── execution.md                    (modify)   # Phase 0 steps
  └── multi-agent.md                      (modify)   # Breadcrumb coordination
risks:
  - description: Multiple agents write breadcrumb at same time; both think they're "first"
    severity: low
    mitigation: Breadcrumb is "best effort"; first writer wins; 10-min making_sitrep expiry lets another agent take over if first stalls. No lock required for v1.
  - description: Stale breadcrumb left behind if agent dies mid-sitrep
    severity: low
    mitigation: making_sitrep entries older than 10 minutes are treated as stale; any agent may overwrite and generate sitrep.
tests:
  - "Phase 0 doc: when no plan, first step is 'read sitrep breadcrumb'"
  - "Breadcrumb file format and location documented; .gitignore entry for .taskgraph/sitrep-breadcrumb.json"
  - "Work skill Phase 0 flowchart includes breadcrumb branch (recent making_sitrep → skip to tasks)"
todos:
  - id: define-sitrep-breadcrumb-spec
    content: Define sitrep breadcrumb file format, location, and staleness rules
    agent: documenter
    changeType: document
    intent: |
      Define the sitrep breadcrumb so multiple /work instances coordinate without all generating a sitrep.
      Location: .taskgraph/sitrep-breadcrumb.json (repo root; git-ignored).
      Format: { "state": "making_sitrep" | "idle", "at": "ISO8601", "by": "work" }.
      Rules: (1) First thing every /work agent does (when no plan specified) is read this file. (2) If state is making_sitrep and at is within last 10 minutes → another agent is generating sitrep; skip sitrep, go straight to tg next and work. (3) If no sitrep or sitrep older than 30 min, and no recent making_sitrep breadcrumb → write breadcrumb (state making_sitrep, at now), then generate sitrep. (4) After generating sitrep, write breadcrumb state idle (or remove file). (5) When an agent returns from doing tasks (loop iteration or re-entry), check sitrep; if missing or stale (>30m), may write breadcrumb and generate new sitrep (cycle in/out). Document in docs/leads/README.md (Sitrep and Formation) and a short docs/leads/sitrep-breadcrumb.md or inline in execution.md.
    docs: [leads/README, multi-agent]

  - id: gitignore-sitrep-breadcrumb
    content: Add .taskgraph/sitrep-breadcrumb.json to .gitignore
    agent: implementer
    changeType: modify
    intent: |
      Add .taskgraph/sitrep-breadcrumb.json to .gitignore so ephemeral coordination state is not committed. File is written by /work instances and read by other instances; it must not be in version control.
    docs: [infra]

  - id: work-skill-phase0-breadcrumb-first
    content: Update work skill Phase 0 to breadcrumb-first flow
    agent: implementer
    changeType: modify
    blockedBy: [define-sitrep-breadcrumb-spec]
    intent: |
      In .cursor/skills/work/SKILL.md, rewrite Phase 0 so that the first step is always "Check sitrep breadcrumb" (read .taskgraph/sitrep-breadcrumb.json). If state is making_sitrep and at is within 10 min → skip sitrep generation, go straight to "Read existing sitrep" if present and recent, else go straight to task pull (tg next) and loop without full formation (or use minimal formation: execution-lead). If no recent making_sitrep: check for recent sitrep (< 30 min for staleness; user asked 30 min). If no sitrep or stale → write breadcrumb (making_sitrep, at now), dispatch sitrep-analyst, write sitrep file, then write breadcrumb state idle. Then read sitrep and self-select role. Update the mermaid decision tree to include breadcrumb check at top. Add "When returning from work" behavior: after completing tasks or on next loop top, agent may re-check sitrep; if missing or stale, write breadcrumb and generate (cycle in/out). Keep existing formation and role-selection logic.
    docs: [leads/execution, multi-agent]

  - id: execution-lead-doc-breadcrumb
    content: Update execution lead doc with Phase 0 breadcrumb steps
    agent: documenter
    changeType: document
    blockedBy: [work-skill-phase0-breadcrumb-first]
    intent: |
      In docs/leads/execution.md, update Self-Orientation (Phase 0) to list breadcrumb as step 1: (1) Read sitrep breadcrumb; if recent making_sitrep → skip generation and go to task pull or read existing sitrep. (2) Check for recent sitrep (< 30 min). (3) If none or stale, write breadcrumb making_sitrep, generate sitrep, write breadcrumb idle. (4) Read sitrep and self-select role. (5) Enter role workflow. Align with work skill wording.
    docs: [leads/README, execution]

  - id: multi-agent-doc-breadcrumb
    content: Document sitrep breadcrumb in multi-agent coordination
    agent: documenter
    changeType: document
    blockedBy: [define-sitrep-breadcrumb-spec]
    intent: |
      In docs/multi-agent.md, add a short section on sitrep breadcrumb: multiple /work instances check the breadcrumb first; one agent claims "making sitrep" so others skip generation and pull tasks; agents cycle in/out of coordination by re-checking sitrep when returning from work (stale = 30 min). Reference .taskgraph/sitrep-breadcrumb.json and the lead doc.
    docs: [multi-agent, leads/README]

  - id: run-full-suite-sitrep-breadcrumb
    content: Run full test suite (pnpm gate:full) and record result in evidence
    agent: implementer
    changeType: test
    blockedBy: [work-skill-phase0-breadcrumb-first, execution-lead-doc-breadcrumb, multi-agent-doc-breadcrumb]
    intent: |
      Run pnpm gate:full from repo root. Record result in tg done evidence. On failure, add tg note with summary and do not mark done until fixed or escalated.
    docs: [agent-contract]
---

# Work Skill Sitrep Breadcrumb Coordination

## Goal

Allow the user to fire multiple `/work` instances (e.g. four Composer windows, each running `/work`) so each becomes a collaborator without all racing to generate the same sitrep. The **first** agent to need a sitrep drops a **breadcrumb** ("making sitrep" + timestamp); any **later** agent sees that breadcrumb and skips sitrep generation, pulls the next task from the task graph, and works until done. When an agent returns (loop top or re-entry), it re-checks the sitrep; if there is none or it is **stale** (e.g. older than 30 minutes), that agent may take over and create a new sitrep (write breadcrumb → generate → continue). So agents **cycle in and out** of meta-coordination with fellow leads.

## Current behavior

- Phase 0: check for recent sitrep (< 1h); if none, dispatch sitrep-analyst and write sitrep; then read sitrep and self-select role.
- When multiple `/work` instances start at once, they can all see "no recent sitrep" and all dispatch sitrep-analyst, causing duplicate work and possible races.

## Desired behavior

1. **First thing every agent does** (when no plan specified): **Check the sitrep breadcrumb** (e.g. `.taskgraph/sitrep-breadcrumb.json`). This is the single source of "is someone already making a sitrep right now?"

2. **If breadcrumb says "making_sitrep" and timestamp is recent (e.g. &lt; 10 min):** Another agent is already generating the sitrep. **Skip sitrep generation.** Go straight to pulling tasks (`tg next`) and start working. Optionally read an existing sitrep file if present and recent for formation; otherwise enter as execution-lead and pull next task.

3. **If no recent "making_sitrep" breadcrumb:** Check for an existing sitrep. If **no sitrep or sitrep is stale (e.g. &gt; 30 min)**, this agent becomes the one who generates it: **write breadcrumb** (state `making_sitrep`, timestamp now), then dispatch sitrep-analyst and write the sitrep file; then clear or set breadcrumb to `idle`. Then read sitrep and self-select role as today.

4. **When returning from work:** After completing tasks (loop continues or agent re-enters), **re-check sitrep**. If missing or stale (&gt; 30 min), this agent may write the breadcrumb and generate a new sitrep, then continue. So coordination is **cyclic**: work on tasks → come back → refresh sitrep if needed → work again.

## Breadcrumb format (proposed)

- **Location:** `.taskgraph/sitrep-breadcrumb.json` (git-ignored).
- **Shape:** `{ "state": "making_sitrep" | "idle", "at": "2026-03-02T22:45:00Z", "by": "work" }`.
- **Staleness:** `making_sitrep` older than 10 minutes → treat as abandoned; any agent may overwrite and generate. Sitrep file older than 30 minutes → consider stale; agent may refresh.

## Dependency graph

```text
Parallel:
  ├── define-sitrep-breadcrumb-spec
  └── gitignore-sitrep-breadcrumb

After define-sitrep-breadcrumb-spec:
  ├── work-skill-phase0-breadcrumb-first
  └── multi-agent-doc-breadcrumb

After work-skill-phase0-breadcrumb-first:
  └── execution-lead-doc-breadcrumb

After execution-lead-doc-breadcrumb + multi-agent-doc-breadcrumb:
  └── run-full-suite-sitrep-breadcrumb
```

## Open questions

- **10 min vs 30 min:** making_sitrep expiry 10 min (so another agent can take over if first stalls); sitrep freshness 30 min (user said "half an hour" for when to refresh). Confirm in spec.
- **Idle vs delete:** After generating sitrep, write `state: "idle"` or remove file? Idle keeps a timestamp of "last generated"; remove is simpler. Spec task can decide.

<original_prompt>
User wants multiple /work instances to act as collaborators. First agent checks for sitrep; if none, drops a breadcrumb (timestamp + "making sitrep"). This breadcrumb is the first thing any agent checks — it tells them whether there's an immediate need to gain situational awareness given another agent is already making the sitrep. Next agent: skip sitrep, pull next task, work until done, then check sitrep again; if no sitrep or stale (&gt; 30 min), make a new sitrep (and breadcrumb). Cycle in/out coordinating with fellow leads. Add a plan to build this system.
</original_prompt>
