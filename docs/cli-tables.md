---
triggers:
  files: ["src/cli/table.ts", "src/cli/tui/boxen.ts", "src/cli/tui/live-opentui.ts", "src/cli/status.ts"]
  change_types: ["create", "modify"]
  keywords: ["table", "boxen", "renderTable", "column", "width", "padding", "dashboard", "OpenTUI"]
---

# CLI Table Rendering

Tables in the CLI are rendered with `renderTable()` (`src/cli/table.ts`) using `cli-table3` and wrapped in `boxedSection()` (`src/cli/tui/boxen.ts`) for visual grouping.

## Width Calculation

### Box deductions

`boxedSection` uses `boxen` with `borderStyle: "double"` and default `padding: 1`. The total horizontal deduction from outer terminal width in the standard (non-dashboard) case:

- **Border**: 1 char per side = 2
- **Padding**: 1 char per side = 2
- **Inner buffer**: 2 chars per side = 4 (prevents table touching box edge)
- **Total**: 8 chars

`getBoxInnerWidth(outerWidth)` computes this: `outerWidth - 8`, floored at 20.

Dashboard boxes use `DASHBOARD_BOX_PADDING = {top:1, bottom:1, left:2, right:2}` instead of uniform padding. Use `getBoxInnerWidthDashboard(outerWidth)` (`outerWidth - 6`) for inner width when rendering in dashboard mode.

### Table width budget

`renderTable` receives `maxWidth` which should be the **inner** width (after box deduction). The table then allocates:

- **Borders**: `colCount + 1` vertical bar characters
- **Cell padding**: `colCount * 2` (1 left + 1 right per cell, built into cli-table3 `colWidths`)
- **Content budget**: `maxWidth - borders - cellPadding`

**Critical rule**: When a table is inside a `boxedSection`, always pass `getBoxInnerWidth(w)` as `maxWidth`, never the raw terminal width `w`.

## Column Configuration

### flexColumnIndex

The "flex" column absorbs extra space when under budget and shrinks first when over. Default is 0 (first column).

- **Tables with Id + text columns** (Tasks, Active & next): Set `flexColumnIndex` to the text-heavy column (typically Title at index 1). Cap Id with `maxWidths: [10]`.
- **Tables with a primary name column** (Plans, Projects, Initiatives): Default 0 is correct since the name column is first.

### maxWidths

Cap narrow numeric columns to prevent them from growing unnecessarily:

```typescript
// Plan tables: 5 numeric cols (Todo, Blocked, Ready, Doing, Done) share the same width.
// Width = length of the longest header among the five (currently "Blocked" = 7).
const numericColW = Math.max(...headers.slice(1).map((h) => h.length));
// Set both minWidths AND maxWidths to numericColW for all five numeric columns:
minWidths: [
  12,
  numericColW,
  numericColW,
  numericColW,
  numericColW,
  numericColW,
];
maxWidths: [
  undefined,
  numericColW,
  numericColW,
  numericColW,
  numericColW,
  numericColW,
];

// Task tables with Id column
maxWidths: [10];
flexColumnIndex: 1; // Title is flex
minWidths: [10, 12, 10, 8, 6];
```

### minWidths

Set per-column minimums so columns don't collapse below readable widths. Falls back to 3 if not specified.

## Current Tables

