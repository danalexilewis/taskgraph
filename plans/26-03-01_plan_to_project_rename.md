---
name: Plan to Project Rename
overview: Systematically rename "plan" to "project" throughout the codebase where it refers to the task-graph entity, keeping "plan" only for markdown strategic documents in plans/.
fileTree: |
  src/
  ├── cli/
  │   ├── index.ts              (modify - register projectCommand)
  │   ├── plan.ts               (modify - rename to project.ts or rename exports)
  │   ├── next.ts               (modify - --plan to --project)
  │   ├── show.ts               (modify - output labels)
  │   ├── status.ts             (modify - --plan to --project, field names)
  │   ├── import.ts             (modify - --plan to --project)
  │   ├── export.ts             (modify - --plan to --project)
  │   ├── task.ts               (modify - --plan to --project)
  │   ├── template.ts           (modify - --plan to --project)
  │   ├── cancel.ts             (modify - --plan to --project)
  │   ├── stats.ts              (modify - --plan to --project, fix plan view usage)
  │   ├── dashboard.ts          (modify - plan references)
  │   ├── crossplan.ts          (modify - output labels and field names)
  │   ├── context.ts            (modify - --plan to --project)
  │   ├── done.ts               (modify - plan references)
  │   ├── split.ts              (modify - plan references)
  │   ├── table.ts              (modify - plan column headers)
  │   └── tui/boxen.ts          (modify - plan labels)
  ├── domain/
  │   ├── types.ts              (modify - PlanSchema to ProjectSchema, etc.)
  │   ├── errors.ts             (modify - PLAN_NOT_FOUND to PROJECT_NOT_FOUND)
  │   ├── plan-completion.ts    (modify - rename function and params)
  │   ├── hash-id.ts            (modify - rename function)
  │   └── token-estimate.ts     (modify - plan_id param)
  ├── db/
  │   └── migrate.ts            (modify - keep migration functions, update comments)
  ├── plan-import/
  │   ├── importer.ts           (modify - variable names, comments)
  │   └── parser.ts             (modify - type names where they mean project)
  ├── export/
  │   ├── markdown.ts           (modify - PlanRow to ProjectRow, etc.)
  │   ├── dot.ts                (modify - plan references)
  │   ├── mermaid.ts            (modify - plan references)
  │   └── graph-data.ts         (modify - plan references)
  ├── mcp/
  │   └── tools.ts              (modify - activePlans to activeProjects, etc.)
  └── skills/
      └── health-check/         (modify - plan references)
  __tests__/
  ├── integration/              (modify - --plan to --project in CLI calls)
  ├── domain/                   (modify - type and error renames)
  ├── cli/                      (modify - field name changes)
  └── mcp/                      (modify - field name changes)
risks:
  - description: Breaking consuming projects that use tg plan or --plan flags
    severity: high
    mitigation: Add deprecated aliases for tg plan command and --plan flag during transition; document in CHANGELOG
  - description: Large number of files touched increases merge conflict risk
    severity: medium
    mitigation: Phase the work so CLI+domain+tests land together, docs/rules/templates as a separate wave
  - description: MCP consumers break when field names change (activePlans to activeProjects)
    severity: medium
    mitigation: Keep old field names as deprecated aliases in MCP output for one version
  - description: Integration tests fail if CLI changes and test updates are out of sync
    severity: medium
    mitigation: Update tests in same task as the CLI/domain changes they exercise
tests:
  - "All existing integration tests pass with --project flag (task: update-integration-tests)"
  - "tg project list and tg project new work correctly (task: rename-cli-commands)"
  - "Deprecated tg plan alias still works (task: rename-cli-commands)"
  - "MCP tools return activeProjects field (task: rename-mcp-fields)"
  - "Domain types Project and PROJECT_NOT_FOUND are used throughout (task: rename-domain-types)"
