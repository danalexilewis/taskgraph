---
name: Strategic Cycle and Initiatives
overview: Add Cycle entity and Initiative hierarchy, make tg init interactive, auto-backfill 60+ projects into 5 themed initiatives, fix project_count, and update docs.
fileTree: |
  src/
  ├── db/
  │   └── migrate.ts                  (modify — add cycle table + initiative.cycle_id FK migrations)
  ├── cli/
  │   ├── index.ts                    (modify — register initiativeCommand + cycleCommand)
  │   ├── initiative.ts               (modify — add list subcommand, --cycle option for new, backfill subcommand)
  │   ├── cycle.ts                    (create — tg cycle new | list command)
  │   ├── status.ts                   (modify — fix project_count; add cycle/initiative banner to default view)
  │   └── init.ts                     (modify — wire migrations; add interactive cycle + initiative prompts)
  __tests__/
  └── integration/
      ├── cycle.test.ts               (create)
      └── initiative.test.ts          (modify — expand coverage)
  docs/
  ├── schema.md                       (modify — add cycle table, update initiative table)
  ├── glossary.md                     (modify — add Cycle, update Initiative)
  ├── cli-reference.md                (modify — add tg cycle, tg initiative sections)
  └── recommended-packages.md         (modify — add @clack/prompts)
risks:
  - description: Dolt FK enforcement on NULL cycle_id may behave unexpectedly
    severity: low
    mitigation: Use NULL initially; set NOT NULL only after backfill; follow same pattern as initiative_id on project
  - description: "@clack/prompts is a new dependency — check compatibility with Bun test runner"
    severity: low
    mitigation: Prompts only run in interactive tg init flow, not in tests; gate tests skip non-interactive paths
  - description: ensureMigrations vs init.ts drift — new migrations not wired into init.ts
    severity: medium
    mitigation: schema-cycle-migration explicitly covers both; init.ts must call each migration explicitly
  - description: Backfill keyword matching may misclassify some projects
    severity: low
    mitigation: Provide explicit plan_id-to-initiative mapping as primary; keyword fallback as secondary; user can reassign via tg initiative assign-project
tests:
  - "`tg cycle new <name> --start-date <date> --end-date <date>` creates a cycle row and exits 0 (owned by integration-tests)"
  - "`tg cycle list` returns the created cycle in human and --json mode (owned by integration-tests)"
  - "`tg initiative new --cycle <id>` sets cycle_id FK (owned by integration-tests)"
  - "`tg initiative list` shows cycle context alongside initiatives (owned by integration-tests)"
  - "`tg initiative backfill --cycle <id>` creates 5 initiatives and assigns all unassigned projects (owned by integration-tests)"
  - "`tg status --initiatives` shows real project_count > 0 after backfill (owned by integration-tests)"
  - "`tg status` default view shows cycle banner when a current cycle exists (owned by integration-tests)"
