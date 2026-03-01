# Enhanced Plan Format (Rich Planning)

This document defines the **enhanced Cursor plan format**: analysis-rich plans with file trees, risks, tests, per-task intent and suggested code changes, and a structured markdown body. It extends the base Cursor format described in [Plan Import](plan-import.md) and is the reference for [Plan Authoring](.cursor/rules/plan-authoring.mdc).

All new fields are **optional**. Existing plans without these fields continue to import and behave as before.

---

## Principles

1. **Plans are research artifacts** — They should contain enough analysis that an agent (or human) can understand the full picture without re-reading the codebase.
2. **Structured data in YAML, narrative in markdown body** — Machine-parseable fields flow into Dolt; free-form analysis, diagrams, and the original prompt live in the body.
3. **Suggested changes are directional** — They give the agent a head start (file, function, approach), not a blueprint to copy.
4. **Risks and tests are identified during planning** — So execution doesn’t discover “we should have tested that” too late.
5. **Original prompt is preserved** — In an `<original_prompt>` XML tag at the end of the body.

---

## YAML Frontmatter

### Required and Existing Fields

| Field       | Required | Description                           |
| ----------- | -------- | ------------------------------------- |
| `name`      | yes      | Plan title.                           |
| `overview`  | yes      | Brief description; can be multi-line. |
| `todos`     | yes      | Array of task objects (see below).    |
| `isProject` | no       | Boolean; default false.               |

### Plan-Level Optional Fields (Rich Planning)

| Field      | Type   | Stored in Dolt   | Description                                                                         |
| ---------- | ------ | ---------------- | ----------------------------------------------------------------------------------- |
| `fileTree` | string | `plan.file_tree` | Tree of files affected by the plan (e.g. paths with `(create)` / `(modify)`).       |
| `risks`    | array  | `plan.risks`     | List of `{description, severity, mitigation}`. `severity`: `low`, `medium`, `high`. |
| `tests`    | array  | `plan.tests`     | List of strings describing tests that should be created.                            |

### Todo (Task) Fields

Base fields (see [Plan Import](plan-import.md)): `id`, `content`, `status`, `blockedBy`, `docs`, `agent`, `skill`, `changeType`.

| Field              | Type   | Stored in Dolt           | Description                                                                                              |
| ------------------ | ------ | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `agent`            | string | `task.agent`             | Single slug or array specifying the agent or sub-agent to execute this task. Use `agent: debugger` for debugging tasks (root-cause investigation, failing tests with unknown cause). |
| `intent`           | string | `task.intent`            | Detailed description of what this task involves and why. Can reference files, functions, or constraints. |
| `suggestedChanges` | string | `task.suggested_changes` | Proposed code snippets or diffs as a starting point for the agent. Directional, not prescriptive.        |

**Note:** `content` is used as the task title and must fit in the DB `title` column (VARCHAR(255)). Keep titles concise; put long descriptions in `intent`.

---

## Plan-Level Field Examples

### fileTree

Visual tree of files touched by the plan using `├──` / `└──` connectors. Annotations like `(create)` or `(modify)` are optional but help readers. Group by directory; the tree format is more scannable than flat indented lists.

```yaml
fileTree: |
  docs/
  └── plan-format.md               (create)
  src/
  ├── db/
  │   └── migrate.ts               (modify)
  ├── domain/
  │   └── types.ts                 (modify)
  └── plan-import/
      └── parser.ts                (modify)
  __tests__/
  └── integration/
      └── rich-plan.test.ts        (create)
```

### risks

Array of objects. Stored as JSON on the plan row and shown in `tg context` so the agent sees known risks.

```yaml
risks:
  - description: Migration could fail on existing data
    severity: high
    mitigation: Add pre-flight validation and dry-run mode
  - description: Parser changes could break existing plan imports
    severity: medium
    mitigation: Backward-compatible — all new fields are optional
```

### tests

Array of strings describing tests to add. Stored as JSON on the plan row.

```yaml
tests:
  - "Import plan with fileTree, verify stored on plan row"
  - "tg context outputs suggested_changes when present"
  - "Existing plans without new fields still import (backward compat)"
```

---

## Per-Task intent and suggestedChanges

### intent

Maps to `task.intent`. Use for scope, rationale, and references to code.

