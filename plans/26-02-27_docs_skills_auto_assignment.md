---
name: Docs and Skills Auto-Assignment Pipeline
overview: Fix the empty docs/skills gap by adding trigger metadata to doc/skill files, teaching the planner-analyst to recommend them, and auto-suggesting at import time.
fileTree: |
  .cursor/
  ├── agents/
  │   └── planner-analyst.md              (modify)
  ├── rules/
  │   └── plan-authoring.mdc              (modify)
  docs/
  ├── domains.md                          (modify)
  ├── skills/
  │   ├── README.md                       (modify)
  │   ├── cli-command-implementation.md   (modify)
  │   ├── cli-command.md                  (modify)
  │   ├── dolt-schema-migration.md        (modify)
  │   ├── documentation-sync.md           (modify)
  │   ├── integration-testing.md          (modify)
  │   ├── neverthrow-error-handling.md    (modify)
  │   ├── plan-authoring.md               (modify)
  │   ├── refactoring-safely.md           (modify)
  │   ├── rule-authoring.md               (modify)
  │   ├── sql-migration.md                (modify)
  │   ├── subagent-dispatch.md            (modify)
  │   ├── taskgraph-lifecycle-execution.md (modify)
  │   └── yaml-parsing.md                 (modify)
  src/
  ├── domain/
  │   └── doc-skill-registry.ts           (create)
  └── plan-import/
      └── importer.ts                     (modify)
  __tests__/
  └── domain/
      └── doc-skill-registry.test.ts      (create)