| Location                       | Table                                                                                                   | Flex Col       | maxWidths (numeric cols = `numericColW`) |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------- |
| `getActivePlansSectionContent` | Active Plans + Total row (7–8 cols: Plan, Priority, [Initiative], Todo, Blocked, Ready, Doing, Done)     | 0 (Plan)       | `[_, Prio, (Initiative?), N, N, N, N, N]` |
| `getMergedActiveNextContent`   | Active & next (6 cols: Id, Task, Plan, Stale, Status, Agent)                                            | 1 (Task)       | `[10, _, _, 1]`                          |
| `formatProjectsAsString`       | Projects (6 cols)                                                                                       | 0 (Project)    | `[_, _, _, 4, 6, 4]`                     |
| `formatTasksAsString`          | Tasks: 5 cols (Id, Title, Project, Status, Owner); or 6 when `staleTaskIds` passed (adds Stale)         | 1 (Title)      | `[10]` or `[10, _, 10, 1, 6, 1]`         |
| `formatDashboardTasksView`     | Active tasks (6 cols: Id, Title, Plan, Stale, Owner, Status) — full width                               | 1 (Title)      | `[10, _, 10, 1, 6, 1]`                   |
| `formatDashboardTasksView`     | Next 7 runnable (5 cols: icon, Id, Task, Plan, Stale)                                                   | 2 (Task)       | `[1, 10, _, _, 1]`                       |
| `formatDashboardTasksView`     | Last 7 completed (5 cols: icon, Id, Task, Plan, Updated)                                                | 2 (Task)       | `[1, 10]`                                |
| `formatDashboardProjectsView`  | Active plans + Total row (7–8 cols: Plan, Priority, [Initiative], Todo, Blocked, Ready, Doing, Done) — full width | 0 (Plan)       | `[_, Prio, (Initiative?), N, N, N, N, N]` |
| `formatDashboardProjectsView`  | Next 7 upcoming (3 cols)                                                                                | 0 (Plan)       | —                                        |
| `formatDashboardProjectsView`  | Last 7 completed (4 cols: status icon, Plan, Status, Updated)                                           | 1 (Plan)       | `[1]` (icon)                             |
| `formatInitiativesAsString`    | Initiatives (5 cols)                                                                                    | 0 (Initiative) | —                                        |
| `getStaleDoingTasksContent`    | Stale Doing Tasks (4 cols)                                                                              | 1 (Title)      | `[10]`                                   |

`N` = `numericColW` (all five numeric plan columns use the same value). Tables with all text columns don't need `maxWidths`.

### Flex column fills available width

`renderTable` expands the flex column to consume leftover space when total natural width is under budget:

```typescript
// In table.ts — after measuring natural widths:
if (totalNatural <= contentBudget) {
  // ... set contentWidths from natural ...
  const leftover = contentBudget - totalSoFar;
  contentWidths[flexColumnIndex] += leftover; // absorbs slack → table fills full width
}
```

This is why Project name column tables fill the box width without needing to set a manual width. If you cap the flex column with `maxWidths`, it won't grow past that cap.

### Dashboard full width

The **top** table in each dashboard view uses `boxedSection(..., { fullWidth: true })` — no 200-char cap:

- `formatDashboardTasksView` → "Active tasks" box
- `formatDashboardProjectsView` → "Active plans" box

Other sections (Next 7, Last 7) do not use `fullWidth`; they are capped at 200 chars.

### Dashboard tasks: Stale and Status columns

The **Active tasks** table (and `formatTasksAsString` when `staleTaskIds` is passed) uses 6 columns — **Status moved last**, **Stale added before Owner**:

- **Stale** — yellow ▲ when the task has been in that section ≥2h (doing tasks: started >2h ago; from stale-doing set); "—" otherwise.
- **Status** (last column) — icon only: green ✓ done, red ● blocked, green ● todo/doing.

The **Next 7 runnable** table includes a **Stale** column: yellow ▲ when the task’s `updated_at` is ≥2h ago (runnable but unchanged for 2+ hours); "—" otherwise.

`formatTasksAsString` switches to 6-col mode only when `options.staleTaskIds` is explicitly provided (a `Set<string>`). When omitted it falls back to the original 5-col text-status layout, so callers that don't have stale data (e.g. JSON output path) are unaffected.

Tasks that just became done appear in the Active tasks section with a green ✓ in Status for 15 seconds before they are only shown in Last 7 completed. Plans that just completed show a green ✓ in the Last 7 completed plans table for 2 minutes.

### Plan tables: column order and Total row

Column order for all plan tables (dashboard default and `--projects`):

**Project name, [Initiative], Todo, Blocked, Ready, Doing, Done**

- **Initiative** is shown when the initiative table exists (optional); "—" when a plan has no initiative or the table is absent.
- **Blocked** sits between Todo and Ready so blocked count is visible before actionable (Ready) count.

Both `getActivePlansSectionContent` and `formatDashboardProjectsView` append a **Total** row after the plan rows. The totals use `Number(p.x)` coercion before summing to guard against string values from the DB.