```yaml
- id: add-migration
  content: Add plan table columns file_tree, risks, tests via idempotent migration.
  intent: |
    Add three nullable columns to the plan table in db/migrate.ts.
    Follow the applyTaskDimensionsMigration pattern: check column existence,
    then ALTER TABLE. Idempotent so re-run is safe.
  domain: schema
  skill: sql-migration
  changeType: modify
```

### suggestedChanges

Maps to `task.suggested_changes`. Shown by `tg context` so the agent has a concrete starting point. Can be a short snippet or a pointer; avoid pasting huge blocks (put those in the markdown body and summarize here).

```yaml
- id: update-types
  content: Update PlanSchema and TaskSchema in domain/types.ts with new columns.
  suggestedChanges: |
    PlanSchema: add file_tree (z.string().nullable()), risks (z.array(riskObj).nullable()), tests (z.array(z.string()).nullable()).
    TaskSchema: add suggested_changes (z.string().nullable()).
  blockedBy: [rich-schema-plan-columns, rich-schema-task-columns]
```

---

## Markdown Body (Below Frontmatter)

The content **after** the closing `---` of the frontmatter is the **narrative layer**. It is not parsed into individual DB columns but is part of the plan document for humans and agents.

### Recommended Sections

1. **Analysis** — Why this approach; what was explored or rejected.
2. **Dependency Graph** — Visual tree showing execution waves (what runs in parallel, what is gated). Required for all plans with dependencies. See example below.
3. **Proposed Changes** — Detailed code snippets, file paths, key logic (especially for complex changes).
4. **Mermaid Diagrams** — Data flows, state machines, or supplementary dependency views. Complements the tree graph.
5. **Risks** — Expanded discussion beyond the YAML `risks` list.
6. **Testing Strategy** — How tests will be structured and what they cover.
7. **Open Questions** — Unresolved items that may affect execution.

### Dependency Graph (tree format)

Show execution order using `├──` / `└──` connectors. Group tasks into waves based on what can run concurrently vs what is blocked. This is the quick-scan execution plan that humans and orchestrators read first.

```text
Parallel start (2 unblocked):
  ├── add-migration (schema changes)
  └── write-format-spec (docs)

After add-migration:
  ├── update-parser
  └── update-importer

After all above:
  └── integration-tests
```

### Plan end structure (required)

Every plan must end with (a) one or more **add-tests** tasks (creating tests for new features or covering plan-level tests) and (b) a final **run-full-suite** task (e.g. `pnpm gate:full`). These tasks must be blocked by all feature work in the dependency graph. The run-full-suite task records the result in evidence; on failure the agent adds a `tg note` with the failure reason and either does not mark done or marks done with failure in evidence. Full authoring guidance: [Plan Authoring](../.cursor/rules/plan-authoring.mdc) → Required end-of-plan structure.

### Original Prompt

End the body with the user request that triggered the plan, inside an XML tag:

```xml
<original_prompt>
The user's original request that triggered this plan...
</original_prompt>
```

This preserves intent that may not be fully reflected in the structured fields.

---

## Full Example (Minimal Rich Plan)

```yaml
---
name: Rich Planning - Example
overview: Add file_tree and risks to plans so agents see scope and risks in tg context.

fileTree: |
  docs/
  └── plan-format.md              (create)
  src/
  └── db/
      └── migrate.ts              (modify)

risks:
  - description: New columns might break existing queries
    severity: low
    mitigation: All new columns are nullable

tests:
  - "Import plan with fileTree and risks, verify stored and shown in tg context"

todos:
  - id: example-format-spec
    content: Write docs/plan-format.md with enhanced format spec.
    docs: plan-import
  agent: implementer
    skill: rule-authoring
    changeType: create
  - id: example-migration
    content: Add plan.file_tree and plan.risks columns.
    intent: Idempotent migration in db/migrate.ts; follow applyTaskDimensionsMigration pattern.
    suggestedChanges: "ALTER TABLE plan ADD COLUMN file_tree TEXT NULL, ADD COLUMN risks JSON NULL (after checking column existence)."
    blockedBy: [example-format-spec]
    domain: schema
    skill: sql-migration
    changeType: modify
isProject: false
---

## Analysis

This plan adds two optional plan-level fields so that imported plans can carry
file trees and risk registers into Dolt and agents can see them via `tg context`.

## Dependency graph

Parallel start (1 unblocked):
  └── example-format-spec (docs)

After example-format-spec:
  └── example-migration (schema)

## Open Questions

- Whether to support markdown body storage in a plan column for round-trip export.
```

---

## Plan Import Robustness