todos:
  - id: schema-cycle-migration
    content: "Add cycle table and initiative.cycle_id FK migrations; wire all initiative/cycle migrations into init.ts"
    agent: implementer
    changeType: modify
    docs: [schema]
    skill: dolt-schema-migration
    intent: |
      Create two new idempotent migrations in src/db/migrate.ts:

      1. `applyCycleMigration(repoPath, noCommit)` — creates the `cycle` table:
         - cycle_id CHAR(36) PRIMARY KEY
         - name VARCHAR(255) NOT NULL
         - start_date DATE NOT NULL
         - end_date DATE NOT NULL
         - created_at DATETIME NOT NULL
         - updated_at DATETIME NOT NULL
         Guard with `tableExists("cycle")`. End with doltCommit.

      2. `applyInitiativeCycleIdMigration(repoPath, noCommit)` — ALTER TABLE initiative
         ADD COLUMN cycle_id CHAR(36) NULL REFERENCES cycle(cycle_id).
         Guard with `columnExists("initiative", "cycle_id")`. End with doltCommit.

      Add both to the `ensureMigrations` chain (after the existing `applyInitiativeMigration`
      and `applyDefaultInitiativeMigration`).

      Also fix `init.ts`: currently it does NOT call `applyInitiativeMigration`,
      `applyPlanToProjectRenameMigration`, or `applyDefaultInitiativeMigration`. Add all four
      initiative/cycle migrations to the `tg init` explicit call chain in `src/cli/init.ts` so
      a fresh install has the full schema after `tg init`.

      Migration order in init.ts (after existing base migrations):
        applyInitiativeMigration → applyPlanToProjectRenameMigration →
        applyDefaultInitiativeMigration → applyCycleMigration →
        applyInitiativeCycleIdMigration

  - id: fix-initiative-project-count
    content: "Fix project_count in fetchInitiativesTableData — replace hardcoded 0 with real COUNT via LEFT JOIN"
    agent: implementer
    changeType: modify
    docs: [schema, cli]
    intent: |
      In src/cli/status.ts `fetchInitiativesTableData`, replace:
        `0 AS project_count`
      with a real subquery or LEFT JOIN on the `project` table grouped by initiative_id.

      The SQL should be:
        SELECT i.initiative_id, i.title, i.status, i.cycle_start, i.cycle_end,
          COUNT(p.plan_id) AS project_count
        FROM `initiative` i
        LEFT JOIN `project` p ON p.initiative_id = i.initiative_id
        [WHERE filter]
        GROUP BY i.initiative_id, i.title, i.status, i.cycle_start, i.cycle_end
        ORDER BY i.cycle_start ASC, i.title ASC

      This task is independent of the cycle schema work and can ship in parallel.

  - id: tg-cycle-command
    content: "Create src/cli/cycle.ts with tg cycle new | list subcommands; register in index.ts"
    agent: implementer
    changeType: create
    docs: [cli, cli-reference]
    skill: cli-command-implementation
    blockedBy: [schema-cycle-migration]
    intent: |
      Create src/cli/cycle.ts exporting `cycleCommand(program: Command)`.

      Subcommands:
        tg cycle new <name> --start-date <YYYY-MM-DD> --end-date <YYYY-MM-DD>
          - Generates a UUID cycle_id, inserts into cycle table.
          - Prints: "Cycle '<name>' created (id: <cycle_id>, <start> – <end>)"
          - Also accepts --weeks <n> as alternative to --end-date (computes end_date = start_date + n weeks).
          - Requires at least --start-date + one of --end-date | --weeks.
          - Exits non-zero on DB error.

        tg cycle list [--json]
          - SELECT cycle_id, name, start_date, end_date FROM cycle ORDER BY start_date DESC.
          - Human: table with columns Id (first 8 chars), Name, Start, End, Status (Active/Upcoming/Past based on CURDATE()).
          - JSON: full rows array.

      Register `cycleCommand` in src/cli/index.ts.

  - id: tg-initiative-wire
    content: "Wire initiativeCommand in index.ts; add initiative list subcommand; add --cycle option to initiative new; add assign-project subcommand"
    agent: implementer
    changeType: modify
    docs: [cli, cli-reference]
    skill: cli-command-implementation
    blockedBy: [schema-cycle-migration]
    intent: |
      1. Import and register `initiativeCommand` in src/cli/index.ts. Currently it exists in
         src/cli/initiative.ts but is never imported. This is the blocker for all initiative CLI work.

      2. Add `initiative list [--json]` subcommand to src/cli/initiative.ts:
         - SELECT initiative_id, title, status, cycle_start, cycle_end, cycle_id FROM initiative ORDER BY created_at DESC.
         - Human: table with columns Id (first 8), Title, Status, Cycle (name if cycle_id set, or dates if inline, or "—").
         - JSON: full rows array.
         - LEFT JOIN on cycle table if it exists to show cycle name.

      3. Add `--cycle <cycleId>` option to the existing `initiative new` subcommand:
         - Sets initiative.cycle_id = cycleId.
         - If --cycle is provided, derives cycle_start and cycle_end from the cycle row (so user doesn't need to pass them separately).
         - --cycle-start / --cycle-end still work as overrides.
         - Validate that the cycleId exists; return a clear error if not.

      4. Add `initiative assign-project <initiativeId> <planId>` subcommand:
         - UPDATE project SET initiative_id = <initiativeId>, updated_at = NOW() WHERE plan_id = <planId>
         - Validate both IDs exist; return clear errors if not.
         - Print: "Project <planId> assigned to initiative '<title>' (<initiativeId>)"
         - Support --json (return { ok: true, planId, initiativeId })
         - This is the manual reassignment tool for future use.

  - id: backfill-initiatives
    content: "Add tg initiative backfill --cycle <id> that auto-groups all projects into 5 themed initiatives"
    agent: implementer
    changeType: modify
    docs: [cli, schema]
    skill: cli-command-implementation
    blockedBy: [tg-initiative-wire]
    intent: |
      Add `initiative backfill --cycle <cycleId>` subcommand to src/cli/initiative.ts.

      This command:
        1. Checks if any real initiatives exist (i.e. rows in `initiative` besides the "Unassigned" sentinel
           with id = '00000000-0000-4000-8000-000000000000'). If real initiatives already exist, print a
           warning and exit 0 — do not re-run the backfill.
        2. Creates 5 initiatives in the `initiative` table (all linked to --cycle <cycleId>):
           - "Core Foundation"
           - "Planning and Import"
           - "Agent Workflow"
           - "Status and CLI"
           - "Platform and DX"
        3. Assigns ALL existing projects to their theme initiative using the mapping below.
           UPDATE project SET initiative_id = <id> WHERE plan_id IN (...)

      The mapping is a hardcoded lookup keyed by plan_id (exact match first; title keyword fallback
      for any projects not in the explicit list):

      Core Foundation (plan_ids):
        cc0a0604-2cbe-47e0-9881-19d7045a7e91  -- Task Graph Implementation
        9e440a8a-ac9a-4212-9b1c-c7c79ad37861  -- Thin SQL Query Builder
        edc50e28-d1c0-46af-b2da-0c156f404716  -- Fix remaining tsc errors
        c41e7989-b00e-4427-bd72-b292ebb21b8f  -- Fix Neverthrow TypeScript Errors
        30bceb27-2a13-4b2d-a7c9-689fc38ddf32  -- Fix Failing Tests Properly
        74847034-f13c-41b6-8ea7-091da031d096  -- Docs Tests Neverthrow
        ec60f9fd-8afc-488b-8a0e-95187e153a37  -- resolve_type_errors_taskgraph
        605d6d06-a82f-4d90-82c1-72862f057f33  -- Restructure package
        fdd78a98-becc-420f-81d3-2441cf58bdd4  -- Dolt Replication
        bed9394d-85eb-4439-a933-9f715af4235f  -- Dolt Branch Per Agent
        45ed6826-a4e3-48f1-af62-d0ee46a941a2  -- External Gates
        f377f032-10b8-4612-9167-a66f961ffa9a  -- Materialized Blocked Status from Edge Graph
        fb02d9f1-2143-402d-b16a-e578b7d96d85  -- Short Hash Task IDs

      Planning and Import (plan_ids):
        3137e4f4-230b-4f51-b38d-a225dd616309  -- Cursor Plan Import and Agent Workflow
        87ab79b2-1035-4cb0-8062-45e8d8ec6e69  -- Plan Import Robustness
        fa65b577-b7dc-47e8-ba2c-7edc857b0724  -- Import pre-flight and duplicate prevention
        a7cdac0c-43ab-4917-b8af-7a3113305957  -- Rich Planning
        05f4e74c-40b7-41a7-aab1-d8c4b127a526  -- Task Templates (Formulas)
        1aaf6f67-e72d-490a-9d2f-237451f8a2b0  -- Task Dimensions: domain, skill, change_type
        d3314a8d-7078-4d22-841f-6b5cf421a48a  -- Meta-Planning Skills
        7f7a063a-4e4a-404e-85ec-9abc40677873  -- Docs and Skills Auto-Assignment Pipeline
        3cf8e2e2-7cbc-4d07-95a0-bf4871e780bf  -- tg plan list
        6dbadd46-a0a6-4033-897d-e259cecb8af1  -- Export Markdown and tg status
        f28e4d6a-e919-4d07-b894-d37ed67d4c32  -- Agent field and domain-to-docs rename

      Agent Workflow (plan_ids):
        2e445031-90bb-4595-aa90-6f467a5e2248  -- Sub-Agent Profiles and Systematic Debugging
        88d81073-8d0a-4f29-a2c5-9799333ddd1b  -- Cursor Sub-Agent Specialization System
        26b5fdf4-8f6f-40e1-833c-638206315d3f  -- Orchestration UI and Batch Dispatch
        0433a59c-ae6a-4ec5-9bbe-95cdaff5f662  -- Sharpen Orchestrator Compliance
        c0ba7aa3-6ba2-40c0-9f33-a17d1ba7e647  -- Multi-Agent Centaur Support
        f99cbb4b-ba78-48ae-bd63-993845f138fd  -- Two-Stage Review
        051d9cb7-91b4-4573-9f7a-1e78b5c06085  -- Context Budget and Compaction
        de1f4893-7a91-4dc9-b1da-a69021334ae7  -- Tactical Escalation Ladder
        194506b8-1a9a-4c9b-8968-9b0df86af292  -- Implementer No Tests, Plan-End Add Tests and Gate
        afee9764-730e-4b4b-a6a3-15c3ab50d1e9  -- Agent Sync and Taskgraph Adoption
        541818b6-4999-4b51-99de-c29fb6b912ee  -- Agent and Leads Documentation
        78881d03-d45f-43d5-9ed3-bec72a906b84  -- Standardize Skills as Agentic Leads
        35a97ede-ddc6-4193-a1b3-d96d95e9f6b6  -- Fix Skill Name Consolidation

      Status and CLI (plan_ids):
        febb3e44-43f7-4b50-b2af-d4b827643332  -- Status Dashboard and Focused Domain Views
        04a7b378-6616-4e03-a536-622902a4f90d  -- Status Live TUI
        035c91ce-44e7-4647-908a-92138e073cdf  -- Status Polish and Auto-Complete Plans
        077578ba-6dcf-42c9-9166-4214a70f0e1e  -- Status Responsive and Color Enhancements
        4f260606-17f1-43d7-9376-4fb59141c935  -- Status Table Narrow Terminal Fix
        cb9b5ea9-88e8-4737-a084-877933ee9690  -- Dashboard as primary command
        1aeea234-a819-4b67-831b-ce8061e4e670  -- Merge status Active Work and Next Runnable
        ad793a72-3931-4b29-b1bf-aa6d72edbf70  -- Batch CLI operations
        0aa75f28-6f0a-413c-80f5-4602c0ad2cf2  -- add health-check skill and enhance status command
        26a0c3a1-2445-412b-9b7f-b62fd0b7435e  -- Integration Test Next Output Docs

      Platform and DX (plan_ids):
        02d720b2-5273-49f5-bdd8-c55dc459e79a  -- Publish TaskGraph to npm
        1bb54c3f-c0b2-48e5-a375-55015450dbc1  -- TaskGraph MCP Server
        16e51429-cb51-4fe0-864e-da7ee249cecf  -- Git Worktree Isolation
        f1d4114b-b459-4c19-ac44-4bb859d186e7  -- Worktrunk Integration
        a945775e-e947-412b-acc3-76c4a7bbc6e4  -- Migrate to Bun Test, Add Biome, Targeted Test Execution
        e3cd8e2a-c286-4857-9f65-f1607c3a9000  -- Integration Test Isolation Improvements
        5555005d-80fd-4239-bee4-e52012f0864c  -- Integration Test Performance and Harness Improvements
        4b08965d-b17a-4be7-8806-025147b0d83d  -- README Upgrade
        33aef644-4376-464a-9653-7e2ec8650eca  -- Docs Formalization - DDD Domain Docs as Knowledge Base
        7e2fa7f1-8199-4448-91e9-564c44abe5e7  -- Project Rules
        386dfde0-c8dd-45bf-91ea-1cec70a40df7  -- Post-Execution Reporting
        323d15fd-5cf4-4921-9bae-3e89a229fe89  -- Persistent Agent Stats
        9c4e5030-e0b4-4bdb-bd45-59efff7b8b46  -- Initiative-Project-Task Hierarchy

      Keyword fallback (for any projects not in the explicit list above):
        title contains "Status" | "Dashboard" | "TUI" | "CLI" | "Batch" → Status and CLI
        title contains "Agent" | "Review" | "Dispatch" | "Orchestrat" | "Skill" → Agent Workflow
        title contains "Plan" | "Import" | "Template" | "Dimension" → Planning and Import
        title contains "Dolt" | "Schema" | "Migration" | "Fix" | "Type" | "Test" → Core Foundation
        default → Platform and DX

      Output (human):
        Created initiative: Core Foundation (id: <id>)
        Created initiative: Planning and Import (id: <id>)
        ...
        Assigned 13 projects to Core Foundation
        Assigned 11 projects to Planning and Import
        ...
        Backfill complete. Run `tg status --initiatives` to review.

      Support --json (return array of { initiative, assignedCount }).
      Support --dry-run (print what would happen without writing to DB).

  - id: status-cycle-banner
    content: "Add cycle/initiative context banner to tg status default view"
    agent: implementer
    changeType: modify
    docs: [cli, cli-tables]
    skill: cli-command-implementation
    blockedBy: [tg-cycle-command, tg-initiative-wire]
    intent: |
      In src/cli/status.ts `printHumanStatus`, add a cycle banner at the top of the default
      dashboard view (not --tasks / --projects / --initiatives mode).

      Logic:
        1. Query: SELECT c.cycle_id, c.name, c.start_date, c.end_date,
                    COUNT(DISTINCT i.initiative_id) AS initiative_count
                  FROM cycle c
                  LEFT JOIN initiative i ON i.cycle_id = c.cycle_id
                  WHERE CURDATE() BETWEEN c.start_date AND c.end_date
                  GROUP BY c.cycle_id, c.name, c.start_date, c.end_date
                  LIMIT 1
        2. If no current cycle exists (table missing or no row): skip banner silently.
        3. If a current cycle is found: render a one-line banner above the existing sections:
             ◆ Cycle: Sprint 1  (Feb 24 – Mar 9)  │  5 initiatives
           Use chalk or the existing color helpers. Keep it compact — one line max.
        4. Graceful fallback: if cycle table doesn't exist yet (tableExists check), skip.

  - id: init-interactive
    content: "Make tg init interactive — prompt for cycle name, dates, and first initiative names using @clack/prompts"
    agent: implementer
    changeType: modify
    docs: [cli]
    skill: cli-command-implementation
    blockedBy: [tg-cycle-command, tg-initiative-wire]
    intent: |
      Install `@clack/prompts` (pnpm add @clack/prompts). Also add it to docs/recommended-packages.md
      under category "CLI prompts".

      After the existing Dolt init + migrations succeed in src/cli/init.ts, launch an interactive
      setup flow for first-time installs only (skip if a cycle already exists: check via
      `SELECT COUNT(*) FROM cycle` after migrations — if > 0, skip).

      Prompt sequence using @clack/prompts:
        intro("Task Graph setup")

        const cycleName = await text({
          message: "Name your first cycle",
          placeholder: "Sprint 1",
          defaultValue: "Sprint 1",
        })

        const startDate = await text({
          message: "Cycle start date (YYYY-MM-DD)",
          placeholder: format(new Date(), "yyyy-MM-dd"),
          defaultValue: format(new Date(), "yyyy-MM-dd"),
          validate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) ? undefined : "Use YYYY-MM-DD format",
        })

        const weeks = await text({
          message: "Cycle length in weeks",
          placeholder: "2",
          defaultValue: "2",
          validate: (v) => Number(v) > 0 ? undefined : "Must be a positive number",
        })

        const initiativeNames = await text({
          message: "Name your initiatives (comma-separated)",
          placeholder: "Core Foundation, Agent Workflow, Platform",
          hint: "You can add more later with `tg initiative new`",
        })

        outro("Done! Run `tg status` to see your cycle.")

      After prompts:
        - INSERT cycle row with the given name + start_date + computed end_date (start + weeks*7 days)
        - For each comma-split initiative name (trimmed, non-empty): INSERT initiative row with cycle_id

      If the user hits Ctrl-C (cancel), exit gracefully with a message:
        "Setup skipped. Run `tg cycle new` and `tg initiative new` to set up manually."

      Skip the interactive flow entirely when stdout is not a TTY (e.g. in CI or piped scripts).
      Use `process.stdout.isTTY` guard.

  - id: docs-update
    content: "Update schema.md, glossary.md, cli-reference.md, and recommended-packages.md"
    agent: documenter
    changeType: modify
    docs: [schema, glossary, cli-reference]
    intent: |
      1. docs/schema.md — Add a new `## Table: cycle` section with all columns. Update
         `## Table: initiative` to document the `cycle_id` FK column. Note the migration order.

      2. docs/glossary.md — Add "Cycle" definition: "A time-bounded planning period (e.g. 2 weeks)
         bounding one or more Initiatives. Created with `tg cycle new`." Update "Initiative" to
         reference Cycle: "A strategic goal/theme bounded by a Cycle, grouping one or more Projects."

      3. docs/cli-reference.md — Add sections for `tg cycle new`, `tg cycle list`,
         `tg initiative list`, `tg initiative assign-project`, and `tg initiative backfill`.
         Update `tg initiative new` to document `--cycle` option.
         Update `tg status` to mention the cycle banner.

      4. docs/recommended-packages.md — Add row for @clack/prompts:
         | CLI prompts | clack | `@clack/prompts` | Interactive terminal prompts (text, select, multiselect); use for tg init and other interactive flows. |

  - id: integration-tests
    content: "Integration tests for tg cycle, tg initiative, backfill, and tg status cycle banner"
    agent: implementer
    changeType: create
    docs: [testing]
    blockedBy: [backfill-initiatives, status-cycle-banner, init-interactive]
    intent: |
      Create __tests__/integration/cycle.test.ts (new):
        - tg cycle new "Sprint 1" --start-date 2026-02-24 --end-date 2026-03-09 exits 0, prints cycle id
        - tg cycle list returns the created cycle in human and --json mode
        - tg cycle new without required flags exits non-zero with helpful error

      Expand or create __tests__/integration/initiative.test.ts:
        - tg initiative new "Feature Work" --cycle <cycleId> sets cycle_id
        - tg initiative list shows the initiative with cycle context
        - tg initiative assign-project <initiativeId> <planId> updates project row
        - tg initiative backfill --cycle <cycleId> creates 5 initiatives and assigns projects
        - tg initiative backfill --dry-run prints plan without writing
        - tg status --initiatives shows project_count > 0 after backfill
        - tg status default view shows cycle banner when a current cycle row exists

      Follow existing integration test patterns (execa + fresh Dolt repo per test or shared fixture).
      See __tests__/integration/ for examples.
