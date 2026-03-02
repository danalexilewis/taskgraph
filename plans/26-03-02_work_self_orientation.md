---
name: Work Self-Orientation and Micro-Cluster Formation
overview: Redesign /work to self-orient via a Situation Report before execution, support lead role selection, and enable micro-cluster coordination across multiple /work instances.
fileTree: |
  .cursor/
  ├── skills/
  │   └── work/
  │       └── SKILL.md                     (modify - add self-orientation phase)
  ├── rules/
  │   └── available-agents.mdc             (modify - add lead cardinality)
  ├── agents/
  │   └── sitrep-analyst.md                (create - sitrep generation prompt)
  docs/
  ├── leads/
  │   ├── README.md                        (modify - add formation concept)
  │   └── execution.md                     (modify - add self-orientation)
  ├── agent-strategy.md                    (modify - add micro-cluster model)
  └── multi-agent.md                       (modify - add formation/slots)
  reports/
  └── sitrep-YYYY-MM-DD-HHmm.md           (runtime output)
risks:
  - description: Multiple /work instances racing to generate the same sitrep
    severity: low
    mitigation: Advisory staleness check; idempotent generation means overwrites are safe. First writer wins, others reuse.
  - description: Self-orientation adds latency before first task dispatch
    severity: medium
    mitigation: Sitrep reuse (< 1h) skips generation entirely. Generation uses fast sub-agent. Explicit plan scoping bypasses sitrep.
  - description: Formation model adds complexity without immediate multi-instance benefit
    severity: low
    mitigation: Phase 1 is single-orchestrator only; formation is informational. Slot claiming deferred to Phase 2.
  - description: Existing /work callers (with explicit plan) should not be slowed down
    severity: medium
    mitigation: Self-orientation only triggers when /work is called without a specific plan or directive. Explicit plan -> skip sitrep.
tests:
  - "Sitrep generation produces valid markdown with required sections (formation, workload, suggested order)"
  - "Staleness check correctly reuses sitrep under 1 hour old"
  - "Self-orientation phase selects appropriate lead role based on sitrep"
  - "Explicit plan invocation bypasses sitrep entirely"