risks:
  - description: Adding YAML frontmatter to skill docs could confuse agents that read them as plain markdown
    severity: low
    mitigation: Use a simple key-value frontmatter block that renders invisibly in markdown viewers. Skill docs are already consumed programmatically by tg context path resolution.
  - description: Auto-suggestion at import could override intentionally empty docs/skills
    severity: medium
    mitigation: Auto-suggest only warns in console output, never silently overwrites. Manual assignments always take precedence. Add a --no-suggest flag to suppress.
  - description: Trigger metadata could become stale as the codebase evolves
    severity: low
    mitigation: Triggers use glob patterns (not exact paths) so they tolerate file renames within directories. The documentation-sync skill already covers keeping docs current.
  - description: Keyword matching could produce false positives on common words like error, command, test
    severity: medium
    mitigation: Matching requires two signals (file pattern match AND changeType or keyword match). Multi-word keywords match as phrases. Broad globs like src/** are avoided in favor of specific directory patterns.
tests:
  - "Registry loads trigger metadata from all skill and doc files"
  - "matchDocsForTask returns correct doc slugs given file patterns and change types"
  - "matchSkillsForTask returns correct skill slugs given file patterns and change types"
  - "Manual docs/skills in plan YAML are preserved (not overwritten by auto-suggest)"
  - "Import with --no-suggest skips auto-suggestion"
  - "Import warns when tasks have no docs/skills but triggers match"
  - "Planner-analyst prompt includes docs/skills discovery step"
todos:
  - id: add-trigger-metadata-to-skills
    content: Add trigger frontmatter to all skill docs with file patterns, change types, and keywords
    agent: implementer
    skill: [documentation-sync]
    changeType: modify
    intent: |
      Add YAML frontmatter to each file in docs/skills/*.md with a `triggers` block.
      The frontmatter uses standard --- delimiters. Each trigger block has:
      - `files`: array of glob patterns (e.g. ["src/cli/**"])
      - `change_types`: array of change type slugs (e.g. ["create", "modify"])
      - `keywords`: array of terms that appear in task titles/intent (e.g. ["command", "subcommand"])

      Mappings (derive from each skill's Purpose and Inputs sections):

      | Skill slug | files | change_types | keywords |
      |---|---|---|---|
      | cli-command-implementation | ["src/cli/**"] | ["create", "modify"] | ["command", "subcommand", "CLI", "tg"] |
      | cli-command | ["src/cli/**"] | ["create", "modify"] | ["command", "subcommand"] |
      | dolt-schema-migration | ["src/db/migrate.ts", "src/db/**"] | ["create", "modify"] | ["migration", "schema", "column", "table", "ALTER"] |
      | sql-migration | ["src/db/**"] | ["create", "modify"] | ["migration", "schema", "SQL"] |
      | integration-testing | ["__tests__/integration/**"] | ["create", "modify", "test"] | ["integration test", "test-utils", "runTgCli"] |
      | neverthrow-error-handling | ["src/domain/errors.ts", "src/db/**", "src/cli/**", "src/plan-import/**"] | ["create", "modify", "refactor"] | ["Result", "ResultAsync", "neverthrow", "AppError", "error handling"] |
      | documentation-sync | ["docs/**", "AGENT.md", ".cursor/rules/**"] | ["document", "modify"] | ["docs", "documentation", "sync", "cli-reference", "schema.md"] |
      | plan-authoring | ["plans/**", ".cursor/rules/plan-authoring*"] | ["create", "modify", "document"] | ["plan", "frontmatter", "YAML", "todos"] |
      | rule-authoring | [".cursor/rules/**"] | ["create", "modify"] | ["rule", "mdc", "cursor rule"] |
      | refactoring-safely | ["src/domain/**", "src/db/**", "src/cli/**", "src/plan-import/**", "src/export/**"] | ["refactor"] | ["refactor", "restructure", "rename"] |
      | yaml-parsing | ["src/plan-import/parser.ts", "src/plan-import/**"] | ["create", "modify"] | ["YAML", "parse", "frontmatter", "js-yaml"] |
      | subagent-dispatch | [".cursor/agents/**", ".cursor/rules/subagent*"] | ["create", "modify"] | ["sub-agent", "dispatch", "implementer", "reviewer"] |
      | taskgraph-lifecycle-execution | ["src/cli/**"] | ["create", "modify"] | ["tg start", "tg done", "lifecycle", "status transition"] |

      Also update docs/skills/README.md to note that each skill has trigger frontmatter
      and explain the format briefly.

      Example frontmatter for cli-command-implementation.md:
      ```
      ---
      triggers:
        files: ["src/cli/**"]
        change_types: ["create", "modify"]
        keywords: ["command", "subcommand", "CLI", "tg"]
      ---
      # Skill: CLI command implementation
      ...
      ```
    suggestedChanges: |
      For each skill doc, prepend:
      ```yaml
      ---
      triggers:
        files: [<glob patterns>]
        change_types: [<types>]
        keywords: [<terms>]
      ---
      ```
      Keep the existing content unchanged below the frontmatter.

  - id: add-trigger-metadata-to-docs
    content: Add trigger frontmatter to domain docs listed in docs/domains.md
    agent: implementer
    skill: [documentation-sync]
    changeType: modify
    intent: |
      Add YAML frontmatter with triggers to each domain doc listed in docs/domains.md.
      Same format as skills but for docs:

      | Doc slug | files | change_types | keywords |
      |---|---|---|---|
      | architecture | ["src/domain/**", "src/db/**", "src/plan-import/**", "src/export/**"] | ["create", "refactor"] | ["architecture", "layer", "data flow"] |
      | schema | ["src/db/**", "src/domain/types.ts"] | ["create", "modify"] | ["schema", "column", "table", "migration"] |
      | cli-reference | ["src/cli/**"] | ["create", "modify"] | ["command", "option", "flag", "CLI"] |
      | cli | ["src/cli/**"] | ["create", "modify"] | ["command", "CLI"] |
      | plan-import | ["src/plan-import/**"] | ["create", "modify"] | ["import", "parser", "cursor format"] |
      | error-handling | ["src/domain/errors.ts", "src/domain/**"] | ["create", "modify"] | ["error", "AppError", "ErrorCode"] |
      | testing | ["__tests__/**"] | ["create", "modify", "test"] | ["test", "vitest", "integration"] |
      | agent-contract | [".cursor/agents/**", "AGENT.md"] | ["create", "modify"] | ["agent", "contract", "workflow"] |

      Also update docs/domains.md to note the trigger format.

  - id: create-registry-module
    content: Create doc-skill-registry module that loads trigger metadata and matches tasks
    agent: implementer
    docs: [architecture]
    skill: [neverthrow-error-handling, cli-command-implementation]
    changeType: create
    intent: |
      Create src/domain/doc-skill-registry.ts with these exports:

      1. `interface TriggerMetadata { files: string[]; change_types: string[]; keywords: string[]; }`
      2. `interface RegistryEntry { slug: string; type: 'doc' | 'skill'; triggers: TriggerMetadata; }`
      3. `function loadRegistry(repoRoot: string): Result<RegistryEntry[], AppError>`
         - Reads docs/domains.md to get doc slugs, then reads each doc file's frontmatter
         - Reads docs/skills/README.md to get skill slugs, then reads each skill file's frontmatter
         - Parses YAML frontmatter from each file to extract triggers
         - Returns array of RegistryEntry objects
         - Uses js-yaml for parsing (same as parser.ts)
      4. `function matchDocsForTask(registry: RegistryEntry[], filePatterns: string[], changeType: string | null, title: string): string[]`
         - Filters registry entries where type === 'doc'
         - A match requires TWO signals (to avoid noise from broad globs like src/**):
           a. File match: any file glob in triggers.files matches any path in filePatterns
           b. Second signal: changeType is in triggers.change_types OR any keyword matches title
           Both (a) AND (b) must be true for a match.
         - Returns array of matching doc slugs
      5. `function matchSkillsForTask(registry: RegistryEntry[], filePatterns: string[], changeType: string | null, title: string): string[]`
         - Same two-signal logic but for type === 'skill'

      File matching uses minimatch or picomatch for glob patterns.
      Keyword matching is case-insensitive substring match against task title.
      Multi-word keywords (e.g. "error handling") should match as a phrase.
      Both matchers return deduplicated, sorted arrays.

      The registry is loaded once and reused across all tasks in an import batch.
    suggestedChanges: |
      ```ts
      import { readFileSync, readdirSync } from "fs";
      import { join } from "path";
      import yaml from "js-yaml";
      import { Result, ok, err } from "neverthrow";
      import { AppError, buildError, ErrorCode } from "./errors";
      import { minimatch } from "minimatch";

      export interface TriggerMetadata {
        files: string[];
        change_types: string[];
        keywords: string[];
      }

      export interface RegistryEntry {
        slug: string;
        type: "doc" | "skill";
        triggers: TriggerMetadata;
      }

      function parseFrontmatterTriggers(content: string): TriggerMetadata | null {
        const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!match) return null;
        const parsed = yaml.load(match[1]) as { triggers?: TriggerMetadata } | null;
        return parsed?.triggers ?? null;
      }
      ```

  - id: registry-unit-tests
    content: Unit tests for doc-skill-registry loading and matching
    agent: implementer
    docs: [testing]
    skill: [integration-testing]
    changeType: create
    blockedBy:
      [
        create-registry-module,
        add-trigger-metadata-to-skills,
        add-trigger-metadata-to-docs,
      ]
    intent: |
      Create __tests__/domain/doc-skill-registry.test.ts with tests:

      1. loadRegistry reads trigger frontmatter from real docs/skills/ files
      2. matchDocsForTask returns "cli-reference" and "cli" for file pattern "src/cli/status.ts"
      3. matchSkillsForTask returns "cli-command-implementation" for file pattern "src/cli/foo.ts" with changeType "create"
      4. matchSkillsForTask returns "integration-testing" for file pattern "__tests__/integration/foo.test.ts"
      5. Keyword matching: title "Add migration for new column" matches skill "dolt-schema-migration"
      6. No match returns empty array
      7. Manual docs/skills are not affected (registry only suggests, doesn't override)

      Use the real docs/skills/ files as fixtures (they'll have trigger frontmatter
      after the earlier tasks complete).

  - id: auto-suggest-at-import
    content: Add auto-suggestion of docs/skills during plan import with console warnings
    agent: implementer
    docs: [plan-import, cli-reference]
    skill: [cli-command-implementation, neverthrow-error-handling]
    changeType: modify
    blockedBy:
      [
        create-registry-module,
        add-trigger-metadata-to-skills,
        add-trigger-metadata-to-docs,
      ]
    intent: |
      Modify src/plan-import/importer.ts to auto-suggest docs/skills:

      1. At the start of upsertTasksAndEdges, load the registry via loadRegistry(repoRoot).
         The repoRoot can be derived from repoPath (go up from .taskgraph/dolt to repo root)
         or passed as a new parameter.

      2. For each parsedTask, if docs and skills are both empty (or undefined):
         - Build the file patterns list from ALL paths in the plan-level fileTree
           (the tree is already scoped to files the plan touches). Parse the tree
           by extracting lines that contain file extensions (e.g. .ts, .md, .mdc)
           and strip tree-drawing characters and annotations like (create)/(modify).
           If the task has suggestedChanges that reference specific file paths,
           include those too.
         - Call matchDocsForTask and matchSkillsForTask with these file patterns
         - If matches found, log a warning:
           `⚠ Task "<title>": auto-assigned docs=[cli, schema], skills=[cli-command-implementation]`
         - Assign the suggestions to parsedTask.docs and parsedTask.skills
           (only when they were empty — never override manual assignments)

      3. Add --no-suggest option to the import command in src/cli/import.ts.
         When set, skip the auto-suggestion step entirely.
         Default: suggestions enabled.

      4. If registry loading fails (e.g. no frontmatter yet), silently skip
         auto-suggestion (don't fail the import).

      Update docs/cli-reference.md with the new --no-suggest flag.
    suggestedChanges: |
      In importer.ts, before the task loop:
      ```ts
      const registryResult = loadRegistry(repoRoot);
      const registry = registryResult.isOk() ? registryResult.value : [];
      ```

      In the task loop, after creating taskId but before junction sync:
      ```ts
      if (registry.length > 0 && (!parsedTask.docs?.length) && (!parsedTask.skills?.length)) {
        const suggestedDocs = matchDocsForTask(registry, filePatterns, parsedTask.changeType ?? null, parsedTask.title);
        const suggestedSkills = matchSkillsForTask(registry, filePatterns, parsedTask.changeType ?? null, parsedTask.title);
        if (suggestedDocs.length || suggestedSkills.length) {
          console.warn(`⚠ Task "${parsedTask.title}": auto-assigned docs=[${suggestedDocs}], skills=[${suggestedSkills}]`);
          parsedTask.docs = suggestedDocs.length ? suggestedDocs : parsedTask.docs;
          parsedTask.skills = suggestedSkills.length ? suggestedSkills : parsedTask.skills;
        }
      }
      ```

  - id: update-planner-analyst
    content: Add docs/skills discovery step to planner-analyst prompt
    agent: implementer
    skill: [subagent-dispatch, documentation-sync]
    changeType: modify
    intent: |
      Modify .cursor/agents/planner-analyst.md to add a new step and output section:

      **In the Instructions section**, add step 3 (renumber existing steps):
      ```
      3. **Discover relevant docs and skills**: Read `docs/domains.md` and `docs/skills/README.md`.
         For each task in your rough breakdown, recommend which doc slugs and skill slugs apply
         based on the files being touched and the type of work. Each doc/skill file has a
         `triggers` frontmatter block with `files` (glob patterns), `change_types`, and `keywords`
         that indicate when it's relevant. Match these against the task's file patterns and change type.
      ```

      **In the Output contract**, add a new section 8:
      ```
      8. **Recommended docs and skills per task** — For each task in the rough breakdown,
         list which doc slugs (from docs/domains.md) and skill slugs (from docs/skills/README.md)
         the task should carry. Base this on the trigger metadata in each doc/skill file's
         frontmatter. If unsure, include the slug — the implementer benefits from extra context.
      ```

      **In the Prompt template**, add to the instructions block:
      ```
      4. **Discover docs and skills**: Read `docs/domains.md` and `docs/skills/README.md`.
         Each doc and skill file has trigger frontmatter (files, change_types, keywords).
         For each task in your breakdown, recommend matching doc and skill slugs.

         **Recommended docs and skills per task**
         - For each task: list doc slugs and skill slugs that match based on triggers.
      ```

  - id: strengthen-plan-authoring-docs-skills
    content: Strengthen docs/skills guidance in plan-authoring rule
    agent: implementer
    skill: [rule-authoring, documentation-sync]
    changeType: modify
    intent: |
      Modify .cursor/rules/plan-authoring.mdc to strengthen the docs/skills guidance.
      In the Todo Fields table, change docs and skill from optional to recommended.
      Add guidance text explaining that agents should match using trigger metadata
      in doc/skill frontmatter. Add a new section called Assigning docs and skills
      after the Todo Fields table. The section should explain that every task SHOULD
      have at least one doc or skill assigned, that the planner-analyst output includes
      recommended docs/skills per task, and that the import pipeline will auto-suggest
      for tasks that have none. Reference docs/domains.md and docs/skills/README.md
      as the lookup tables for available slugs and their trigger patterns.
isProject: false
---

## Analysis

### The problem

Out of 248 total tasks, only 58 have docs and 64 have skills assigned. The last plan to use docs/skills was "Batch CLI operations" (Feb 26). Every plan created since then — including today's "Status Polish", "Health Check", and "Bun Test" plans — has zero docs/skills on any task.

The infrastructure is fully built:

- `task_doc` and `task_skill` junction tables exist and work
- `tg context` surfaces `doc_paths` and `skill_docs` to the implementer
- The implementer prompt has `{{DOC_PATHS}}` and `{{SKILL_DOCS}}` placeholders
- The parser handles `docs` and `skill` fields from plan YAML
- 13 skill guides and 8 domain docs exist with useful content

But the pipeline that **populates** them is broken at three points:

1. **Planner-analyst** never discovers or recommends docs/skills
2. **Plan authoring** treats docs/skills as optional with no matching guidance
3. **Import** blindly stores whatever the plan provides (empty arrays)

### Usage data

```
Plans with docs/skills:     16 of 37 (43%)
Tasks with docs:            58 of 248 (23%)
Tasks with skills:          64 of 248 (26%)
Recent plans (last 5):      0% docs/skills usage
```

Top skill usage (when assigned): cli-command-implementation (21), documentation-sync (13), integration-testing (10).

### Approach

Three complementary fixes that work independently but compound:

**A. Planner-analyst prompt** — cheapest fix, highest immediate impact. If the analyst recommends docs/skills, the orchestrator will include them in the plan. No code changes, just prompt engineering.

**B. Trigger metadata** — structured data that enables both human planners and automated tooling to match docs/skills to tasks. Uses the same YAML frontmatter pattern already used in Cursor rules.

**C. Auto-suggest at import** — safety net that catches tasks the planner missed. Warns in console and auto-assigns when tasks have no docs/skills but triggers match. Never overrides manual assignments.

## Dependency graph

```
Parallel start (5 unblocked):
  ├── add-trigger-metadata-to-skills
  ├── add-trigger-metadata-to-docs
  ├── create-registry-module
  ├── update-planner-analyst
  └── strengthen-plan-authoring-docs-skills

After trigger metadata + registry module:
  ├── auto-suggest-at-import
  └── registry-unit-tests
```

<original_prompt>
I find it interesting that the tasks we are creating dont have any docs or skills related to them. I suspect this is a failure of the planning step or maybe there are a lack of docs? or maybe the docs and doc skills dont have enough metadata for the planning to use them meaningfully/efficiently. Make a plan for this and include A (teach planner-analyst), B (add trigger metadata), and C (auto-suggest at import).
</original_prompt>
