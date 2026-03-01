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
// Plan tables with Todo/Doing/Blocked/Done/Ready
maxWidths: [undefined, undefined, 4, 6, 4, undefined];
minWidths: [12, 4, 3, 5, 3, 5];

// Task tables with Id column
maxWidths: [10];
flexColumnIndex: 1; // Title is flex
minWidths: [10, 12, 10, 8, 6];
```

### minWidths

Set per-column minimums so columns don't collapse below readable widths. Falls back to 3 if not specified.

## Current Tables

| Location                       | Table                     | Flex Col       | maxWidths            |
| ------------------------------ | ------------------------- | -------------- | -------------------- |
| `getActivePlansSectionContent` | Active Plans (6 cols)     | 0 (Plan)       | `[_, _, 4, 6, 4, _]` |
| `getMergedActiveNextContent`   | Active & next (5 cols)    | 1 (Task)       | `[10]`               |
| `formatProjectsAsString`       | Projects (6 cols)         | 0 (Project)    | `[_, _, _, 4, 6, 4]` |
| `formatTasksAsString`          | Tasks (5 cols)            | 1 (Title)      | `[10]`               |
| `formatDashboardTasksView`     | Active tasks (5 cols)     | 1 (Title)      | `[10]`               |
| `formatDashboardTasksView`     | Next 7 runnable (3 cols)  | 1 (Task)       | `[10]`               |
| `formatDashboardTasksView`     | Last 7 completed (4 cols) | 1 (Task)       | `[10]`               |
| `formatDashboardProjectsView`  | Active plans (6 cols)     | 0 (Plan)       | `[_, _, 4, 6, 4, _]` |
| `formatDashboardProjectsView`  | Next 7 upcoming (3 cols)  | 0 (Plan)       | —                    |
| `formatDashboardProjectsView`  | Last 7 completed (3 cols) | 0 (Plan)       | —                    |
| `formatInitiativesAsString`    | Initiatives (5 cols)      | 0 (Initiative) | —                    |

Tables with all text columns (no narrow numeric cols) don't need `maxWidths`.

## Adding a New Table

1. Compute inner width: `const innerW = getBoxInnerWidth(w)`
2. Pass `maxWidth: innerW` to `renderTable`
3. Set `flexColumnIndex` to the text-heavy column (not Id)
4. Set `maxWidths` to cap narrow columns (Id, numeric counts)
5. Set `minWidths` so nothing collapses below readable size
6. Wrap with `boxedSection(title, table, w)` — note: `w` (outer), not `innerW`