### Typecheck gotcha: standalone `.d.ts` files

The changed-files typecheck builds a temporary `tsconfig.changed.json` that only includes the modified `src/*.ts` files. Standalone ambient declaration files (e.g. `src/ansi-diff.d.ts`) are **not** automatically picked up unless:

- They're referenced via `/// <reference path="..." />` in one of the included files, or
- The full `tsconfig.json` `include` glob covers them (it does for `pnpm typecheck:all`).

Fix: add `/// <reference path="../ansi-diff.d.ts" />` at the top of `dashboard.ts` so the changed-files path always includes it.

## Dashboard TUI: architecture and intent

**What we want:** The live dashboard (`tg dashboard`) should feel responsive and stable: in-place updates when possible (no full-screen clear), three clearly separated sections (Projects, Tasks, Stats), and a reliable fallback when the primary renderer is unavailable.

- **Primary path (OpenTUI):** When the runtime supports it (e.g. Bun), we use OpenTUI (`@opentui/core`, `createCliRenderer`) in `src/cli/tui/live-opentui.ts`. The root is a single Box with `border: false`; three child Boxes (Active Projects, Active tasks, Stats) use round borders, themed backgrounds, and when available OpenTUI TextTable for the two data sections so only changed cells are redrawn. Content is updated in place via `updateDefaultDashboardSections` so the terminal does not flash or clear.
- **Fallback path (Node / init failure):** When OpenTUI is unavailable (e.g. Node) or dynamic import/init fails (timeout or error), the dashboard falls back to a minimal TUI: `setInterval` at 2s, ANSI clear + the same status content produced by `formatStatusAsString(..., { dashboard: true })` with boxen section boxes. Output is diffed (ansi-diff) so only changed regions are written; no full-screen clear.
- **Do not simplify or remove the three sections** — the layout is intentional and hard to reconstruct from scratch. Refactors must preserve Active Projects, Active tasks, and Stats footer.
- **Timeouts:** OpenTUI's native Zig core can take several seconds to load under Bun on first call. The dynamic import timeout is **3000 ms** and the renderer init (e.g. `setupTerminal`) timeout is **2000 ms**. Do not reduce these; shorter values cause silent fallback to the plain ansi-diff renderer. See `.cursor/memory.md` and `live-opentui.ts`.
- **ASCII-safe mode:** When the terminal shows garbled box-drawing or symbols, set `TG_ASCII_DASHBOARD=1`. Documented in [infra.md](infra.md). Borders and table chars use ASCII in that case; status symbols (✓ ● ▲) may still be Unicode unless a future change adds symbol fallback in status formatting.
- **Typecheck:** OpenTUI is Bun-only and must stay out of Node-based typecheck. See [Testing — Typecheck and OpenTUI](testing.md#typecheck-and-opentui) and [research/cheap-gate-typecheck-lint-failures.md](research/cheap-gate-typecheck-lint-failures.md).

## Dashboard layout (two stacked tables + stats footer)

The default dashboard (`tg dashboard` with no flags) shows three stacked sections. **Do not simplify or remove any of these components during refactors — the visual design is intentional and hard to reconstruct from scratch.**

### Sections

1. **Active Projects** — cyan double-line bordered box, `fullWidth: true`, `DASHBOARD_BOX_PADDING`. Section title rendered inside the box via `formatSectionTitleRow("Active Projects")`. Plan rows (Plan, Todo, Ready, Doing, Blocked, Done) plus a **Total** row. Plans sorted by doing count → actionable count → todo count.

2. **Active tasks** — same cyan box treatment. Doing tasks only (Id, Task, Project, Stale, Status, Agent); placeholder row “No tasks being worked on atm” when none. `DASHBOARD_BOX_PADDING` applied.

3. **Stats footer** (`getDashboardFooterBox`) — yellow double-line bordered box, `fullWidth: true`, `DASHBOARD_BOX_PADDING`. "Stats" title in yellow bold. Contains `getDashboardFooterContent`: a responsive borderless grid (1–5 columns, `FOOTER_COL_MIN = 20` per column) of KPIs: Projects done, Tasks done, Active agents, Agents (defined), Sub-agents (defined), Total invocations, Agent hours, Investigator runs, Investigator fix rate. Stale doing count appended when > 0.

Sections are joined with `parts.join("\n")` (single newline — boxes visually touch).

### Key styling functions (do not remove)

| Function / Constant                    | Location       | Purpose                                        |
| -------------------------------------- | -------------- | ---------------------------------------------- |
| `getDashboardFooterBox(d, w)`          | `status.ts`    | Yellow bordered stats box                      |
| `getDashboardFooterContent(d, innerW)` | `status.ts`    | Borderless KPI grid inside the footer          |
| `getFooterGridColumns(innerW)`         | `status.ts`    | 1–5 col count based on `FOOTER_COL_MIN * N`    |
| `formatSectionTitleRow(name)`          | `status.ts`    | Cyan bold section label rendered inside box    |
| `DASHBOARD_BOX_PADDING`                | `status.ts`    | `{top:1, bottom:1, left:2, right:2}`           |
| `FOOTER_COL_MIN`                       | `status.ts`    | `20` — min chars per KPI column                |
| `STATS_LABEL`                          | `status.ts`    | `chalk.yellow` label style for KPI rows        |
| `getBoxInnerWidthDashboard(w)`         | `tui/boxen.ts` | Inner width for double-padding boxes: `w - 6`  |
| `sortActivePlansForDashboard(plans)`   | `status.ts`    | Sort: doing desc → actionable desc → todo desc |
| `BoxPadding` type                      | `tui/boxen.ts` | Per-side padding shape for `boxedSection`      |
| `getBoxInnerWidthTight(w)`             | `tui/boxen.ts` | Compact inner width (border-only deduction)    |

### Box styles

- **Data sections** (Active Projects, Active tasks): `borderColor: "cyan"`, `borderStyle: "double"`, `fullWidth: true`, `padding: DASHBOARD_BOX_PADDING`
- **Stats footer**: `borderColor: "yellow"`, `borderStyle: "double"`, `fullWidth: true`, `padding: DASHBOARD_BOX_PADDING`
- **Non-dashboard sections** (status, projects, tasks views): default `borderColor: "blue"`, `borderStyle: "double"`, uniform `padding: 1`

### Row caps and no-scroll guarantee

Row counts are governed by **both** a fixed cap and terminal height (whichever is tighter):

- Fixed caps: projects board shows **6 project rows + Total** (7 rows), with **empty lines** when fewer than 6 projects; max **13 tasks**; taskboard shows at least **7** rows (padded with — lines if fewer tasks), total ≤ **20**
- Terminal height: `getDashboardRowLimits` reserves `DASHBOARD_RESERVED_LINES = 12`, allocates ~40% to plans and ~60% to tasks
- Dynamic allocation: `getDashboardRowLimitsDynamic(actualTasks, actualPlans, terminalRows)` — task rows are at least `DASHBOARD_MIN_TASK_ROWS` (7); projects section always uses 7 rows (6 data + Total) with empty-line padding; unused task slots can flow to projects and vice versa, each bounded by their cap

`getTerminalHeight()` (from `src/cli/terminal.ts`) provides `process.stdout.rows` or a default of 24. Both `formatStatusAsString` (live TUI path) and `printHumanStatus` (one-shot console path) call `getDashboardRowLimitsDynamic` with `getTerminalHeight()`.

Both `getActivePlansSectionContent` and `getMergedActiveNextContent` accept an optional `innerWidthOverride` parameter — always pass `getBoxInnerWidthDashboard(w)` when rendering in dashboard mode so the inner width matches the special box padding.

## Adding a New Table

1. Compute inner width: `const innerW = getBoxInnerWidth(w)`
2. Pass `maxWidth: innerW` to `renderTable`
3. Set `flexColumnIndex` to the text-heavy column (not Id)
4. Set `maxWidths` to cap narrow columns (Id, numeric counts)
5. Set `minWidths` so nothing collapses below readable size
6. Wrap with `boxedSection(title, table, w)` — note: `w` (outer), not `innerW`