todos:
  - id: define-sitrep-schema
    content: "Define sitrep report schema and file convention"
    agent: documenter
    intent: |
      Create the canonical sitrep format that all /work instances will read and write.

      File convention: `reports/sitrep-YYYY-MM-DD-HHmm.md` (timestamped to the minute).

      Required frontmatter:
      ```yaml
      ---
      type: sitrep
      generated_at: "2026-03-02T14:30:00Z"
      generated_by: "<agent-name>"
      ---
      ```

      Required sections in the body:
      1. **Project Landscape** - Active initiatives, projects, their status (from tg status --projects, --initiatives)
      2. **Workload Snapshot** - Doing tasks and owners, runnable tasks by plan, blocked tasks and reasons (from tg status --tasks, tg next --json)
      3. **Cross-Plan Analysis** - File conflicts, domain clusters, ordering recommendations (from tg crossplan summary --json or manual)
      4. **Health and Risks** - Stale doing tasks, recent failures, gate status, known issues (from tg stats, memory)
      5. **Formation** - Recommended lead roles to fill (see formation schema below)
      6. **Suggested Work Order** - Up to 3 prioritized work streams, each with: stream name, lead role, key tasks, rationale

      Formation section schema:
      ```yaml
      formation:
        - role: execution-lead
          cardinality: 1-3
          description: "Grinds through plan tasks"
          suggested: 2
          plans: ["Plan A", "Plan B"]
        - role: overseer
          cardinality: 0-1
          description: "Monitors active agents, detects stalls, manages formation"
          suggested: 1
        - role: investigator-lead
          cardinality: 0-1
          description: "Handles gate failures and debug clusters"
          suggested: 0
      ```

      Document this in docs/leads/README.md under a new "Sitrep and Formation" section.
      Also update docs/agent-strategy.md with a new "Micro-Cluster Model" section explaining
      how multiple /work instances coordinate via the sitrep as shared state.
    changeType: modify
  - id: define-lead-roles
    content: "Document lead role cardinality and self-selection rules"
    agent: documenter
    intent: |
      Update `.cursor/rules/available-agents.mdc` and `docs/leads/README.md` to formalize
      lead roles with cardinality constraints.

      Lead roles (for the formation model):

      | Role | Cardinality | Description | Self-selects when |
      |------|-------------|-------------|-------------------|
      | execution-lead | 1-N | Grinds through plan tasks via implementer dispatch | Runnable tasks exist; no other execution-lead on same plan |
      | overseer | 0-1 | Monitors active agents, detects stalls, manages sitrep refresh | 2+ execution-leads active; no overseer claimed |
      | investigator-lead | 0-1 | Handles gate:full failures, debug clusters | gate:full failed; no investigator-lead active |
      | planner-lead | 0-1 | Runs /plan for queued initiatives/requests | Unplanned initiatives exist; no planner-lead active |

      Self-selection algorithm (for a /work instance reading the sitrep):
      1. Read sitrep formation section
      2. Read tg status --tasks to see which roles are currently filled (doing tasks with agent names)
      3. Pick the highest-priority unfilled role:
         a. If gate:full just failed and no investigator-lead -> become investigator-lead
         b. If 2+ execution-leads active and no overseer -> become overseer
         c. If runnable tasks exist for an unclaimed plan -> become execution-lead for that plan
         d. If nothing runnable but unplanned work exists -> become planner-lead
         e. If nothing to do -> report "all clear" and exit

      The human decides how many /work instances to spawn. Each instance reads the sitrep
      and self-selects. The first instance always becomes execution-lead (most common need).

      Add this to available-agents.mdc as a new "Lead Roles and Formation" section.
    changeType: modify
  - id: create-sitrep-analyst
    content: "Create sitrep-analyst agent template for situational awareness"
    agent: implementer
    intent: |
      Create `.cursor/agents/sitrep-analyst.md` - a read-only sub-agent that generates
      the situation report.

      The sitrep-analyst combines aspects of:
      - Session-start orientation (tg status --tasks)
      - Meta skill (crossplan analysis)
      - Investigate skill (docs scan, health check)

      Input contract:
      - No special input needed; the analyst gathers everything from CLI commands

      Workflow:
      1. Run `tg status --tasks --json` -> task landscape
      2. Run `tg status --projects --json` -> project landscape
      3. Run `tg status --initiatives --json` -> initiative landscape (if table exists)
      4. Run `tg next --json --limit 50` -> runnable tasks, file trees, risks
      5. Run `tg crossplan summary --json` -> cross-plan analysis (if available)
      6. Run `tg stats --json` -> agent metrics
      7. Scan reports/ for recent reports (last 24h) -> context
      8. Read .cursor/memory.md -> active quirks and known issues

      Output contract:
      Return the sitrep as structured markdown matching the schema from define-sitrep-schema.
      Include the formation recommendation based on:
      - Number of runnable tasks (more tasks -> more execution-leads)
      - Number of active plans (spread across plans)
      - Whether gate failures exist (suggest investigator-lead)
      - Whether doing tasks exist without recent heartbeats (suggest overseer)

      Model: inherit (session model) for reasoning quality.
      Permission: read-only.

      File: `.cursor/agents/sitrep-analyst.md`
    suggestedChanges: |
      Follow the prompt template pattern from planner-analyst.md.
      Include a prompt template section with {{TASK_STATUS}}, {{PROJECT_STATUS}},
      {{RUNNABLE_TASKS}}, {{CROSSPLAN}}, {{STATS}}, {{RECENT_REPORTS}}, {{MEMORY}} placeholders.
    changeType: create
  - id: implement-sitrep-generation
    content: "Add sitrep generation and staleness check to work skill"
    agent: implementer
    blockedBy: [define-sitrep-schema, create-sitrep-analyst]
    intent: |
      Modify `.cursor/skills/work/SKILL.md` to add a self-orientation phase at the
      very beginning of the skill, BEFORE the existing "Before the loop" section.

      New section: "## Phase 0: Self-Orientation (when no plan specified)"

      This phase runs ONLY when /work is called without a specific plan or directive.
      When the user says "/work on Plan X" or "/work" after just creating a plan,
      skip Phase 0 entirely and go straight to "Before the loop".

      Phase 0 workflow:

      ```
      1. Check for recent sitrep:
         - Glob reports/sitrep-*.md
         - Parse generated_at from frontmatter of most recent
         - If generated_at < 1 hour ago -> use it (skip to step 3)

      2. Generate fresh sitrep:
         - Dispatch sitrep-analyst (readonly=true, session model)
         - Write output to reports/sitrep-YYYY-MM-DD-HHmm.md
         - Log: "[work] Generated fresh sitrep: reports/sitrep-..."

      3. Read sitrep and self-select role:
         - Parse formation section
         - Run self-selection algorithm (from define-lead-roles)
         - Log: "[work] Self-selected role: <role> for <plan/scope>"

      4. Enter role-specific workflow:
         - execution-lead -> existing work loop (with plan from sitrep suggestion)
         - overseer -> watchdog protocol (monitor other agents, refresh sitrep)
         - investigator-lead -> hunter-killer dispatch for active failures
         - planner-lead -> /plan skill for the suggested initiative/request
      ```

      Decision tree update (add before existing tree):

      ```mermaid
      flowchart TD
          W["/work invoked"] --> X{Plan specified?}
          X -->|Yes| Y[Skip Phase 0 -> existing loop]
          X -->|No| Z{Recent sitrep exists?}
          Z -->|Yes, < 1h| AA[Read existing sitrep]
          Z -->|No| AB[Dispatch sitrep-analyst]
          AB --> AC[Write sitrep to reports/]
          AC --> AA
          AA --> AD[Self-select role from formation]
          AD --> AE{Selected role}
          AE -->|execution-lead| Y
          AE -->|overseer| AF[Watchdog/monitor mode]
          AE -->|investigator-lead| AG[Hunter-killer mode]
          AE -->|planner-lead| AH[/plan mode]
      ```

      Keep the existing work loop entirely intact. Phase 0 is purely additive -
      it decides WHAT to do, then delegates to the existing machinery.
    changeType: modify
  - id: update-multi-agent-docs
    content: "Update multi-agent and strategy docs with micro-cluster model"
    agent: documenter
    intent: |
      Update `docs/multi-agent.md` and `docs/agent-strategy.md` to document the
      micro-cluster coordination model.

      In docs/agent-strategy.md, add a new section "## Micro-Cluster Model" after
      the existing "Hive coordination" section:

      The micro-cluster model extends the centaur model for scenarios where the human
      spawns multiple /work instances. Key principles drawn from production multi-agent
      patterns:

      1. **Shared situation report** - All instances read the same sitrep (reports/sitrep-*.md)
         as coordination state. This is the "shared task list" pattern from Claude Code teams
         and the "publish + observe" pattern already in our centaur model.

      2. **Fresh agent per role** - Each /work instance starts with clean context and
         self-selects a role. This follows the "fresh subagent per task" pattern from
         OpenAI Swarm and Cursor's parallel agent approach. No context pollution across roles.

      3. **Coordinator never executes** - The overseer role (when filled) monitors and
         coordinates but never implements. This is the "coordinator-worker topology" from
         Swarm Tools and our existing orchestrator principle.

      4. **Formation over negotiation** - Agents don't negotiate roles with each other.
         The sitrep defines the formation; each agent claims a slot. This avoids the
         "peer-to-peer mesh" anti-pattern that's hard to debug at small scale.

      5. **Cardinality constraints** - Each role has min/max instances. This prevents
         over-allocation (3 overseers, 0 implementers) and under-allocation.

      In docs/multi-agent.md, add a "## Formation and Slots" section documenting:
      - How formation is defined in the sitrep
      - How slots are claimed (advisory, not locked)
      - How the human controls cluster size (number of /work invocations)
      - Relationship to existing tg status --tasks / doing tasks
    changeType: modify
  - id: update-execution-lead-doc
    content: "Update execution lead doc with self-orientation"
    agent: documenter
    blockedBy: [define-sitrep-schema, define-lead-roles]
    intent: |
      Update `docs/leads/execution.md` to reflect the new self-orientation phase.

      Add a new section "## Self-Orientation (Phase 0)" before the existing "## Pattern":

      When /work is invoked without a specific plan:
      1. Check for recent sitrep (< 1h in reports/)
      2. Generate or reuse sitrep
      3. Self-select lead role from formation
      4. Enter role-specific workflow

      Update the "## Pattern" section to note that the loop now has a Phase 0
      that precedes the existing steps.

      Update "## Input" to include:
      - **No input (default)** - Self-orient via sitrep, pick role and plan
      - **Plan name** (single plan) - Skip sitrep, execute that plan
      - **Multi-plan** - Skip sitrep, work across all active plans

      Update "## When" to include:
      - /work (no args) -> self-orient, then execute
      - /work (with plan context) -> execute directly
    changeType: modify
  - id: add-tests-sitrep
    content: "Add tests for sitrep staleness check and role selection logic"
    agent: implementer
    blockedBy: [implement-sitrep-generation]
    intent: |
      The sitrep generation and role selection are skill-level (markdown instructions),
      not code. But we should add a lightweight test or validation script that:

      1. Validates sitrep format - given a sample sitrep markdown file, check that
         required sections exist (Project Landscape, Workload Snapshot, Formation, etc.)
      2. Validates formation schema - check that formation entries have role, cardinality,
         suggested fields
      3. Validates staleness logic - given a generated_at timestamp, correctly determine
         if it's < 1 hour old

      Create `__tests__/skills/sitrep-validation.test.ts` with these checks.
      This is a unit test that validates the sitrep contract, not the generation itself.

      Keep it simple - parse markdown, check section headers, parse YAML frontmatter.
      Use bun:test.
    changeType: create
  - id: run-full-suite
    content: "Run full test suite (pnpm gate:full) and record result"
    agent: implementer
    blockedBy:
      [
        implement-sitrep-generation,
        update-multi-agent-docs,
        update-execution-lead-doc,
        add-tests-sitrep,
      ]
    intent: |
      Run `pnpm gate:full` from the plan worktree and record the result as evidence.
      This validates that the skill and doc changes don't break existing functionality.
    changeType: modify
