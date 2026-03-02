---
name: Initiative-Aware Plan Ingestion
overview: Update plan format and import pipeline so plans that name an initiative create the initiative and (optionally) multiple projects under it; initiatives close at cycle end, not by project completion.
fileTree: |
  src/
  ├── plan-import/
  │   ├── parser.ts              (modify)
  │   └── importer.ts            (modify)
  ├── cli/
  │   └── import.ts              (modify)
  docs/
  ├── plan-format.md             (modify)
  ├── plan-import.md              (modify)
  ├── schema.md                  (modify)
  └── glossary.md                (modify)
  __tests__/
  ├── plan-import/
  │   └── parser.test.ts          (modify)
  └── integration/
      └── initiative-import.test.ts  (create)
risks:
  - description: Parser output type change (single vs strategic) could break callers outside import
    severity: medium
    mitigation: Export union type or discriminated result; import is sole consumer of strategic shape for now; add type guards
  - description: Two plan files with same initiative name could create duplicate initiatives if title normalization differs
    severity: low
    mitigation: Single code path - find initiative by title first (case-sensitive or agreed normal form), create only if missing
  - description: Re-import of strategic plan with fewer projects leaves orphan project rows
    severity: low
    mitigation: Document that strategic re-import does not delete projects; optional future --replace for projects
tests:
  - "Parse frontmatter with initiative key sets ParsedPlan.initiativeName; single-project unchanged when absent"
  - "Import plan with initiative name creates initiative when missing and sets project.initiative_id"
  - "Import strategic plan (projects array) creates N projects under one initiative and upserts tasks per project"
  - "Single-project plan with no initiative key retains current behavior (one project, Unassigned initiative)"
