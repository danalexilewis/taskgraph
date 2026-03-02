---
name: OpenTUI Dashboard Normalise
overview: Normalise the tg dashboard to OpenTUI best practices and suggested libraries from the review report (remove double border, multi-Box section layout, optional TextTable and native styling, ASCII symbol fallback, document TG_ASCII_DASHBOARD).
fileTree: |
  src/cli/
  ├── dashboard.ts              (modify)
  ├── status.ts                (modify)
  ├── table.ts                 (no change for rec 1-5)
  └── tui/
  ├── boxen.ts                 (reference only for useAsciiBorders)
  └── live-opentui.ts          (modify)
  docs/
  ├── cli-reference.md        (modify)
  └── infra.md                (modify)
  __tests__/
  └── cli/
      ├── dashboard.test.ts    (run/update if needed)
      └── dashboard-format.test.ts (run/update for ASCII symbols)
risks:
  - description: Fallback path (Node or OpenTUI init failure) must produce identical logical output
    severity: medium
    mitigation: Keep formatStatusAsString and boxedSection for fallback; add OpenTUI-only code paths that consume same data; run dashboard-format and dashboard tests after each task
  - description: OpenTUI TextTable requires RenderContext; public API may only expose Box/Text constructs
    severity: low
    mitigation: Check @opentui/core exports for TextTable construct or create renderable from renderer context; if unavailable, keep table-as-string inside section Box for rec 2 and defer native table
tests:
  - "Fallback dashboard output unchanged (format and structure)"
  - "TG_ASCII_DASHBOARD=1 produces ASCII symbols in status/dashboard output"
  - "OpenTUI path uses multiple Boxes per section (rec 2) without regressing fallback"
todos:
  - id: remove-root-border
    content: "Set root Box border false in all OpenTUI dashboard entry points in live-opentui.ts"
    agent: implementer
    intent: |
      Remove double border (our boxen content already has borders). In src/cli/tui/live-opentui.ts, every root Box created with Box({ id: STATUS_ROOT_ID or equivalent, borderStyle: "round", border: true, ... }) must be changed to border: false (or omit border). Locations: runOpenTUILive (line ~151), runOpenTUILiveDashboardTasks (~306), runOpenTUILiveDashboardProjects (~490), runOpenTUILiveProjects (~661), runOpenTUILiveTasks (~814), runOpenTUILiveInitiatives (~966), and the replaceRootWithNewBox helper (~107). After change, run pnpm tg dashboard (Bun) and confirm single set of borders; run fallback path (e.g. Node) and confirm output unchanged.
    changeType: modify
    docs: cli-tables
  - id: ascii-symbol-fallback
    content: "Add unified ASCII symbol fallback when TG_ASCII_DASHBOARD is set in status formatting"
    agent: implementer
    intent: |
      When useAsciiBorders() is true, replace Unicode status symbols with ASCII so dashboard is readable in all terminals. In src/cli/status.ts, introduce a small helper (e.g. getStatusSymbols() or symbolForStatus()) that returns { check, dot, triangle, diamond, emDash, warning } as either Unicode (✓ ● ▲ ◆ — ⚠) or ASCII ([x], *, ^, -, -, !). Use this helper everywhere we currently output those symbols: statusIconOnly, getMergedActiveNextContent, formatDashboardTasksView, formatDashboardProjectsView, getDashboardFooterBox/footer content, and any other chalk.yellow/cyan that uses these chars. Import useAsciiBorders from tui/boxen. Add or extend test in __tests__/cli/dashboard-format.test.ts that runs with TG_ASCII_DASHBOARD=1 and asserts no Unicode symbols in stripped output (or snapshot).
    changeType: modify
    docs: cli-tables
    skill: refactoring-safely
  - id: doc-tg-ascii-dashboard
    content: "Document TG_ASCII_DASHBOARD in cli-reference or infra"
    agent: implementer
    intent: |
      Add TG_ASCII_DASHBOARD to the env vars table in docs/cli-reference.md or docs/infra.md (infra already documents other TG_* vars). One-line description: when the dashboard looks garbled (box-drawing or symbols as replacement glyphs), set TG_ASCII_DASHBOARD=1 for ASCII-only borders and symbols.
    changeType: modify
    docs: cli-reference
    skill: documentation-sync
  - id: opentui-section-structure
    content: "Build OpenTUI dashboard from multiple Box+Text sections with OpenTUI borders only"
    agent: implementer
    intent: |
      For the OpenTUI path only, stop putting one giant string into one Text. Build the default dashboard (and --tasks, --projects where applicable) from multiple Box children of the root: one Box per section (e.g. "Active Projects", "Active tasks and upcoming", footer) with borderStyle "rounded", title, padding, and a single Text child whose content is the section content string WITHOUT boxen. Use existing helpers: getActivePlansSectionContent, getMergedActiveNextContent, getDashboardFooterContent/getDashboardFooterBox content, etc. Root Box: flexDirection "column", gap 1, width from getTerminalWidth(), border false. Fallback path (formatStatusAsString with dashboard: true) must be unchanged and still use boxedSection. Reuse same row limits (getDashboardRowLimitsDynamic, DASHBOARD_MAX_PLANS) so content height is consistent. Update live-opentui.ts for default dashboard first; then apply same pattern to --tasks and --projects views. Tests: fallback output matches current; OpenTUI path can be manually verified or we add a test that runs dashboard and asserts no double borders.
    changeType: modify
    docs: cli-tables
    skill: refactoring-safely
  - id: opentui-text-table
    content: "Use OpenTUI TextTableRenderable for dashboard tables in OpenTUI path"
    agent: implementer
    intent: |
      Replace table-as-string inside section Boxes with OpenTUI TextTableRenderable where the API allows. Build TextTableContent (rows of TextChunk[]) from the same data we pass to renderTable (headers + rows). Map header row to TextChunk[] with distinct fg/bg (e.g. via @opentui/core StyledText or fg/bg); body rows from StatusData (activePlans, activeWork, nextTasks, etc.). Add the TextTable as child of the section Box instead of Text(tableString). If @opentui/core does not expose a TextTable construct and requires RenderContext to instantiate TextTableRenderable, discover the correct way to add it to the tree (e.g. renderer.root or a factory from createCliRenderer). Fallback continues to use renderTable() and boxedSection. Scope to default dashboard sections first (Active Projects table, Active tasks table); footer can remain Text(content) if it is not a table. Tests: visual check; optionally unit test that builds TextTableContent from mock row data.
    changeType: modify
    blockedBy: [opentui-section-structure]
    docs: cli-tables
    skill: refactoring-safely
  - id: opentui-native-styling
    content: "Use OpenTUI StyledText or Text fg/bg for dashboard styling in OpenTUI path"
    agent: implementer
    intent: |
      For the OpenTUI path only, stop embedding chalk ANSI in the dashboard content. Use OpenTUI StyledText (t template, green, cyan, bold, fg/bg from @opentui/core) or Text node props (fg, bg) for section titles and table styling. Optionally subscribe to renderer.themeMode for dark/light. Live-opentui (or a small adapter) builds StyledText from the same semantic data (e.g. "header", "highlight", "muted") so we do not duplicate color logic in status.ts; status.ts continues to use chalk for fallback. Scope: section titles and any inline emphasis in section content; table cell styling if using TextTable (rec 5). Tests: fallback unchanged; OpenTUI path theme/color optional assertion.
    changeType: modify
    blockedBy: [opentui-section-structure]
    docs: cli-tables
    skill: refactoring-safely
