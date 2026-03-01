---
triggers:
  files: ["src/cli/table.ts", "src/cli/tui/boxen.ts", "src/cli/status.ts"]
  change_types: ["create", "modify"]
  keywords: ["table", "boxen", "renderTable", "column", "width", "padding"]
---

# CLI Table Rendering

Tables in the CLI are rendered with `renderTable()` (`src/cli/table.ts`) using `cli-table3` and wrapped in `boxedSection()` (`src/cli/tui/boxen.ts`) for visual grouping.

## Width Calculation

### Box deductions

`boxedSection` uses `boxen` with `padding: 1`. The total horizontal deduction from outer terminal width:

- **Border**: 1 char per side = 2
- **Padding**: 1 char per side = 2
- **Inner buffer**: 2 chars per side = 4 (prevents table touching box edge)
- **Total**: 8 chars

`getBoxInnerWidth(outerWidth)` computes this: `outerWidth - 8`, floored at 20.

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
// Plan tables: 5 numeric cols (Todo, Ready, Doing, Blocked, Done) share the same width.
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

| Location                       | Table                                                                                           | Flex Col       | maxWidths (numeric cols = `numericColW`) |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------- |
| `getActivePlansSectionContent` | Active Plans + Total row (6 cols: Plan, Todo, Ready, Doing, Blocked, Done)                      | 0 (Plan)       | `[_, N, N, N, N, N]`                     |
| `getMergedActiveNextContent`   | Active & next (6 cols: Id, Task, Plan, Stale, Status, Agent)                                    | 1 (Task)       | `[10, _, _, 1]`                          |
| `formatProjectsAsString`       | Projects (6 cols)                                                                               | 0 (Project)    | `[_, _, _, 4, 6, 4]`                     |
| `formatTasksAsString`          | Tasks: 5 cols (Id, Title, Project, Status, Owner); or 6 when `staleTaskIds` passed (adds Stale) | 1 (Title)      | `[10]` or `[10, _, 10, 1, 6, 1]`         |
| `formatDashboardTasksView`     | Active tasks (6 cols: Id, Title, Plan, Stale, Owner, Status) — full width                       | 1 (Title)      | `[10, _, 10, 1, 6, 1]`                   |
| `formatDashboardTasksView`     | Next 7 runnable (5 cols: icon, Id, Task, Plan, Stale)                                           | 2 (Task)       | `[1, 10, _, _, 1]`                       |
| `formatDashboardTasksView`     | Last 7 completed (5 cols: icon, Id, Task, Plan, Updated)                                        | 2 (Task)       | `[1, 10]`                                |
| `formatDashboardProjectsView`  | Active plans + Total row (6 cols: Plan, Todo, Ready, Doing, Blocked, Done) — full width         | 0 (Plan)       | `[_, N, N, N, N, N]`                     |
| `formatDashboardProjectsView`  | Next 7 upcoming (3 cols)                                                                        | 0 (Plan)       | —                                        |
| `formatDashboardProjectsView`  | Last 7 completed (4 cols: status icon, Plan, Status, Updated)                                   | 1 (Plan)       | `[1]` (icon)                             |
| `formatInitiativesAsString`    | Initiatives (5 cols)                                                                            | 0 (Initiative) | —                                        |
| `getStaleDoingTasksContent`    | Stale Doing Tasks (4 cols)                                                                      | 1 (Title)      | `[10]`                                   |

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

**Project name, Todo, Ready, Doing, Blocked, Done**

Ready (actionable count) immediately follows Todo so the ratio is obvious at a glance.

Both `getActivePlansSectionContent` and `formatDashboardProjectsView` append a **Total** row after the plan rows. The totals use `Number(p.x)` coercion before summing to guard against string values from the DB.

### Typecheck gotcha: standalone `.d.ts` files

The changed-files typecheck builds a temporary `tsconfig.changed.json` that only includes the modified `src/*.ts` files. Standalone ambient declaration files (e.g. `src/ansi-diff.d.ts`) are **not** automatically picked up unless:

- They're referenced via `/// <reference path="..." />` in one of the included files, or
- The full `tsconfig.json` `include` glob covers them (it does for `pnpm typecheck:all`).

Fix: add `/// <reference path="../ansi-diff.d.ts" />` at the top of `dashboard.ts` so the changed-files path always includes it.

## Dashboard layout (two stacked tables)

The default dashboard (`tg dashboard` with no flags) shows only two tables, one on top of the other, so the screen does not scroll:

1. **Active Projects** — plan rows (Plan, Todo, Ready, Doing, Blocked, Done) plus a **Total** row. Row count is capped using `getDashboardRowLimits(terminalRows)` so the table fits the terminal height.
2. **Active tasks and upcoming** — merged doing + next runnable tasks (Id, Task, Plan, Status, Agent). Similarly capped by height.

`getTerminalHeight()` (from `src/cli/terminal.ts`) provides `process.stdout.rows` or a default of 24. `getDashboardRowLimits(height)` reserves 12 lines for borders, titles, and the completed summary, then allocates ~40% of the remaining lines to the plans table and ~60% to the tasks table (each at least 2). Implemented in `getActivePlansSectionContent(..., maxRows)` and `getMergedActiveNextContent(..., maxRows)`.

## Adding a New Table

1. Compute inner width: `const innerW = getBoxInnerWidth(w)`
2. Pass `maxWidth: innerW` to `renderTable`
3. Set `flexColumnIndex` to the text-heavy column (not Id)
4. Set `maxWidths` to cap narrow columns (Id, numeric counts)
5. Set `minWidths` so nothing collapses below readable size
6. Wrap with `boxedSection(title, table, w)` — note: `w` (outer), not `innerW`