todos:
  - id: rename-cli-commands
    content: "Rename tg plan command to tg project with deprecated plan alias"
    agent: implementer
    intent: |
      Rename the CLI command from `tg plan` to `tg project`. The file `src/cli/plan.ts` should be
      renamed to `src/cli/project.ts`. The exported function `planCommand` becomes `projectCommand`.

      In `src/cli/index.ts`, update the import and call to use `projectCommand`.

      The command should register as `tg project` with subcommands `list` (alias `ls`) and `new`.
      Add `tg plan` as a deprecated alias that still works but prints a deprecation warning to stderr.

      Update all user-facing strings: "Manage plans" -> "Manage projects", "List plans" -> "List projects",
      "Create a new plan" -> "Create a new project", "Plans:" -> "Projects:", "No plans found." -> "No projects found.",
      "Plan created with ID:" -> "Project created with ID:", "Error listing plans:" -> "Error listing projects:",
      "Error creating plan:" -> "Error creating project:".

      The commit message for new projects should change from `plan: create <title>` to `project: create <title>`.

      Keep the `plan_id` column name in queries (column rename is out of scope).
    changeType: modify
  - id: rename-cli-flags
    content: "Rename --plan flag to --project across all CLI commands with deprecated --plan alias"
    agent: implementer
    blockedBy: [rename-cli-commands]
    intent: |
      Every CLI command that accepts `--plan <id>` should be updated to accept `--project <id>` as the
      primary flag, with `--plan` kept as a deprecated alias (Commander supports this via `.option()`
      with multiple flags).

      Files to update (each has a `--plan` option):
      - src/cli/next.ts
      - src/cli/status.ts (StatusOptions.plan -> StatusOptions.project)
      - src/cli/import.ts (--plan <titleOrId> -> --project <titleOrId>)
      - src/cli/export.ts (all export subcommands: dot, mermaid, markdown)
      - src/cli/task.ts (--plan <planId>)
      - src/cli/template.ts (--plan <name>)
      - src/cli/cancel.ts
      - src/cli/stats.ts (--plan <planId>)
      - src/cli/context.ts
      - src/cli/dashboard.ts (passes statusOptions)
      - src/cli/crossplan.ts (if it has --plan)

      For each: update the option definition, update the variable access (options.plan -> options.project),
      update help text descriptions to say "project" instead of "plan".

      The StatusOptions interface (used by status, dashboard, MCP) should rename `plan` to `project`.
      This will cascade to status.ts, dashboard.ts, and mcp/tools.ts — coordinate with those files.

      Keep `--plan` as a hidden deprecated alias using Commander's `.hideHelp()` or by mapping
      options.plan to options.project in the action handler.
    changeType: modify
  - id: rename-domain-types
    content: "Rename Plan type to Project and PLAN_NOT_FOUND to PROJECT_NOT_FOUND in domain layer"
    agent: implementer
    intent: |
      In `src/domain/types.ts`:
      - `PlanSchema` -> `ProjectSchema` (keep `PlanSchema` as deprecated alias: `export const PlanSchema = ProjectSchema`)
      - `Plan` type -> `Project` type (keep `Plan` as deprecated alias: `export type Plan = Project`)
      - `PlanStatusSchema` -> `ProjectStatusSchema` (keep alias)
      - `PlanStatus` -> `ProjectStatus` (keep alias)
      - `PlanRiskEntrySchema` -> `ProjectRiskEntrySchema` (keep alias)
      - `PlanRiskEntry` -> `ProjectRiskEntry` (keep alias)

      In `src/domain/errors.ts`:
      - `PLAN_NOT_FOUND` -> `PROJECT_NOT_FOUND` (keep `PLAN_NOT_FOUND` as deprecated alias)

      In `src/domain/plan-completion.ts`:
      - `autoCompletePlanIfDone` -> `autoCompleteProjectIfDone` (keep old name as deprecated re-export)
      - Parameter `planId` -> `projectId` internally

      In `src/domain/hash-id.ts`:
      - `planHashFromPlanId` -> `projectHashFromProjectId` (keep old name as alias)

      In `src/domain/token-estimate.ts`:
      - Update any `plan_id` parameter names to `project_id` in function signatures

      Update all internal callers in src/ to use the new names. The deprecated aliases exist only
      for external consumers or gradual migration.
    changeType: refactor
  - id: rename-cli-output-fields
    content: "Rename plan-related output fields in status, show, table, boxen, and crossplan"
    agent: implementer
    blockedBy: [rename-cli-flags, rename-domain-types]
    intent: |
      Update user-facing output across CLI commands to say "project" instead of "plan":

      - `src/cli/status.ts`: `activePlans` -> `activeProjects` in JSON output; "Plans" -> "Projects" in
        human-readable output; any `plan_title` -> `project_title` in displayed fields.
      - `src/cli/show.ts`: output labels that say "Plan" -> "Project".
      - `src/cli/table.ts`: column headers "Plan" -> "Project" in task tables.
      - `src/cli/tui/boxen.ts`: any "Plan" labels -> "Project".
      - `src/cli/crossplan.ts`: `plan_count` -> `project_count`, `plan_titles` -> `project_titles` in
        output; human-readable labels "plans" -> "projects". The command name `crossplan` can stay
        (it's a verb/action name, not an entity name) but its output should reference "projects".
      - `src/cli/stats.ts`: fix the JOIN to use `project` table instead of `plan` view; update
        output labels.
      - `src/cli/done.ts`, `src/cli/split.ts`: update any user-facing "plan" strings.

      For JSON output: use new field names (`activeProjects`, `project_title`). If backward compat
      is needed, include both old and new fields for one version.
    changeType: modify
  - id: rename-mcp-fields
    content: "Rename plan-related fields and parameters in MCP tools"
    agent: implementer
    blockedBy: [rename-cli-flags, rename-domain-types]
    intent: |
      In `src/mcp/tools.ts`:
      - `plan?: string` parameter -> `project?: string` in tool input schemas
      - `activePlans` -> `activeProjects` in status output
      - `next7UpcomingPlans` -> `next7UpcomingProjects`
      - `last7CompletedPlans` -> `last7CompletedProjects`
      - `plan_title` -> `project_title` in task results
      - Update tool descriptions to say "project" instead of "plan"

      For backward compatibility during transition, include both old and new field names in the
      output (e.g. `activeProjects` and `activePlans` pointing to same data). Mark old names
      as deprecated in comments.
    changeType: modify
  - id: rename-import-export
    content: "Rename plan references in import and export modules"
    agent: implementer
    blockedBy: [rename-domain-types]
    intent: |
      In `src/plan-import/importer.ts`:
      - Variable names: `planId` -> `projectId`, `createdPlansCount` -> `createdProjectsCount`
      - Comments referencing "plan" as entity -> "project"
      - Keep references to "plan file" (the markdown source) as "plan"
      - The directory `src/plan-import/` can stay for now (it imports plans INTO projects)

      In `src/plan-import/parser.ts`:
      - `ParsedPlan` type: this represents the parsed plan FILE, so the name is correct. But
        fields like `planTitle` that become the project title should have comments clarifying
        "title for the project created from this plan".

      In `src/export/markdown.ts`:
      - `PlanRow` -> `ProjectRow`
      - `planId` -> `projectId` in function params
      - Error references: use `PROJECT_NOT_FOUND`

      In `src/export/dot.ts`, `mermaid.ts`, `graph-data.ts`:
      - Update variable names and labels from "plan" to "project" where they refer to the entity.
    changeType: modify
  - id: update-tests
    content: "Update all tests to use --project flag, Project types, and new output field names"
    agent: implementer
    blockedBy:
      [
        rename-cli-commands,
        rename-cli-flags,
        rename-domain-types,
        rename-cli-output-fields,
        rename-mcp-fields,
        rename-import-export,
      ]
    intent: |
      Update all test files to match the renamed CLI and domain:

      Integration tests (in `__tests__/integration/`):
      - Replace `--plan` with `--project` in all CLI invocations
      - Update assertions for renamed output fields (`activePlans` -> `activeProjects`, etc.)
      - Update `plan_title` -> `project_title` in assertions
      - Files: context-budget.test.ts, rich-plan-import.test.ts, no-hard-deletes.test.ts,
        worktree.test.ts, blocked-status-materialized.test.ts, batch-cli.test.ts,
        export-markdown.test.ts, agent-stats.test.ts, gates.test.ts, crossplan.test.ts,
        task-dimensions.test.ts, dolt-sync.test.ts, graph-export.test.ts, status-live.test.ts

      Unit tests:
      - `__tests__/domain/types.test.ts`: use ProjectSchema, Project type
      - `__tests__/domain/errors.test.ts`: use PROJECT_NOT_FOUND
      - `__tests__/cli/status.test.ts`: activeProjects, project_title
      - `__tests__/mcp/tools.test.ts`: activeProjects, project_title
      - `__tests__/skills/health-check.test.ts`: update SQL to use `project` table

      After updating, run `pnpm build && pnpm gate` to verify.
    changeType: modify
  - id: update-docs
    content: "Update all documentation to use project terminology for task-graph entities"
    agent: documenter
    intent: |
      Update documentation files to use "project" when referring to the task-graph entity:

      - `docs/cli-reference.md`: all command examples (`tg project list`, `--project`), descriptions
      - `docs/schema.md`: table name references, clarify project table vs plan view
      - `docs/plan-import.md`: clarify that import creates projects from plan files
      - `docs/plan-format.md`: clarify plan files create projects; update import command examples
      - `docs/architecture.md`: terminology
      - `docs/agent-contract.md`: commands and flags
      - `docs/mcp.md`: MCP tool parameters and field names
      - `docs/error-handling.md`: PROJECT_NOT_FOUND
      - `AGENT.md`: commands, flags, "plan" -> "project" for entity references
      - `README.md`: commands, architecture description
      - Any other docs that reference `tg plan` or `--plan`

      Preserve "plan" when it means the markdown strategic document (e.g. "create a plan in plans/").
      The distinction: plans live in `plans/` as markdown; projects live in the task graph after import.
    changeType: document
  - id: update-rules-agents-skills
    content: "Update Cursor rules, agent prompts, and skill files for project terminology"
    agent: documenter
    intent: |
      Update all `.cursor/` files to use "project" for task-graph entities:

      Rules (`.cursor/rules/`):
      - `taskgraph-workflow.mdc`: `--plan` -> `--project`, "plan" -> "project" for entity
      - `plan-authoring.mdc`: keep "plan" for plan files, update import command to `--project`
      - `subagent-dispatch.mdc`: `--plan` -> `--project`
      - `session-start.mdc`: terminology
      - `no-hard-deletes.mdc`: `tg cancel <planId>` -> `<projectId>` in examples
      - `available-agents.mdc`: terminology if needed
      - `tg-usage.mdc`: commands and flags
      - `memory.md`: update terminology in existing entries

      Agents (`.cursor/agents/`):
      - `implementer.md`, `planner-analyst.md`, `reviewer.md`, `documenter.md`, `fixer.md`,
        `investigator.md`, `debugger.md`, `quality-reviewer.md`, `spec-reviewer.md`
      - Update references to `--plan` -> `--project` and "plan" -> "project" for entity

      Skills (`.cursor/skills/`):
      - `plan/SKILL.md`: keep "plan" for plan files, update import command
      - `work/SKILL.md`: `--plan` -> `--project`
      - `meta/SKILL.md`, `risk/SKILL.md`, `investigate/SKILL.md`, `review-tests/SKILL.md`,
        `rescope/SKILL.md`, `report/SKILL.md`, `review/SKILL.md`, `debug/SKILL.md`

      Be careful to distinguish: "plan" = markdown strategic document (keep), "project" = task-graph entity (rename).
    changeType: document
  - id: update-templates
    content: "Update template files in src/template/ for project terminology"
    agent: documenter
    blockedBy: [update-rules-agents-skills]
    intent: |
      Update all files in `src/template/` to mirror the terminology changes made to the main
      `.cursor/` and `docs/` files. Templates are what consuming projects get via `tg setup`.

      Files to update:
      - `src/template/AGENT.md`
      - `src/template/.cursor/rules/taskgraph-workflow.mdc`
      - `src/template/.cursor/rules/plan-authoring.mdc`
      - `src/template/.cursor/rules/subagent-dispatch.mdc`
      - `src/template/.cursor/rules/session-start.mdc`
      - `src/template/.cursor/rules/tg-usage.mdc`
      - `src/template/.cursor/rules/no-hard-deletes.mdc`
      - `src/template/.cursor/skills/plan/SKILL.md`
      - `src/template/.cursor/skills/work/SKILL.md`
      - `src/template/.cursor/skills/meta/SKILL.md`
      - `src/template/.cursor/skills/risk/SKILL.md`
      - `src/template/.cursor/skills/investigate/SKILL.md`
      - `src/template/.cursor/skills/review-tests/SKILL.md`
      - `src/template/.cursor/skills/rescope/SKILL.md`
      - `src/template/.cursor/skills/report/SKILL.md`
      - `src/template/.cursor/agents/*.md`
      - `src/template/docs/**` (any docs referencing plan as entity)

      Same rule: "plan" = markdown document (keep), "project" = task-graph entity (rename).
    changeType: document
  - id: update-changelog
    content: "Add CHANGELOG entry documenting the plan-to-project rename and deprecations"
    agent: documenter
    blockedBy: [rename-cli-commands, rename-cli-flags, rename-domain-types]
    intent: |
      Add a CHANGELOG.md entry (or create the section if needed) documenting:

      - `tg plan` command renamed to `tg project` (deprecated alias `tg plan` still works)
      - `--plan` flag renamed to `--project` across all commands (deprecated `--plan` still works)
      - Domain types renamed: Plan -> Project, PlanStatus -> ProjectStatus, etc. (old names exported as aliases)
      - Error code PLAN_NOT_FOUND renamed to PROJECT_NOT_FOUND (old name still works)
      - MCP output fields renamed: activePlans -> activeProjects, etc.
      - Documentation updated to distinguish "plans" (markdown strategic docs) from "projects" (task-graph entities)
      - Deprecation timeline: old names will be removed in next major version
    changeType: document
  - id: run-full-gate
    content: "Build and run full gate to verify all changes"
    agent: implementer
    blockedBy:
      [
        update-tests,
        update-docs,
        update-rules-agents-skills,
        update-templates,
        update-changelog,
      ]
    intent: |
      Run `pnpm build && pnpm gate:full` to verify the entire codebase compiles and all tests pass
      after the rename. Fix any remaining references to old names that were missed.

      Evidence should be "gate:full passed" or "gate:full failed: <summary>".
    changeType: test
isProject: false
---

## Analysis

### Current state

The task-graph database already has the `plan` table renamed to `project`, with a `plan` view for backward compatibility. Application code queries the `project` table. However, the entire surface area — CLI commands, flags, types, output fields, documentation, rules, agent prompts, skill files, and templates — still uses "plan" to mean the task-graph entity.

### Naming convention (going forward)

| Term        | Meaning                                          | Where it lives                          |
| ----------- | ------------------------------------------------ | --------------------------------------- |
| **Plan**    | Markdown strategic document, pre-import analysis | `plans/` directory, plan-authoring rule |
| **Project** | Task-graph entity (imported from a plan)         | `project` table in Dolt, CLI commands   |

### Column names

Column names (`plan_id`, `plan_title` alias) are **not** renamed in this plan. Column renames require schema migration, FK updates, and carry higher risk. They can be addressed in a follow-up if desired. Application code will use `project_id` for variable names but still reference `plan_id` in SQL.

### Backward compatibility strategy

- **CLI commands**: `tg plan` becomes a deprecated alias for `tg project`
- **CLI flags**: `--plan` becomes a deprecated alias for `--project`
- **Domain types**: Old names (`Plan`, `PlanSchema`, `PLAN_NOT_FOUND`) kept as re-exports
- **MCP fields**: Old field names included alongside new ones for one version
- **Deprecation removal**: Next major version

### Out of scope

- Renaming database columns (`plan_id` -> `project_id`)
- Renaming the `src/plan-import/` directory (it imports plans into projects — name is accurate)
- Renaming the `crossplan` command name (it's a verb/action, not an entity reference)
- Updating content of old project records in the database (low value, high risk of over-rewriting)

## Dependency graph

```
Parallel start (3 unblocked):
  ├── rename-cli-commands (tg plan -> tg project command)
  ├── rename-domain-types (Plan -> Project types, errors)
  ├── update-docs (documentation updates)
  ├── update-rules-agents-skills (rules, agents, skills)
  └── update-changelog (CHANGELOG entry)

After rename-cli-commands + rename-domain-types:
  ├── rename-cli-flags (--plan -> --project across all commands)
  └── rename-import-export (import/export module renames)

After rename-cli-flags + rename-domain-types:
  ├── rename-cli-output-fields (status, show, table, boxen, crossplan output)
  └── rename-mcp-fields (MCP tool fields and parameters)

After all code changes:
  └── update-tests (update all test files)

After update-rules-agents-skills:
  └── update-templates (template files mirror rules/agents/skills)

After everything:
  └── run-full-gate (build + gate:full verification)
```

```mermaid
graph TD
  A[rename-cli-commands] --> D[rename-cli-flags]
  B[rename-domain-types] --> D
  B --> E[rename-import-export]
  D --> F[rename-cli-output-fields]
  B --> F
  D --> G[rename-mcp-fields]
  B --> G
  A --> H[update-tests]
  D --> H
  F --> H
  G --> H
  E --> H
  C1[update-docs]
  C2[update-rules-agents-skills] --> I[update-templates]
  C3[update-changelog]
  H --> J[run-full-gate]
  C1 --> J
  I --> J
  C3 --> J
```

<original_prompt>
I'd like to make a plan to systematically move the entire codebase to using the word "project" instead of "plan" where it refers to the task-graph entity. Plans (markdown strategic documents in plans/) keep the word "plan". Once imported into the task graph, they become "projects". Old projects in the database should have their content updated for references to plans. The CLI commands, flags, types, output, docs, rules, agents, skills, and templates all need updating.
</original_prompt>