---

# Analysis

## Why this approach

The current `/work` skill has a gap: when called without a specific plan, it jumps straight into `tg next --json` (multi-plan mode) and starts grinding. There's no step where it assesses the overall situation, decides what's most important, or coordinates with other potential `/work` instances.

This is fine for a single-agent, single-plan workflow. But as the project grows (multiple plans, initiatives, and the possibility of the human spawning multiple `/work` sessions), the skill needs a "look before you leap" phase.

### Patterns drawn from external agentic systems

**OpenAI Swarm — Routines and Handoffs**: Swarm's key insight is that agent coordination should be lightweight. Agents follow "routines" (instruction sets) and "hand off" to each other based on expertise. Our formation model mirrors this: the sitrep defines routines (role descriptions), and self-selection is a form of handoff (the agent picks the routine that matches the situation).

**Cursor Parallel Agents**: Cursor runs up to 8 agents in parallel with git worktree isolation. The key learning is that fresh agents per task outperform context-accumulating agents. Our model follows this: each `/work` instance starts fresh, reads the sitrep for shared context, and picks a clean role.

**Swarm Tools — Coordinator-Worker Topology**: The coordinator pattern (one agent orchestrates, others execute) maps directly to our overseer role. The coordinator "decomposes tasks, assigns them to workers, monitors progress, handles conflicts, and aggregates results — but crucially never performs the work itself."