todos:
  - id: format-docs-initiative-multiproject
    content: Document initiative and optional projects in plan-format and plan-import
    agent: documenter
    intent: |
      In docs/plan-format.md: add optional top-level `initiative: <string>` (initiative name). Document optional
      `projects: [{ name, overview?, todos, ... }]` for multi-project plans; when absent, file is single-project.
      In docs/plan-import.md: describe import behavior when initiative is present (create/find initiative, set
      project.initiative_id) and when projects array is present (N projects, one initiative). State backward
      compatibility: no initiative and no projects array equals current one file to one project, Unassigned.
    changeType: modify
    domain: plan-format

  - id: parser-initiative-frontmatter
    content: Add initiative to Cursor frontmatter and ParsedPlan; parse single-project initiative
    agent: implementer
    intent: |
      In src/plan-import/parser.ts: add `initiative?: string` to CursorFrontmatter and to ParsedPlan. In
      frontmatterToParsedPlan (and parseCursorPlan), read fm.initiative and set parsedPlan initiative name.
      Single-project files: one ParsedPlan with optional initiativeName. No multi-project structure yet;
      this task only adds the initiative field so import can use it for single-project plans.
    changeType: modify
    domain: plan-import

  - id: import-resolve-initiative-by-name
    content: Import creates or finds initiative by name and sets project.initiative_id
    agent: implementer
    blockedBy: [parser-initiative-frontmatter]
    intent: |
      In src/cli/import.ts: when parsedPlan has initiative name (and tableName is project), resolve initiative
      by title (SELECT initiative_id FROM initiative WHERE title = ?). If none, insert new initiative (title,
      description default e.g. "Created from plan import", status draft). Set insertPayload.initiative_id and
      planUpdatePayload.initiative_id to resolved initiative_id. Remove or keep --initiative CLI as override
      when both CLI and frontmatter provided (decide: frontmatter wins vs CLI wins; recommend frontmatter
      when present). Ensure Unassigned remains default when no initiative in frontmatter and no --initiative.
    changeType: modify
    domain: plan-import

  - id: parser-multiproject-output
    content: Parser supports optional projects array and returns strategic shape
    agent: implementer
    blockedBy: [format-docs-initiative-multiproject]
    intent: |
      In src/plan-import/parser.ts: define ParsedStrategicPlan { initiativeName?: string; projects: ParsedPlan[] }.
      When frontmatter has `projects:` array, parse each element with same rules as single plan (name, overview,
      todos, etc.) and produce ParsedStrategicPlan. When no projects array, produce single ParsedPlan (backward
      compat). parseCursorPlan return type: ParsedPlan | ParsedStrategicPlan (or wrapper with discriminant).
      Reuse frontmatterToParsedPlan per project in the array. File-level initiative name applies to all projects
      in strategic case; single-project case keeps initiative on that one ParsedPlan.
    changeType: modify
    domain: plan-import

  - id: import-multiproject-create-projects
    content: Import creates initiative and N projects when parser returns strategic plan
    agent: implementer
    blockedBy: [parser-multiproject-output, import-resolve-initiative-by-name]
    intent: |
      In src/cli/import.ts: when parser result is ParsedStrategicPlan, resolve or create initiative by
      initiativeName (same as single-project). For each project in strategic.projects: find project by title
      (and optional source_path or file scope) or create new project row; set initiative_id to resolved
      initiative; upsert tasks and edges for that project via existing upsertTasksAndEdges(plan_id, tasks).
      Define CLI semantics: for strategic file, --plan may be optional (file path identifies the import) or
      used as initiative title; document in plan-import.md. Pre-flight unmatched task check per project when
      re-importing; --force and --replace apply per project.
    changeType: modify
    domain: plan-import

  - id: lifecycle-doc-cycle-bound-closure
    content: Document initiative lifecycle; initiatives close at cycle end, not by project completion
    agent: documenter
    intent: |
      In docs/schema.md and docs/glossary.md: state explicitly that an initiative is not completed by
      completing its projects; it is closed at the end of its strategic cycle (cycle boundary). Add a short
      "Initiative lifecycle" subsection in schema.md: initiative.status can be set to done when the cycle
      ends (e.g. CURDATE() > cycle.end_date) or by manual/script; no automatic status change in code required
      for this plan. Glossary: initiative entry should say "closed at cycle end, not by project/task completion."
    changeType: modify
    domain: schema

  - id: tests-parser-initiative
    content: Add parser tests for initiative and strategic shape
    agent: implementer
    blockedBy: [parser-initiative-frontmatter, parser-multiproject-output]
    intent: |
      In __tests__/plan-import/parser.test.ts: add tests that (1) frontmatter with initiative key produces
      ParsedPlan with initiativeName set; (2) frontmatter without initiative leaves it undefined; (3) when
      projects array present, parser returns ParsedStrategicPlan with N projects and optional initiativeName;
      (4) single-project with no projects array returns ParsedPlan. Cover edge cases: empty projects array
      (treat as single-project or fail; decide and test).
    changeType: test
    domain: testing

  - id: tests-import-initiative-integration
    content: Add integration tests for import with initiative and multi-project
    agent: implementer
    blockedBy:
      [import-resolve-initiative-by-name, import-multiproject-create-projects]
    intent: |
      In __tests__/integration/initiative-import.test.ts (or extend existing initiative test): (1) Import a
      single-project plan with initiative name in frontmatter; assert initiative row created or found, and
      project.initiative_id set. (2) Import a strategic plan (projects array) with initiative name; assert
      one initiative and N project rows, each with correct initiative_id and tasks upserted per project.
      (3) Re-import same single-project plan; no duplicate initiative. Use ensureMigrations and existing
      integration DB patterns.
    changeType: test
    domain: testing

  - id: run-full-suite
    content: Run full test suite (pnpm gate:full) and record result in evidence
    agent: implementer
    blockedBy:
      [
        tests-parser-initiative,
        tests-import-initiative-integration,
        lifecycle-doc-cycle-bound-closure,
      ]
    intent: |
      Run pnpm gate:full (or bash scripts/cheap-gate.sh --full) and record outcome in tg done evidence.
      If failures: note task with tg note and either leave task not done or mark done with failure summary.
    changeType: test
