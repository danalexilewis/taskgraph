---
name: Initiative-Project-Task Hierarchy
overview: |
  Introduce a three-level hierarchy (Initiative → Project → Task) into Task-Graph, replacing the
  current two-level Plan → Task model. Plans remain as the authoring/analysis artifact (markdown
  files); when imported they create Projects (the DB entity currently called "plan"). Initiatives
  are strategic containers scoped to a configurable strategic cycle. The setup flow gains an
  interactive onboarding experience that asks about cycle length and initial initiatives.
fileTree: |
  src/
  ├── domain/
  │   └── types.ts                          (modify — add Initiative, rename Plan→Project)
  ├── db/
  │   └── migrate.ts                        (modify — add initiative table, rename plan→project, new columns)
  ├── cli/
  │   ├── index.ts                          (modify — register initiative command)
  │   ├── setup.ts                          (modify — interactive onboarding: cycle + initiatives)
  │   ├── initiative.ts                     (create — tg initiative list/new/show)
  │   ├── project.ts                        (create — tg project list/new, replaces plan.ts)
  │   ├── plan.ts                           (modify — deprecation alias → project)
  │   ├── import.ts                         (modify — plan→project table refs, optional --initiative)
  │   ├── status.ts                         (modify — initiative rollup, plan→project terminology)
  │   ├── context.ts                        (modify — plan→project table refs)
  │   ├── show.ts                           (modify — plan→project table refs)
  │   ├── next.ts                           (modify — plan→project table refs, --initiative filter)
  │   ├── cancel.ts                         (modify — plan→project table refs, initiative cancel)
  │   ├── export.ts                         (modify — plan→project table refs)
  │   ├── note.ts                           (modify — plan→project refs if any)
  │   ├── portfolio.ts                      (modify — plan→project refs)
  │   ├── crossplan.ts                      (modify — rename to crossproject or alias)
  │   └── utils.ts                          (modify — Config type gains strategicCycle)
  ├── plan-import/
  │   ├── parser.ts                         (modify — parse initiative field from frontmatter)
  │   └── importer.ts                       (modify — plan_id→project_id refs)
  ├── export/
  │   └── markdown.ts                       (modify — plan→project table refs)
  docs/
  ├── schema.md                             (modify — document initiative, project tables)
  ├── cli-reference.md                      (modify — new commands, terminology)
  └── plan-format.md                        (modify — clarify plan files vs project entities)
  __tests__/
  ├── integration/
  │   ├── initiative.test.ts                (create)
  │   └── project-rename.test.ts            (create)
  └── plan-import/
      └── parser.test.ts                    (modify — initiative field parsing)
risks:
  - description: Renaming plan→project table in Dolt requires FK drop/recreate which may fail on older Dolt versions
    severity: high
    mitigation: Test migration on a copy of production DB first; migration is idempotent and checks table existence before acting
  - description: Large blast radius — every CLI command references "plan" in SQL and display text
    severity: high
    mitigation: Phase the work — schema migration first, then systematic CLI updates with backward-compat aliases
  - description: Existing 39 plans and 218 tasks must survive migration without data loss
    severity: high
    mitigation: Migration uses RENAME TABLE (atomic in MySQL/Dolt) and ALTER TABLE for FK updates; no data copy needed
  - description: Consumer repos using tg may break if plan table disappears
    severity: medium
    mitigation: Keep tg plan as a deprecated alias for tg project; migration handles the DB rename transparently
  - description: Interactive setup prompts may not work in CI/non-interactive environments
    severity: medium
    mitigation: All interactive prompts have --non-interactive flag with defaults; config can be set via JSON directly
tests:
  - "Migration creates initiative table with correct schema"
  - "Migration renames plan→project and updates FKs without data loss"
  - "Migration adds objectives, outcomes, outputs columns to project"
  - "Migration is idempotent — running twice is safe"
  - "tg initiative new creates initiative and stores in DB"
  - "tg initiative list shows initiatives with project rollup"
  - "tg import creates project (not plan) and links to initiative when --initiative provided"
  - "tg status shows initiative-level summary"
  - "tg plan list still works as alias for tg project list"
  - "Config strategicCycle field persists through setup"
  - "Parser extracts initiative field from plan frontmatter"
