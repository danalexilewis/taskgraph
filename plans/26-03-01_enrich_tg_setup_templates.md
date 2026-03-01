---
name: Enrich tg Setup Templates for New Projects
overview: Significantly improve the tg init/setup experience so new projects immediately get high-quality agent infrastructure, coding guidelines, recommended packages, and the full set of skills and lead docs that tg itself uses.
fileTree: |
  src/
  ├── cli/
  │   └── init.ts                                     (modify)
  ├── template/
  │   ├── .cursor/
  │   │   ├── agents/
  │   │   │   ├── README.md                           (modify)
  │   │   │   ├── debugger.md                         (create)
  │   │   │   ├── documenter.md                       (create)
  │   │   │   ├── fixer.md                            (create)
  │   │   │   └── investigator.md                     (create)
  │   │   ├── rules/
  │   │   │   ├── available-agents.mdc                (modify)
  │   │   │   ├── code-guidelines.mdc                 (create)
  │   │   │   ├── no-hard-deletes.mdc                 (create)
  │   │   │   └── subagent-reports.mdc                (create)
  │   │   └── skills/
  │   │       ├── plan/SKILL.md                       (create)
  │   │       ├── investigate/SKILL.md                (create)
  │   │       ├── debug/SKILL.md                      (create)
  │   │       ├── review/SKILL.md                     (create)
  │   │       ├── work/SKILL.md                       (create)
  │   │       ├── report/SKILL.md                     (create)
  │   │       ├── rescope/SKILL.md                    (create)
  │   │       ├── review-tests/SKILL.md               (create)
  │   │       ├── review-tests/reference.md           (create)
  │   │       ├── risk/SKILL.md                       (create)
  │   │       ├── risk/CODE_RISK_ASSESSMENT.md        (create)
  │   │       ├── meta/SKILL.md                       (create)
  │   │       └── create-hook/SKILL.md                (create)
  │   └── docs/
  │       ├── leads/
  │       │   ├── README.md                           (create)
  │       │   ├── investigator.md                     (create)
  │       │   ├── debug.md                            (create)
  │       │   ├── planner-analyst.md                  (create)
  │       │   ├── execution.md                        (create)
  │       │   ├── test-review.md                      (create)
  │       │   ├── review.md                           (create)
  │       │   ├── rescope.md                          (create)
  │       │   ├── risk.md                             (create)
  │       │   └── meta.md                             (create)
  │       └── recommended-packages.md                 (create)
  __tests__/
  └── integration/
      └── setup-scaffold.test.ts                      (modify)
risks:
  - description: Skills reference lead doc paths with relative links -- paths must be correct relative to the template layout, not the main project
    severity: medium
    mitigation: Skills in src/template/.cursor/skills/ should use paths like docs/leads/X.md (relative to repo root); verify all links after creation
  - description: Template drift -- main project evolves agents/skills but template copy falls behind
    severity: low
    mitigation: Document in template README.md that agents/skills/leads originate from the tg main project; add a note in memory.md about periodic sync
  - description: Large number of new files could cause merge conflicts with in-flight work
    severity: low
    mitigation: All new files are in src/template/ which has no active work; init.ts change is a single added block
  - description: Init Bun message could confuse users who use a different test runner
    severity: low
    mitigation: Frame as recommendation for tg tests specifically, not a hard requirement for the project; mention it's needed for tg's own test runner
tests:
  - "tg setup scaffolds new agent files (debugger.md, documenter.md, fixer.md, investigator.md)"
  - "tg setup scaffolds .cursor/skills/ directory with skill files"
  - "tg setup scaffolds docs/leads/ directory with lead docs"
  - "tg setup scaffolds code-guidelines.mdc and recommended-packages.md"
  - "tg init prints Bun recommendation in success output"
