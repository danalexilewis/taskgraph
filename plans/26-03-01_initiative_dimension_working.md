---
name: Initiative Dimension Working
overview: Get the initiative dimension fully working so initiatives (collections of projects, linked to strategic cycle) are visible in the dashboard and manageable via tg initiative commands.
fileTree: |
  src/cli/
  ├── status.ts         (modify — getActivePlansSectionContent, default dashboard)
  ├── initiative.ts     (verify, doc, test)
  └── dashboard.ts      (no change; uses status)
  src/db/
  └── migrate.ts        (verify only)
  docs/
  ├── cli-reference.md  (modify)
  └── schema.md         (verify)
  __tests__/
  └── integration/
      └── initiative.test.ts  (extend or add)
risks:
  - description: Default dashboard "Active Plans" table gets wider; narrow terminals may wrap.
    severity: low
    mitigation: Use same Initiative column pattern as formatDashboardProjectsView (minWidth 10, optional); narrow layout can abbreviate "Initiative" to "Initiative" or "Init" per cli-tables conventions.
  - description: Old DBs without initiative table see "—" in Initiative column; no functional break.
    severity: low
    mitigation: Already handled by tableExists(initiative) and initiative_title ?? "—".
tests:
  - "Unit or integration: default status/dashboard output includes Initiative header when initiative table exists (getActivePlansSectionContent)."
  - "Integration: tg initiative list | show | assign-project work when initiative table exists; clear message when missing."
todos:
  - id: add-initiative-default-active-plans
    content: "Add Initiative column to default Active Plans section (getActivePlansSectionContent)"
    agent: implementer
    intent: |
      The default tg status and tg dashboard (without --projects) show an "Active Plans" block built by getActivePlansSectionContent in src/cli/status.ts. That function currently renders Project name, Todo, Ready, Doing, Blocked, Done only. activePlans already carry initiative_title when the initiative table exists (from fetchStatusData).
      Add an "Initiative" column: in planRows include p.initiative_title ?? "—" (same position as in formatDashboardProjectsView, after Project name). Add "Initiative" to headers (narrow and wide). Add a Total row cell (empty or "") for the Initiative column. Adjust minWidths/maxWidths so the table still fits; follow docs/cli-tables.md for column widths. Narrow layout may use "Init" if needed.
    suggestedChanges: |
      In getActivePlansSectionContent: planRows map add second element p.initiative_title ?? "—"; aggRow add "" for Initiative; headers add "Initiative" (or "Init" when narrow); minWidths add 10 for Initiative column.
    changeType: modify
    docs: ["cli-tables", "cli-reference"]
  - id: verify-initiative-migrations
    content: "Verify initiative table and Unassigned default exist on tg init and ensureMigrations"
    agent: implementer
    intent: |
      Confirm that tg init and ensureMigrations (run on every non-init command) both create the initiative table and apply the default Unassigned initiative + project.initiative_id backfill when needed. No code change required unless a gap is found. Check src/db/migrate.ts MIGRATION_CHAIN and init's migration list; ensure applyInitiativeMigration and applyDefaultInitiativeMigration run. Document in plan body or a short note if any edge case is found.
    changeType: modify
    docs: ["schema", "infra"]
  - id: document-test-tg-initiative
    content: "Document and test tg initiative commands (list, show, assign-project, backfill, new)"
    agent: implementer
    intent: |
      Ensure tg initiative is the primary way to manage initiatives. Update docs/cli-reference.md with a clear "Initiative commands" subsection (tg initiative new, list, show, assign-project, backfill) and when the initiative table is required. Add or extend __tests__/integration/initiative.test.ts so that when the initiative table exists, list/show/assign-project (and optionally new/backfill) are smoke-tested; when the table is missing, commands exit with the existing "run tg init" message. Reuse existing initiative integration test setup if present.
    changeType: modify
    docs: ["cli-reference", "testing"]
  - id: cycle-initiative-discoverability
    content: "Cycle–initiative connection and discoverability in status/help"
    agent: implementer
    intent: |
      Strategic cycle connection: initiative.cycle_id links to cycle; dashboard already shows current cycle and initiative_count when both tables exist. Ensure tg status --initiatives shows cycle when available (fetchInitiativesTableData already has cycle_name in one code path; verify it is used in formatInitiativesAsString or list output). Add a short discoverability note: e.g. in tg status default output or in help text, mention that tg initiative list and tg status --initiatives show initiatives and that initiatives group projects and link to cycles. Optionally add one line in dashboard footer or status summary when current cycle exists (e.g. "Cycle: <name> (N initiatives)").
    changeType: modify
    docs: ["schema", "cli-reference", "cli"]
isProject: false
---

## Analysis

Initiative is a dimension for organizing work: a **collection of projects** that connects to the **strategic cycle**. The schema already has `initiative`, `project.initiative_id`, and `initiative.cycle_id`; `tg initiative` provides list, show, assign-project, backfill, and new. The gap is visibility and discoverability:

- **Dashboard / status:** The **projects table** view (`tg status --projects`, `tg dashboard --projects`) already includes an Initiative column. The **default** status and dashboard (no `--projects`) show an "Active Plans" block built by `getActivePlansSectionContent`, which does **not** include Initiative. So users running plain `tg status` or `tg dashboard` never see Initiative unless they switch to `--projects`. Adding Initiative to that default section is the main fix so the column is visible everywhere.
- **Migrations:** Initiative table and default Unassigned are created by migrations run on `tg init` and on every command via `ensureMigrations`. Verified: both `applyInitiativeMigration` and `applyDefaultInitiativeMigration` are included in both paths; no code changes required.
- **CLI surface:** `tg initiative` is the primary surface; document it clearly and add smoke tests so it works when the table exists and fails with a clear message when it does not.
- **Cycle:** Cycle banner already shows initiative count; ensure `tg status --initiatives` and help make the cycle–initiative link discoverable.

## Dependency graph

```
Parallel start (4 unblocked):
  ├── add-initiative-default-active-plans   (Initiative in default Active Plans)
  ├── verify-initiative-migrations          (Verify init + ensureMigrations)
  ├── document-test-tg-initiative           (Docs + integration tests)
  └── cycle-initiative-discoverability      (Cycle in initiatives view, discoverability)
```

No task blocks another; all can run in parallel.

## Proposed changes

- **getActivePlansSectionContent:** Insert Initiative as second column (after Project name). Row: `[p.title, p.initiative_title ?? "—", String(p.todo), ...]`. Headers: add "Initiative" (or "Init" in narrow mode). Total row: add "" for Initiative. Column width: min 10, consistent with formatDashboardProjectsView.
- **Docs:** cli-reference subsection for `tg initiative`; status/initiatives and cycle banner described; glossary or status help note for "initiatives = collections of projects, link to cycle."
- **Tests:** Initiative column present in default status output when initiative table exists; tg initiative list/show/assign exit 0 with table, clear message without.

## Open questions

- None; analyst and checklist resolved scope.

## Original prompt

<original_prompt>
i dont see an initiative column. initiative is a another dimention of organisiting its collections of projects and connects to our strategic cycle. we have been trying to get it working and getting it working in the dashboard and woking through the tg initiative <command> will help/be our first target /plan
</original_prompt>