**Claude Code Agent Teams**: The experimental "teammates" feature shows that direct communication through shared task lists is more effective than reporting through a central intermediary. Our sitrep serves as this shared task list — all `/work` instances read it, and the task graph (`tg status`, `tg next`) provides the live coordination layer.

**Anti-pattern avoidance**: Research consistently shows that beyond 5 agents, monitoring complexity explodes. Our formation model caps roles (overseer = max 1, investigator-lead = max 1) and lets the human decide total cluster size. The sitrep's formation section makes the recommended size explicit so the human can make an informed decision.

### What stays the same

The entire existing `/work` loop is untouched. Phase 0 is purely additive — it runs before the loop and decides which mode to enter. If you call `/work` with a plan, Phase 0 is skipped entirely.

### What's new

1. **Sitrep** — A timestamped report combining meta, investigate, and status data
2. **Formation** — A recommended set of lead roles with cardinality
3. **Self-selection** — Each `/work` instance picks an available role
4. **Role-specific entry** — Different roles enter different workflows (execution loop, watchdog, hunter-killer, planner)

## Dependency graph

```
Parallel start (2 unblocked):
  ├── define-sitrep-schema (documenter - sitrep format and formation schema)
  └── define-lead-roles (documenter - cardinality and self-selection rules)

After define-sitrep-schema + define-lead-roles:
  ├── create-sitrep-analyst (implementer - agent template)
  └── update-execution-lead-doc (documenter - lead doc update)

After create-sitrep-analyst:
  └── implement-sitrep-generation (implementer - work skill modification)

Parallel with implement-sitrep-generation:
  └── update-multi-agent-docs (documenter - strategy and multi-agent docs)

After implement-sitrep-generation:
  └── add-tests-sitrep (implementer - validation tests)

After all above:
  └── run-full-suite (implementer - gate:full)
```