isProject: false
---

## Analysis

The system already has partial initiative support — the `initiative` table exists, migrations run, and `tg status --initiatives` is implemented — but three things are broken or missing:

1. `tg initiative` is never registered in `index.ts` (dead code)
2. `project_count` in the initiatives view is hardcoded to `0`
3. There is no `cycle` entity — only loose `cycle_start`/`cycle_end` date fields on `initiative`

This plan adds a first-class `cycle` table, interactive `tg init` onboarding, an auto-backfill command for the ~60 existing projects, and the full CLI surface for the Cycle → Initiative → Project → Task hierarchy.

### Backfill strategy

All 60+ existing projects are mapped to 5 initiatives by plan_id (explicit lookup embedded in the task intent). The `tg initiative backfill --cycle <id>` command creates the initiatives and bulk-assigns projects in one shot. A `--dry-run` flag lets users preview before committing. Manual reassignment remains available via `tg initiative assign-project`.

The 5 themes (with representative projects):
- **Core Foundation** — Task Graph Implementation, Thin SQL, Dolt Replication, Short Hash Task IDs
- **Planning and Import** — Cursor Plan Import, Rich Planning, Task Templates, Docs/Skills Auto-Assignment
- **Agent Workflow** — Sub-Agent Profiles, Two-Stage Review, Multi-Agent Centaur, Context Budget
- **Status and CLI** — Status Dashboard, Status Live TUI, Batch CLI, Health Check
- **Platform and DX** — Publish to npm, MCP Server, Worktrunk, Integration Test Infrastructure