todos:
  - id: schema-initiative-table
    content: "Create initiative table and add strategic_cycle to config"
    intent: |
      Add the `initiative` table to the schema with: initiative_id (CHAR(36) PK), title (VARCHAR(255)),
      description (TEXT — what we're trying to achieve, success criteria, hypothesis), status
      (ENUM: draft, active, paused, done, abandoned), cycle_start (DATE NULL), cycle_end (DATE NULL),
      created_at, updated_at. Add `strategicCycle` field to Config type and config.json
      (e.g. { weeks: 16 } or { weeks: 8 }). The migration must be idempotent (check tableExists
      before CREATE). This runs BEFORE the plan→project rename so it has no FK dependencies yet.
    suggestedChanges: |
      In src/db/migrate.ts, add applyInitiativeMigration():
        CREATE TABLE IF NOT EXISTS `initiative` (
          initiative_id CHAR(36) PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          description TEXT NOT NULL,
          status ENUM('draft','active','paused','done','abandoned') DEFAULT 'draft',
          cycle_start DATE NULL,
          cycle_end DATE NULL,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL
        )
      In src/cli/utils.ts, extend Config: strategicCycle?: { weeks: number }
    domain: [schema, cli]
    skill: [cli-command-implementation]
    changeType: create

  - id: schema-rename-plan-to-project
    content: "Rename plan table to project and update all foreign keys"
    intent: |
      Rename the `plan` table to `project` using RENAME TABLE (atomic in MySQL/Dolt).
      Update FKs: task.plan_id stays as the column name for now (renamed in a later task)
      but the FK reference changes from plan(plan_id) to project(plan_id). Same for
      decision.plan_id. Add nullable `initiative_id` FK to project table pointing to
      initiative(initiative_id). Add new project columns: overview (TEXT NULL),
      objectives (JSON NULL — array of strings), outcomes (JSON NULL — array of strings),
      outputs (JSON NULL — array of strings). The existing plan.intent, plan.risks, plan.tests,
      plan.file_tree columns carry over unchanged. Migration must be idempotent: check if
      `project` table exists; if yes, skip. Must handle the case where `plan` table has
      triggers (no_delete_plan) — drop and recreate as no_delete_project.
    suggestedChanges: |
      In src/db/migrate.ts, add applyPlanToProjectRenameMigration():
        1. Check tableExists('project') — if true, skip
        2. Drop trigger no_delete_plan if exists
        3. RENAME TABLE `plan` TO `project`
        4. ALTER TABLE `project` ADD COLUMN initiative_id CHAR(36) NULL,
           ADD COLUMN overview TEXT NULL,
           ADD COLUMN objectives JSON NULL,
           ADD COLUMN outcomes JSON NULL,
           ADD COLUMN outputs JSON NULL,
           ADD FOREIGN KEY (initiative_id) REFERENCES initiative(initiative_id)
        5. ALTER TABLE `task` DROP FOREIGN KEY (find FK name first via information_schema),
           ADD FOREIGN KEY (plan_id) REFERENCES project(plan_id)
        6. ALTER TABLE `decision` — same FK update
        7. Recreate trigger no_delete_project
        8. Dolt commit
    blockedBy: [schema-initiative-table]
    domain: [schema]
    changeType: modify

  - id: domain-types-update
    content: "Update domain types: add Initiative schema, rename Plan to Project"
    intent: |
      In src/domain/types.ts: Add InitiativeSchema and Initiative type with fields matching
      the new table. Rename PlanSchema→ProjectSchema, Plan→Project, PlanStatus→ProjectStatus
      (keep PlanStatus as a deprecated alias export for backward compat). Add new fields to
      ProjectSchema: initiative_id (nullable uuid), overview (nullable string), objectives
      (nullable string array), outcomes (nullable string array), outputs (nullable string array).
      Update PlanRiskEntrySchema name if desired (it's used for project.risks now).
    blockedBy: [schema-rename-plan-to-project]
    domain: [schema]
    changeType: modify

  - id: cli-initiative-commands
    content: "Create tg initiative list/new/show commands"
    intent: |
      Create src/cli/initiative.ts with three subcommands:
      - `tg initiative new <title>` — interactive: prompts for description (what are you trying
        to achieve, what does success look like, what's the hypothesis). Options: --description
        for non-interactive. Creates initiative in DB with status=draft. If strategicCycle is
        configured, auto-sets cycle_start=today, cycle_end=today+cycle weeks.
      - `tg initiative list` — shows all initiatives with status, project count, task rollup
        (total/done/doing). Alias: `tg initiative ls`.
      - `tg initiative show <id>` — shows initiative details + its projects + task summary.
      Register in src/cli/index.ts.
    blockedBy: [domain-types-update]
    domain: [cli]
    skill: [cli-command-implementation]
    changeType: create

  - id: cli-project-command
    content: "Create tg project list/new commands, deprecate tg plan"
    intent: |
      Create src/cli/project.ts mirroring current plan.ts but querying `project` table.
      - `tg project list` — lists projects with initiative name if linked.
      - `tg project new <title>` — creates project, optional --initiative <id> to link.
      Update src/cli/plan.ts to be a thin alias that prints a deprecation notice and
      delegates to project commands. Register projectCommand in index.ts.
    blockedBy: [domain-types-update]
    domain: [cli]
    skill: [cli-command-implementation]
    changeType: create

  - id: cli-import-update
    content: "Update tg import to create projects and support --initiative flag"
    intent: |
      Update src/cli/import.ts: all SQL references change from `plan` table to `project` table.
      Add optional --initiative <id> flag — when provided, sets project.initiative_id on the
      created/found project. Update display text: "Created new project" instead of "Created new plan".
      The --plan flag name stays for backward compat (it finds/creates a project by title/id).
      Parse new frontmatter fields from plan files: overview, objectives, outcomes, outputs
      (parser.ts already needs updating — see parser task). Store them on the project record.
    blockedBy: [domain-types-update]
    domain: [cli]
    changeType: modify

  - id: cli-status-update
    content: "Update tg status for initiative rollup and project terminology"
    intent: |
      Update src/cli/status.ts: change all SQL from `plan` to `project` table. Add initiative
      summary section at the top when initiatives exist: shows each active initiative with
      project count and aggregate task progress. Change display text: "Plans: N" → "Projects: N".
      Add --initiative <id> filter option. The --plan flag stays as alias for --project.
    blockedBy: [domain-types-update]
    domain: [cli]
    changeType: modify

  - id: cli-remaining-commands-update
    content: "Update show, next, cancel, export, context, portfolio, crossplan, note for plan→project"
    intent: |
      Systematic update of all remaining CLI commands that reference the `plan` table:
      - show.ts: JOIN project instead of plan; display "Project:" instead of "Plan:"
      - next.ts: JOIN project; add --initiative filter; display project_title
      - cancel.ts: support canceling initiatives; update plan→project refs
      - export.ts: read from project table; update commit messages
      - context.ts: select from project table for file_tree/risks
      - portfolio.ts: update plan→project refs
      - crossplan.ts: rename concept to crossproject (keep crossplan as alias)
      - note.ts: update any plan refs
      Each file: find-replace `plan` table references in SQL, update display strings.
      Keep backward-compatible CLI flag names where they exist (--plan stays).
    blockedBy: [domain-types-update]
    domain: [cli]
    changeType: modify

  - id: importer-update
    content: "Update plan-import parser and importer for project model"
    intent: |
      Update src/plan-import/parser.ts: parse new optional frontmatter fields from plan files:
      `initiative` (string — initiative title or ID to link), `overview`, `objectives`, `outcomes`,
      `outputs`. Add these to ParsedPlan type. The `name` field in frontmatter still maps to
      project title.
      Update src/plan-import/importer.ts: change all `plan` table references to `project`.
      The function signature still takes planId (rename to projectId internally but keep
      external interface stable for now).
      Update src/export/markdown.ts similarly.
    blockedBy: [domain-types-update]
    domain: [schema, cli]
    changeType: modify

  - id: setup-interactive-onboarding
    content: "Enhance tg setup with strategic cycle and initiative onboarding"
    intent: |
      Enhance src/cli/setup.ts to add an interactive onboarding flow after file scaffolding:
      1. Ask "What is your strategic review cycle?" with examples (16 weeks, 8 weeks, 2 weeks).
         Store as strategicCycle: { weeks: N } in .taskgraph/config.json.
      2. Ask "What are your initial initiatives? (3-5 recommended)" — loop: prompt for title
         and description for each. Guide: "An initiative is a strategic goal. Describe what
         you're trying to achieve, what success looks like, and your hypothesis."
      3. Create each initiative in the DB with cycle dates based on strategicCycle.
      All prompts must work with --non-interactive flag (skips, uses defaults or flags).
      Use Node readline or prompts library (check what's already in deps).
    blockedBy: [cli-initiative-commands]
    domain: [cli]
    skill: [cli-command-implementation]
    changeType: modify

  - id: docs-update
    content: "Update schema.md, cli-reference.md, plan-format.md documentation"
    intent: |
      Update docs/schema.md: document initiative table, project table (renamed from plan),
      new columns (overview, objectives, outcomes, outputs, initiative_id), and the
      three-level hierarchy concept.
      Update docs/cli-reference.md: add tg initiative commands, update tg plan→tg project,
      document --initiative flags on import/status/next.
      Update docs/plan-format.md: clarify that plan files are authoring artifacts that produce
      projects in the DB. Document new optional frontmatter fields (initiative, overview,
      objectives, outcomes, outputs). Explain the Initiative → Project → Task hierarchy.
      Update .cursor/rules/plan-authoring.mdc: add initiative and project fields to the
      YAML structure example. Update terminology.
    blockedBy: [cli-status-update, cli-initiative-commands]
    domain: [cli]
    changeType: document

  - id: integration-tests
    content: "Add integration tests for initiative CRUD and plan→project migration"
    intent: |
      Create __tests__/integration/initiative.test.ts:
      - Test initiative creation, listing, showing
      - Test project linking to initiative
      - Test tg status with initiative rollup
      - Test tg import --initiative flag
      Create __tests__/integration/project-rename.test.ts:
      - Test that migration renames plan→project correctly
      - Test that existing data survives migration
      - Test that FKs work after rename
      - Test idempotency (run migration twice)
      Update __tests__/plan-import/parser.test.ts:
      - Test parsing initiative, overview, objectives, outcomes, outputs from frontmatter
    blockedBy: [cli-import-update, cli-initiative-commands]
    domain: [schema, cli]
    changeType: test

  - id: rules-and-templates-update
    content: "Update Cursor rules, agent templates, and AGENT.md for new terminology"
    intent: |
      Update template and rule files to reflect the new hierarchy:
      - .cursor/rules/taskgraph-workflow.mdc: plan→project terminology, add initiative workflow
      - .cursor/rules/session-start.mdc: tg status now shows initiatives
      - .cursor/rules/plan-authoring.mdc: clarify plan files vs projects, add initiative field
      - .cursor/rules/subagent-dispatch.mdc: update plan references to project
      - .cursor/rules/no-hard-deletes.mdc: add initiative to protected tables
      - src/template/AGENT.md: update terminology
      - src/template/.cursor/rules/: update all template rules
    blockedBy: [docs-update]
    domain: [cli]
    changeType: modify
---

# Analysis

## The Three-Level Hierarchy

This plan introduces a strategic hierarchy inspired by Linear's Initiatives → Projects → Issues model, adapted for Task-Graph's agent-driven workflow:

```
Initiative (strategic goal, time-bound to a cycle)
├── Project A (deliverable — was "plan" in DB)
│   ├── Task 1
│   ├── Task 2 (blocked by Task 1)
│   └── Task 3
├── Project B
│   ├── Task 4
│   └── Task 5
└── Project C
    └── Task 6
```

**Key distinction**: Plan files (`plans/*.md`) remain the authoring/analysis artifact. When imported via `tg import`, they create a **Project** in the database. The DB entity previously called `plan` becomes `project`.

## Strategic Cycle

The strategic cycle is a configurable time window (e.g. 16 weeks for Eddy Works, 8 weeks for Enspiral Forge). Initiatives are scoped to cycles. During `tg setup`, users declare their cycle length and initial initiatives.

## Parallel Execution Model

Initiatives, projects, and tasks all execute in parallel by default. The existing `edge` table handles task-level dependencies. We do NOT add initiative-level or project-level edge tables in this phase — task-level edges are sufficient because:

- Cross-project task dependencies already work via the edge table
- Initiative ordering is implicit (if all tasks in Initiative A must finish before Initiative B starts, you'd block B's first tasks on A's last tasks)
- Adding higher-level edges is a future enhancement if needed

## Migration Strategy

The migration is the riskiest part. We use Dolt's `RENAME TABLE` which is atomic:

1. Create `initiative` table (no dependencies)
2. `RENAME TABLE plan TO project` (atomic, preserves data)
3. Update FKs on `task` and `decision` to reference `project`
4. Add new columns to `project` (initiative_id, overview, objectives, outcomes, outputs)
5. Recreate no-delete triggers for `project` (replacing `plan` triggers)

All migrations are idempotent — safe to run multiple times.

## Backward Compatibility

- `tg plan list` → alias for `tg project list` (with deprecation notice)
- `--plan` flags on commands → kept, internally resolve to project
- Plan files in `plans/` → unchanged, still the authoring format
- `tg import --plan` → still works, creates a project

## Dependency Graph

```
Parallel start (1 unblocked):
  └── schema-initiative-table

After schema-initiative-table:
  └── schema-rename-plan-to-project

After schema-rename-plan-to-project:
  └── domain-types-update

After domain-types-update (4 parallel):
  ├── cli-initiative-commands
  ├── cli-project-command
  ├── cli-import-update
  ├── cli-status-update
  ├── cli-remaining-commands-update
  └── importer-update

After cli-initiative-commands:
  └── setup-interactive-onboarding

After cli-status-update + cli-initiative-commands:
  └── docs-update

After cli-import-update + cli-initiative-commands:
  └── integration-tests

After docs-update:
  └── rules-and-templates-update
```

## Open Design Decisions (resolved)

**Q: Should we rename `plan_id` column to `project_id` in task and decision tables?**
A: Not in this phase. Column rename in Dolt requires creating a new column, copying data, dropping old, which is risky with 218+ tasks. The column name `plan_id` is an internal detail; the table name change (`project`) is what matters for the conceptual model. We can rename the column in a follow-up if desired.

**Q: Should initiatives have their own edge/dependency table?**
A: No. Task-level edges are sufficient. Cross-initiative dependencies are expressed as task-to-task edges. This keeps the model simple and the execution engine unchanged.

**Q: What happens to the 39 existing plans?**
A: They become projects with `initiative_id = NULL`. Users can link them to initiatives later via `tg project link <projectId> --initiative <initiativeId>` (or during import with `--initiative`).

**Q: Should `tg plan` command be removed?**
A: No — kept as deprecated alias. Plan files are still created and imported; only the DB entity changes name.

<original_prompt>
Introduce a three-level hierarchy (Initiative → Project → Task) into Task-Graph. Plans remain as authoring artifacts; when imported they create Projects. Initiatives are strategic containers scoped to a configurable strategic cycle. Setup flow gains interactive onboarding for cycle length and initial initiatives. Existing plan data migrates to project table.
</original_prompt>