## Mermaid diagram — Self-orientation flow

```mermaid
flowchart TD
    A["/work invoked"] --> B{Plan or directive specified?}
    B -->|Yes| C[Skip Phase 0]
    C --> D[Existing work loop]

    B -->|No| E[Phase 0: Self-Orientation]
    E --> F{Recent sitrep < 1h?}
    F -->|Yes| G[Read existing sitrep]
    F -->|No| H[Dispatch sitrep-analyst]
    H --> I[Write sitrep to reports/]
    I --> G

    G --> J[Parse formation]
    J --> K[Self-select role]
    K --> L{Selected role}

    L -->|execution-lead| D
    L -->|overseer| M[Watchdog/monitor mode]
    L -->|investigator-lead| N[Hunter-killer mode]
    L -->|planner-lead| O["/plan mode"]
```

## Micro-cluster formation example

Human spawns 3 `/work` instances for a project with 2 active plans and 15 runnable tasks:

```
Instance 1 (first to start):
  - Generates sitrep (none exists)
  - Formation suggests: 2 execution-leads, 1 overseer
  - Self-selects: execution-lead for Plan A (most runnable tasks)
  - Enters work loop for Plan A

Instance 2 (starts 30s later):
  - Reads existing sitrep (< 1h)
  - Sees: 1 execution-lead active (Plan A), overseer slot open
  - Self-selects: execution-lead for Plan B (unclaimed plan)
  - Enters work loop for Plan B

Instance 3 (starts 1min later):
  - Reads existing sitrep (< 1h)
  - Sees: 2 execution-leads active, overseer slot open
  - Self-selects: overseer
  - Enters watchdog/monitor mode
  - Periodically refreshes sitrep, monitors stalls, manages formation
```

## Open questions

1. **Overseer implementation depth** — Phase 1 defines the overseer role conceptually. The actual overseer workflow (beyond the existing watchdog protocol) needs design. Should it be a separate skill or a mode within /work? Current plan: mode within /work, leveraging existing watchdog protocol + sitrep refresh.

2. **Planner-lead scope** — When a /work instance becomes planner-lead, it essentially runs /plan. Should it auto-import and then switch to execution-lead? Current plan: yes, after planning completes, re-read sitrep and re-select role.

3. **Sitrep refresh frequency** — The overseer refreshes the sitrep. How often? Current plan: every 15 minutes or when a plan completes, whichever is sooner.

<original_prompt>
lets review the /work skill.

what should it do when I call it without any other directions?

what I want it to do is start with /meta and workout what is gonig on in the project. push this into a report.

if there is a report writ that is less then 1 hour old, then just use that as a source of truth for meta awareness.

The report should likely include some sort of suggested order of work. maybe for up to three leads to do.

If the work agent sees this in the report it should be able te see which spots are available to fill. THere could also be a category like implementor that can have x agent added. where as maybe one like overseer/watchdog there should be only one.

Its up to the human to decide how many leads to make. But the /work should self orientate in to decide what it should be based on current context.

/plan and draw on other fantastic agentic programmers patterns for creating high performance agentic teams/micro clusters
</original_prompt>