When agents create Cursor-format plans for `pnpm tg import`, the **taskgraph parser** uses `js-yaml` on the frontmatter. Certain YAML constructs cause parse failures; the error message includes the underlying cause. This section explains **how to make plans robust** so they import reliably, especially when using lower-capability (simple) models.

### Why Plans Fail to Import

- **Em dash in unquoted string**: `name: System review — Dolt` — `—` can confuse scalar parsing.
- **Multiline `|` with colons**: Colons in multiline content can be parsed as new keys.
- **Multiline `|` indentation**: Indent must be strict; mis-indent causes parse errors.
- **Nested objects in arrays**: e.g. `risks:` with long `mitigation` containing colons, quotes, parens.
- **Arrays of strings with colons**: `tests: - "Run X: verify Y"` can trip some parsers.

When import fails, the error message includes the js-yaml reason (e.g. "unclosed quote" or "expected"). Fix the frontmatter or move rich content to the body.

### Robust Plan Rules

**Rule 1: Use minimal, import-safe frontmatter when needed.**

Guaranteed to work:

```yaml
---
name: Plan Name Here
overview: Single line description, no pipes or colons in tricky places.
todos:
  - id: task-1
    content: Task title under 255 chars.
    status: pending
  - id: task-2
    content: Another task.
    status: pending
    blockedBy: [task-1]
isProject: false
---
```

- **name**: Short; no em dashes (—). Use hyphens or "and".
- **overview**: **Single line.** Avoid `|` multiline. Avoid arrows (→); use "to" or "->".
- **todos**: Only `id`, `content`, `status`. Add `blockedBy: [id1, id2]` with simple array syntax.
- Optional: `domain`, `skill`, `changeType`. Omit `fileTree`, `risks`, `tests`, `intent`, `suggestedChanges` from YAML if you hit parse errors.

**Rule 2: Put rich content in the markdown body.**

The body (below `---`) is **not** parsed by the importer. Put everything else there:

- **Intent per task**: `## Task: task-id` then the intent.
- **File tree**: As a list or code block.
- **Risks and tests**: As markdown lists.
- **Dependencies**: Mermaid or list so humans see them even if `blockedBy` is lost.
- **Suggested changes**: Under each task section.

Implementers can read the plan file when `tg context` lacks intent/fileTree.

**Rule 3: Keep blockedBy simple.**

```yaml
blockedBy: [decide-dolt-location]
```

Use task `id` values (kebab-case). Single line; no multiline arrays.

**Rule 4: Validate before committing.**

Run before considering the plan done:

```bash
pnpm tg import plans/yy-mm-dd_plan_slug.md --plan "Plan Name" --format cursor
```

If it fails, the error message includes the parse cause. Strip frontmatter down to the minimal schema (Rule 1) and move rich content to the body (Rule 2).

### Checklist for Plan Authors

- [ ] `name` has no em dash (—); use hyphen or "and".
- [ ] `overview` is a single line.
- [ ] `todos` have only `id`, `content`, `status`; optionally `blockedBy: [id]` on one line.
- [ ] No `fileTree`, `risks`, `tests`, `intent`, `suggestedChanges` in YAML if import has failed before (or keep them simple).
- [ ] Rich content (intent, risks, file tree, deps) is in the **markdown body**.
- [ ] Run `pnpm tg import plans/... --plan "..." --format cursor` to verify.

| Goal                     | Approach                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| Plan always imports      | Minimal frontmatter: name, single-line overview, todos (id, content, status, optional blockedBy). |
| Dependencies respected   | `blockedBy: [id]` in minimal form; document deps in body as backup.                               |
| Implementers get context | Put intent, file tree, suggested changes in **body**; link plan file when needed.                 |
| Parse errors debuggable  | Parser surfaces js-yaml error in the message so agents can fix the YAML.                          |

---

## Relationship to Other Docs

- **Import behavior**: [Plan Import](plan-import.md) — how `tg import --format cursor` works and how base Cursor fields are mapped.
- **Authoring guidance**: [Plan Authoring](.cursor/rules/plan-authoring.mdc) — when to use rich fields, mermaid, suggested changes, and the original prompt.
- **Schema**: [Schema](schema.md) — `plan.file_tree`, `plan.risks`, `plan.tests`, `task.suggested_changes`, `task.intent`.
- **CLI**: [CLI Reference](cli-reference.md) — `tg context` output when suggested_changes, file_tree, or risks are present.