## Dependency graph

```
Parallel start (2 unblocked):
  ├── schema-cycle-migration     (cycle table + initiative.cycle_id + wire init.ts)
  └── fix-initiative-project-count (fix 0 AS project_count — fully independent)

After schema-cycle-migration (2 parallel):
  ├── tg-cycle-command           (tg cycle new | list; register in index.ts)
  └── tg-initiative-wire         (register initiative; add list, --cycle, assign-project)

After tg-cycle-command + tg-initiative-wire (2 parallel):
  ├── status-cycle-banner        (cycle banner in tg status default view)
  └── init-interactive           (interactive tg init prompts via @clack/prompts)

After tg-initiative-wire:
  └── backfill-initiatives       (tg initiative backfill — create 5 initiatives, bulk-assign projects)

After all implementation (2 parallel):
  ├── docs-update                (schema.md, glossary.md, cli-reference.md, recommended-packages.md)
  └── integration-tests          (blocked by backfill + banner + init-interactive)
```

## Key design decisions

**Separate `cycle` table**: We add a `cycle` table with a `cycle_id` FK on `initiative`. The existing inline `cycle_start`/`cycle_end` fields stay as nullable overrides — backward compatible.

**Interactive `tg init`**: Uses `@clack/prompts` for a clean, guided first-run experience. The flow is skipped when: (a) a cycle already exists, (b) stdout is not a TTY (CI/piped). Ctrl-C exits gracefully with instructions for manual setup.