isProject: false
---

## Analysis

The review report (reports/review-opentui-dashboard-vs-ecosystem-2026-03-02.md) compared our dashboard to OpenTUI best practices: we currently put one pre-rendered boxen+cli-table3+chalk string into a single Text inside one bordered Box, causing double borders and no use of OpenTUI layout or native tables. The report recommended six changes; this plan implements them in dependency order while keeping the fallback path (Node or when OpenTUI fails) unchanged and testable.

**Approach:** Quick wins first (remove root border, ASCII symbols, docs) in parallel with the larger refactor (section structure). Section structure (task opentui-section-structure) is the enabler for native TextTable and native styling; those two can proceed in parallel once section structure is done. We do not change formatStatusAsString for fallback — we add OpenTUI-only code paths that consume the same data (StatusData, existing section content helpers).

**Rejected:** Changing formatStatusAsString to return "sections array" for both paths — it would force fallback to recompose from sections and risk regressions. Instead we keep the current string path for fallback and have live-opentui build the tree from existing get*SectionContent helpers.

## Dependency graph

```
Parallel start (4 unblocked):
  ├── remove-root-border
  ├── ascii-symbol-fallback
  ├── doc-tg-ascii-dashboard
  └── opentui-section-structure

After opentui-section-structure:
  ├── opentui-text-table
  └── opentui-native-styling
```

## Proposed changes

- **remove-root-border:** In `replaceRootWithNewBox` and every `Box({ id: ..., borderStyle: "round", border: true, ...})` in live-opentui.ts, set `border: false`.
- **ascii-symbol-fallback:** New helper in status.ts (e.g. `getStatusSymbols()`) returning object of symbols; when `useAsciiBorders()` true return ASCII. Replace all direct use of ✓ ● ▲ ◆ — ⚠ with the helper.
- **opentui-section-structure:** Root = `Box({ flexDirection: "column", gap: 1, width: w, border: false }, ...sectionBoxes)`. Each section = `Box({ borderStyle: "rounded", title: "Active Projects", padding: 1 }, Text({ content: getActivePlansSectionContent(...) }))` (no boxedSection). Same for Active tasks and footer. Fallback still calls `formatStatusAsString(..., { dashboard: true })`.
- **opentui-text-table:** Build `TextTableContent` from headers + rows; add `TextTable` (or `TextTableRenderable` with context) as child of section Box. Use StyledText/TextChunk for header row.
- **opentui-native-styling:** Section titles and table styling via OpenTUI `fg`/`bg` or `t` template; no chalk in the string passed to OpenTUI.

## Open questions

- Whether @opentui/core exposes a `TextTable` construct (like Box/Text) or only `TextTableRenderable` requiring RenderContext — to be confirmed during opentui-text-table. If only renderable, we need to obtain context from the renderer and add the node to the tree accordingly.

## Original prompt

<original_prompt>
/plan improvements based on the report normalise to openTui best practices and suggested libraries. @reports/review-opentui-dashboard-vs-ecosystem-2026-03-02.md
</original_prompt>