isProject: false
---

## Analysis

The codebase currently maps one plan file to one project; initiative is set only via CLI `--initiative`. The parser does not read frontmatter `initiative` (plan-format.md documents it but parser/importer do not implement it). Initiative and project tables already support initiative → projects → tasks; the gap is format, parser, and import behavior. "Initiative closed at cycle end" is a policy that we document using existing cycle and initiative columns; no schema change required.

**Approach:** (1) Add optional `initiative` and optional `projects` to the plan format and document behavior. (2) Parser: add `initiativeName` to ParsedPlan for single-project; add ParsedStrategicPlan with `initiativeName?` and `projects: ParsedPlan[]` when frontmatter has `projects` array. (3) Import: when initiative name present, find initiative by title or create; set project.initiative_id. When strategic shape, create/find initiative once, then for each project create/find project row, set initiative_id, upsert tasks. (4) Document initiative lifecycle: closed at cycle boundary, not by project completion.

**Rejected:** Adding automatic job to set initiative status at cycle end in this plan — documented policy is enough; automation can be a follow-up.

## Dependency graph

```
Parallel start (2 unblocked):
  ├── format-docs-initiative-multiproject
  └── parser-initiative-frontmatter

After format-docs + parser-initiative:
  ├── import-resolve-initiative-by-name
  └── parser-multiproject-output

After parser-multiproject-output + import-resolve-initiative-by-name:
  └── import-multiproject-create-projects

Independent (parallel to above):
  └── lifecycle-doc-cycle-bound-closure

After parser tasks:
  └── tests-parser-initiative

After import-multiproject + import-resolve:
  └── tests-import-initiative-integration

After tests-parser-initiative + tests-import-initiative-integration + lifecycle-doc-cycle-bound-closure:
  └── run-full-suite
```

## Proposed changes

- **Parser:** `CursorFrontmatter` gains `initiative?: string`. `ParsedPlan` gains `initiativeName?: string`. New type `ParsedStrategicPlan { initiativeName?: string; projects: ParsedPlan[] }`. `parseCursorPlan` returns `ParsedPlan | ParsedStrategicPlan` based on presence of `projects` array; when present, each element is normalized via same logic as single plan.
- **Import:** Helper `resolveOrCreateInitiative(q, title, repoPath)` → initiative_id. When parsed has initiativeName: call helper, set initiative_id on create/update. When parsed is ParsedStrategicPlan: call helper once; for each project in strategic.projects, find or create project by title (and source_path), set initiative_id, then upsertTasksAndEdges(plan_id, project.tasks).
- **CLI:** Keep `--plan` as plan title or ID for lookup; for strategic file, first project name or initiative name can match. `--initiative` remains override; when frontmatter has initiative, frontmatter wins (or document that --initiative overrides frontmatter when both provided — recommend frontmatter wins for "plan names initiative" semantics).

## Initiative lifecycle (documented)

Initiatives are not completed by finishing their projects. They are closed at the end of the strategic cycle (cycle boundary). Schema already has initiative.status and initiative.cycle_id / cycle_end; no code change required. Document in schema.md and glossary; optional future CLI or cron can set status to done when cycle end is past.

## Open questions

- Empty `projects: []`: treat as invalid (fail parse) or as single-project with initiative only? Recommendation: fail parse with clear error so author must omit key or provide at least one project.
- Re-import strategic plan with fewer projects: leave existing extra project rows as-is (document) or support --replace to soft-delete projects no longer in file? This plan leaves as-is; follow-up can add --replace for projects.

<original_prompt>
Update the plan format and plan ingestion pipeline so that plans that name an initiative end up creating initiatives and as many projects as the plan outlines. Initiatives are not completed by any one project or group of projects; they are closed at the end of the strategic cycle. /plan
</original_prompt>
