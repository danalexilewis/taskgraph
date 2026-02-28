---
name: Status Responsive and Color Enhancements
overview: |
  Add colored output and responsive table layouts to `tg status` to prevent overflow
  in narrow terminals and improve readability.
fileTree: |
  src/cli/
  ├── status.ts                    (modify)
  ├── terminal.ts                  (create)
  └── table.ts                     (create)
  __tests__/cli/
  └── status.test.ts               (modify)
risks:
  - description: Table builder may miscalculate widths when ANSI colors are present
    severity: medium
    mitigation: Use ANSI-aware width calculation via strip-ansi or cli-table3
  - description: Extremely narrow terminals could still overflow or produce unreadable output
    severity: low
    mitigation: Define minimum widths and fallback to simple list layout when width < min
tests:
  - "Status output uses ANSI color codes for headings and metrics"
  - "Tables do not overflow when process.stdout.columns is set to narrow width"
  - "Table cells wrap or truncate correctly based on terminal width"
  - "Fallback layout for very narrow terminals displays status as list"
todos:
  - id: add-terminal-width-helper
    content: Create helper to detect terminal width with fallback
    intent: |
      Implement a function in `src/cli/terminal.ts`:
      ```ts
      export function getTerminalWidth(defaultWidth = 80): number {
        const columns = process.stdout.columns || defaultWidth;
        return columns;
      }
      ```
    changeType: create
    agent: implementer
  - id: create-table-builder
    content: Build ANSI-aware table renderer
    intent: |
      Implement a table builder in `src/cli/table.ts` using `cli-table3`:
      ```ts
      import Table from "cli-table3";
      import stripAnsi from "strip-ansi";
      export function renderTable(
        headers: string[],
        rows: string[][],
        maxWidth: number
      ): string { /* ... */ }
      ```
      Configure `wordWrap: true`, `colWidths`, and ANSI-aware string widths.
    changeType: create
    agent: implementer
  - id: refactor-status-to-responsive-table
    content: Refactor printHumanStatus to use table builder and responsive layout
    intent: |
      In `src/cli/status.ts`, replace manual padding and truncation with calls to
      `getTerminalWidth()` and `renderTable([...])`. Remove existing `pad()` and
      `truncate()` usage for tables.
    changeType: modify
    agent: implementer
    blockedBy: [add-terminal-width-helper, create-table-builder]
  - id: add-color-to-status-output
    content: Enhance status output with ANSI colors
    intent: |
      Update `src/cli/status.ts` to use `chalk` for coloring:
      - Headings in bold blue
      - Vanity metrics in green
      - Table headers in yellow
    changeType: modify
    agent: implementer
    blockedBy: [refactor-status-to-responsive-table]
  - id: write-responsive-status-tests
    content: Write unit tests for responsive and colored status output
    intent: |
      Modify `__tests__/cli/status.test.ts` to stub `process.stdout.columns`, capture
      output, and assert:
      - ANSI codes present for headings
      - No output line length exceeds stubbed width
      - Fallback behavior on very narrow widths
    changeType: modify
    agent: implementer
    blockedBy: [add-color-to-status-output]
isProject: false
---

## Analysis

The `tg status` command currently computes column widths statically and ignores the actual terminal width, leading to overflow on small terminals. It also lacks color, making metrics and headings less distinguishable. We will introduce a width detection helper, a reusable ANSI-aware table builder using `cli-table3`, and refactor `printHumanStatus` to leverage these. Colors via `chalk` will improve readability.

## Dependency graph

Parallel start (2 unblocked):
├── add-terminal-width-helper
└── create-table-builder

After add-terminal-width-helper + create-table-builder:
└── refactor-status-to-responsive-table

After refactor-status-to-responsive-table:
└── add-color-to-status-output

After add-color-to-status-output:
└── write-responsive-status-tests

<original_prompt>
make a plan for updating tg status one more time.

I'd like to bring colour in, make it work nicely on smaller terminals - it doesn't atm, the tables overflow.
</original_prompt>