**Backfill is a CLI command, not a migration**: `tg initiative backfill` is idempotent (skips if real initiatives exist) and includes `--dry-run` so users can review before committing. The plan_id-to-initiative mapping is hardcoded in the command — this repo has a known set of ~60 projects and the themes are stable.

**`tg status --projects` naming unchanged**: The existing `--projects` flag and "Active Plans" section stay for backward compatibility. The cycle banner is additive.

<original_prompt>
We've still not got the system working with our idea for initiatives superseding projects. and that there being a strategic cycle within a task graph. where all initiatives are bounded by the cycle. For this to work we need to update our TaskGraph setup. Procedure. to ask the user to and just some names or other things. I guess it's just an onboarding or getting started workflow. actually, where In the ideal world, what should have happened is that the user would Name the cycle. I don't know how many weeks is it? And then... Um... They would name their initiatives for the first cycle, And... feature initiative they would name. their projects. Then they would work down from there, very similar to how a system already works. The issue is we have a system that's already working with projects and tasks have already been shipped. We need to kind of backfill it by creating some initiatives and associating the projects with different initiatives. and creating a cycle and associating the initiatives with the cycle. I think for the purposes of this Task Graph app. We'll make the cycle two weeks. Bye. And it started last Tuesday. Can you create a plan to implement these changes so that the system works as described.

[Follow-up]: tg init stays non-interactive — no lets make it interactive. that would be nice
[Follow-up]: Backfill is manual — lets just group projects by theme and make about 5 initiatives that they can be associated with
</original_prompt>