todos:
  - id: init-bun-message
    content: "Add post-init Bun recommendation message to tg init success output"
    agent: implementer
    intent: |
      After successful init in src/cli/init.ts, add a helpful message block that tells users:
      1. Bun is recommended for running tests (bun is tg's test runner)
      2. Install globally: npm install -g bun (or brew install oven-sh/bun/bun)
      3. Then run tg setup to scaffold agent infrastructure

      Add this inside the initResult.match success branch, after the existing
      "Task Graph initialized successfully." message. Use console.log for each line.
      Keep it concise -- 3-4 lines max. Example:

      ```
      console.log("");
      console.log("Next steps:");
      console.log("  1. Install Bun for test running: npm i -g bun (or brew install oven-sh/bun/bun)");
      console.log("  2. Run: pnpm tg setup   — scaffold agent infrastructure, docs, and coding guidelines");
      ```

      Only show next-steps when NOT in JSON mode (the json check already exists on the success branch).
    changeType: modify
    suggestedChanges: |
      In src/cli/init.ts, inside the initResult.match success callback,
      after `console.log("Task Graph initialized successfully.");`, add:
      ```typescript
      console.log("");
      console.log("Next steps:");
      console.log("  1. Install Bun for test running: npm i -g bun (or brew install oven-sh/bun/bun)");
      console.log("  2. Run: pnpm tg setup   — scaffold agent infrastructure, docs, and coding guidelines");
      ```
      These lines must be inside the `if (!cmd.parent?.opts().json)` block.

  - id: template-agents
    content: "Add debugger, documenter, fixer, investigator agents to template"
    agent: implementer
    intent: |
      Create four new agent prompt template files in src/template/.cursor/agents/ by
      copying from the main project's .cursor/agents/ directory:
      - debugger.md (from .cursor/agents/debugger.md)
      - documenter.md (from .cursor/agents/documenter.md)
      - fixer.md (from .cursor/agents/fixer.md)
      - investigator.md (from .cursor/agents/investigator.md)

      These are prompt templates, not code. Copy them verbatim -- the main project's
      versions are already well-structured with Purpose, Model, Input/Output contracts,
      and Prompt templates.

      Also update src/template/.cursor/agents/README.md directory layout section to
      list the new agents alongside the existing ones.

      Also update src/template/.cursor/rules/available-agents.mdc to add entries for:
      - debugger: Systematic debugging sub-agent for hypothesis-driven investigation
      - documenter: Documentation-only agent for markdown/docs tasks
      - fixer: Escalation agent; resolves tasks after implementer/reviewer failure using a stronger model
      - investigator: Read-only investigation specialist for tactical directives
    changeType: create

  - id: template-lead-docs
    content: "Add docs/leads/ directory with all lead documentation to template"
    agent: implementer
    intent: |
      Create src/template/docs/leads/ directory and copy all lead documentation files
      from the main project's docs/leads/ directory:
      - README.md
      - investigator.md
      - debug.md
      - planner-analyst.md
      - execution.md
      - test-review.md
      - review.md
      - rescope.md
      - risk.md
      - meta.md

      Copy verbatim from docs/leads/ in the main project. These files document
      orchestration patterns (leads) that skills reference. Skills in .cursor/skills/
      link to these docs, so the paths must match: docs/leads/<name>.md from repo root.

  - id: template-skills
    content: "Port all Cursor skills from main project to template"
    agent: implementer
    blockedBy: [template-lead-docs]
    intent: |
      Create src/template/.cursor/skills/ directory and port all skills from the main
      project's .cursor/skills/ directory. For each skill, create the directory and copy
      the SKILL.md (and any companion files):

      1. plan/SKILL.md
      2. investigate/SKILL.md
      3. debug/SKILL.md
      4. review/SKILL.md
      5. work/SKILL.md
      6. report/SKILL.md
      7. rescope/SKILL.md
      8. review-tests/SKILL.md + review-tests/reference.md
      9. risk/SKILL.md + risk/CODE_RISK_ASSESSMENT.md
      10. meta/SKILL.md
      11. create-hook/SKILL.md

      IMPORTANT path adjustments: Skills in the main project use relative paths to
      reference lead docs (e.g. `../../../docs/leads/debug.md`). In the template,
      skills live at .cursor/skills/<name>/SKILL.md, so the relative path to
      docs/leads/ is `../../../docs/leads/`. Verify that all lead doc references
      use the correct relative path. Some skills may also reference agent files
      at `.cursor/agents/<name>.md` -- these should use `../../agents/<name>.md`
      relative to the skill's SKILL.md, or just `.cursor/agents/<name>.md` (repo-root
      relative paths, which is the convention used by most skills).

      Copy content verbatim where paths are already correct. Fix any relative
      paths that don't resolve correctly from the template layout.
    changeType: create
    suggestedChanges: |
      Structure under src/template/.cursor/skills/:
      ```
      skills/
      ├── plan/SKILL.md
      ├── investigate/SKILL.md
      ├── debug/SKILL.md
      ├── review/SKILL.md
      ├── work/SKILL.md
      ├── report/SKILL.md
      ├── rescope/SKILL.md
      ├── review-tests/
      │   ├── SKILL.md
      │   └── reference.md
      ├── risk/
      │   ├── SKILL.md
      │   └── CODE_RISK_ASSESSMENT.md
      ├── meta/SKILL.md
      └── create-hook/SKILL.md
      ```

  - id: code-guidelines-rule
    content: "Create code-guidelines.mdc template rule with opinionated coding standards"
    agent: implementer
    intent: |
      Create src/template/.cursor/rules/code-guidelines.mdc -- a generic, opinionated
      coding guidelines rule that new projects get when running tg setup.

      This should NOT be TaskGraph-specific (that's code-standards.mdc in the main project).
      Instead, provide universal TypeScript/JavaScript coding standards that improve
      agent output quality.

      Include frontmatter:
      ```
      ---
      description: Opinionated coding guidelines for consistent, high-quality code
      alwaysApply: true
      ---
      ```

      Content sections:
      1. TypeScript strictness: strict mode, no `any`, no `@ts-ignore`, no `as any`
      2. Naming: descriptive names, no abbreviations, camelCase for variables/functions,
         PascalCase for types/classes, UPPER_SNAKE for constants
      3. Error handling: prefer Result types (neverthrow) or explicit error returns over
         throw/catch; never swallow errors with empty catch blocks
      4. Imports: group by external/internal, no circular imports, prefer named exports
      5. Functions: small and focused (under 50 lines), single responsibility,
         pure where possible
      6. Types: prefer interfaces for objects, use discriminated unions for variants,
         use Zod for runtime validation
      7. Testing: co-locate tests, descriptive test names, test behavior not implementation,
         no test interdependence
      8. Dependencies: check docs/recommended-packages.md before installing new packages;
         prefer established packages over new/unmaintained ones
      9. Anti-patterns to avoid: nested ternaries, mutation of function params,
         magic numbers/strings, console.log in production code

      Keep it concise -- aim for 60-80 lines. This is guidance for AI agents, not a
      comprehensive style guide.
    changeType: create

  - id: recommended-packages-doc
    content: "Create recommended-packages.md with curated dependency list"
    agent: implementer
    intent: |
      Create src/template/docs/recommended-packages.md -- a curated list of recommended
      packages that agents should consult FIRST when they need to install a dependency.

      Structure:
      - Title and intro paragraph explaining this is a curated list
      - Categorized table with: Package name, npm name, category, one-line description,
        and when to use it

      First set of packages (from user):

      | Category | Package | npm | Description |
      |----------|---------|-----|-------------|
      | Validation | zod | zod | Schema declaration and validation; use for all input/output validation |
      | Data Fetching | React Query | @tanstack/react-query | Server state management; use for any API data fetching in React |
      | Utilities | lodash | lodash-es | Utility functions; prefer lodash-es for tree-shaking; use for collection/object manipulation |
      | Identifiers | uuid | uuid | RFC-compliant UUID generation; use when you need unique IDs |
      | Authorization | CASL | @casl/ability | Isomorphic authorization; use for permission/access control logic |
      | Pattern Matching | ts-pattern | ts-pattern | Exhaustive pattern matching; use instead of switch/if chains for discriminated unions |
      | SQL | Knex | knex | SQL query builder; use for database access when an ORM is too heavy |
      | Database | Dolt | dolt | Version-controlled MySQL-compatible database; already used by tg |
      | API Contracts | ts-rest | @ts-rest/core | Type-safe REST contracts; use for defining and consuming REST APIs |
      | Visualization | React Flow | @xyflow/react | Node-based UIs; use for flowcharts, diagrams, graph editors |
      | Data Grid | AG Grid | ag-grid-react | Enterprise data grid; use for complex tabular data with sorting/filtering |
      | Dates | date-fns | date-fns | Date utility functions; use instead of moment.js for date manipulation |
      | Email | MJML | mjml | Responsive email framework; use for building HTML emails |

      Add a "How to use this list" section:
      - Agents should check this list before running npm/pnpm install for a new capability
      - If a recommended package covers the need, prefer it over alternatives
      - If no recommended package fits, the agent may install other packages but should
        note the choice

      Add a "Contributing" section explaining how to add packages to the list.
    changeType: create

  - id: template-extra-rules
    content: "Add no-hard-deletes and subagent-reports rules to template"
    agent: implementer
    intent: |
      Add two additional rules to src/template/.cursor/rules/ that the main project
      uses but the template is missing:

      1. no-hard-deletes.mdc -- Copy from the main project's .cursor/rules/no-hard-deletes.mdc.
         This is a critical data safety rule that prevents agents from running DELETE,
         DROP TABLE, or TRUNCATE on the task graph database.

      2. subagent-reports.mdc -- Copy from the main project's .cursor/rules/subagent-reports.mdc.
         This rule ensures sub-agent reports are presented as-is without lossy re-summarization.

      Both should have `alwaysApply: true` in their frontmatter (check the main project
      versions for the exact frontmatter).
    changeType: create

  - id: update-setup-test
    content: "Update setup-scaffold integration test for new template paths"
    agent: implementer
    blockedBy:
      [
        template-agents,
        template-skills,
        template-lead-docs,
        code-guidelines-rule,
        recommended-packages-doc,
        template-extra-rules,
      ]
    intent: |
      Update __tests__/integration/setup-scaffold.test.ts to assert that the new
      template files are scaffolded correctly.

      Add these paths to the expectedPaths array in the first test:
      - ".cursor/agents/debugger.md"
      - ".cursor/agents/documenter.md"
      - ".cursor/agents/fixer.md"
      - ".cursor/agents/investigator.md"
      - ".cursor/rules/code-guidelines.mdc"
      - ".cursor/rules/no-hard-deletes.mdc"
      - ".cursor/rules/subagent-reports.mdc"
      - ".cursor/skills/plan/SKILL.md" (spot check -- just verify skills dir exists)
      - "docs/leads/README.md" (spot check -- just verify leads dir exists)
      - "docs/recommended-packages.md"

      Don't assert every single skill or lead file -- that would be brittle.
      Pick 2-3 representative paths from each new area.
    changeType: modify
    suggestedChanges: |
      Add to the expectedPaths array in setup-scaffold.test.ts:
      ```typescript
      ".cursor/agents/debugger.md",
      ".cursor/agents/documenter.md",
      ".cursor/agents/fixer.md",
      ".cursor/agents/investigator.md",
      ".cursor/rules/code-guidelines.mdc",
      ".cursor/rules/no-hard-deletes.mdc",
      ".cursor/rules/subagent-reports.mdc",
      ".cursor/skills/plan/SKILL.md",
      ".cursor/skills/work/SKILL.md",
      "docs/leads/README.md",
      "docs/leads/execution.md",
      "docs/recommended-packages.md",
      ```

  - id: run-full-suite
    content: "Build and run full test suite to validate all changes"
    agent: implementer
    blockedBy: [init-bun-message, update-setup-test]
    intent: |
      Build the project and run the full validation gate:
      1. pnpm build (required since src/cli/init.ts was modified and template files added)
      2. pnpm gate:full (lint + typecheck + full test suite)

      Record the result in evidence. If gate:full fails, add a tg note with the failure
      reason so the orchestrator can create fix tasks.
    changeType: test
isProject: false
---

## Analysis

### Current state

The `tg setup` command scaffolds docs and Cursor rules into new projects, but the template is significantly behind the main project:

- **Agents**: Template has 6 of the main project's 14 agents. Missing: debugger, documenter, fixer, investigator (the four most impactful for quality).
- **Skills**: Template has zero `.cursor/skills/`. The main project has 11 mature skills (plan, investigate, debug, review, work, report, rescope, review-tests, risk, meta, create-hook).
- **Lead docs**: Template has no `docs/leads/`. Skills reference these for orchestration patterns.
- **Rules**: Template is missing `no-hard-deletes.mdc` (data safety) and `subagent-reports.mdc` (report quality).
- **Guidelines**: No coding standards or package recommendations in the template.
- **Init messaging**: No guidance about Bun or next steps after `tg init`.

### Design decisions

1. **Skills go in `.cursor/skills/`** (not `docs/skills/`): The main project uses Cursor's native skill system. `docs/skills/` is a separate layer for task-context guides. Both coexist.

2. **Code guidelines vs code-standards**: `code-guidelines.mdc` is generic/universal (for any project). `code-standards.mdc` is TaskGraph-specific (neverthrow, db/domain layering). The template gets `code-guidelines` only.

3. **Recommended packages as doc, not rule**: `docs/recommended-packages.md` is a reference doc. The `code-guidelines.mdc` rule tells agents to check it before installing packages. No separate rule needed.

4. **Verbatim copy for agents/leads**: Agent prompt templates and lead docs are copied from the main project without modification. They're already well-structured and project-agnostic.

5. **Skills need path adjustment**: Skills reference lead docs with relative paths. Since both live in the same relative positions in the template as in the main project, most paths should be correct. The implementer should verify.

### Out of scope

- Syncing the existing 6 template agents with main project versions (separate maintenance task)
- Adding test-quality-auditor, test-infra-mapper, test-coverage-scanner agents (niche; can be added later)
- Adding `changed-files-default.mdc` or `docs-sync.mdc` to template (tg-specific validation rules)
- `tg setup` UX changes (e.g. progress bars, categories)
- Automatic Bun installation from `tg init`

## Dependency graph

```
Parallel start (6 unblocked):
  ├── init-bun-message (src/cli/init.ts)
  ├── template-agents (4 agent files + available-agents + README)
  ├── template-lead-docs (10 lead doc files)
  ├── code-guidelines-rule (.cursor/rules/code-guidelines.mdc)
  ├── recommended-packages-doc (docs/recommended-packages.md)
  └── template-extra-rules (no-hard-deletes + subagent-reports)

After template-lead-docs:
  └── template-skills (11 skill directories with SKILL.md + companions)

After all template work:
  └── update-setup-test (extend integration test assertions)

After init-bun-message + update-setup-test:
  └── run-full-suite (build + gate:full)
```

```mermaid
graph TD
    A[init-bun-message] --> G[run-full-suite]
    B[template-agents] --> F[update-setup-test]
    C[template-lead-docs] --> D[template-skills]
    D --> F
    E1[code-guidelines-rule] --> F
    E2[recommended-packages-doc] --> F
    E3[template-extra-rules] --> F
    F --> G
```

<original_prompt>
I think we are approaching a new version to release of the app. Integration tests are all falling into place and we are getting the missing piece that is initiatives in.

now we need to make it that what we have learned is also brought to those that use taskgraph. so when tg init runs we tell users that they should use bun for testing and to install it globably. then we want to update our templates in tg so that the new project initialisise with the same skills and angents as tg. also that we provide code guidelines for the project to follow.

baiscially we immediatily increase the qualitiy of output for the new codebase.

we can also start curatining a recomended set of packages so that when agents have an idea of what needs to be installed they pick off this list firest.

first set: zod, react-query, lodash, uuid, casl, ts-pattern, knex, dolt, ts-rest, react-flow, ag-grid, date-fns, mjml
</original_prompt>
