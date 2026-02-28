import chalk from "chalk";
import Table from "cli-table3";

export interface TableOptions {
  headers: string[];
  rows: string[][];
  maxWidth?: number;
  /** Minimum column widths (indexed by column). Falls back to 3. */
  minWidths?: number[];
}

/**
 * Render a table that fits within `maxWidth`, using cli-table3 for
 * ANSI-aware width calculations and word wrapping.
 *
 * The first column is treated as the "flex" column — it absorbs any
 * width reduction needed so numeric/short columns stay readable.
 */
export function renderTable(opts: TableOptions): string {
  const { headers, rows, maxWidth = 80, minWidths = [] } = opts;
  const colCount = headers.length;

  // cli-table3 colWidths include padding (1 left + 1 right = 2).
  // Total rendered width = sum(colWidths) + (colCount + 1) borders.
  const borders = colCount + 1;

  // Available content+padding space
  const available = Math.max(colCount * 3, maxWidth - borders);

  // Measure natural content widths (max of header + all rows per column)
  const natural: number[] = headers.map((h) => h.length);
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      natural[i] = Math.max(natural[i] ?? 0, row[i].length);
    }
  }

  // colWidths = content width + 2 (for padding). We work in content-space first.
  const contentBudget = available - colCount * 2; // subtract padding

  let contentWidths: number[];
  const totalNatural = natural.reduce((s, w) => s + w, 0);

  if (totalNatural <= contentBudget) {
    contentWidths = [...natural];
  } else {
    // Fixed columns (all but the first) get their natural width, capped
    const fixedMax = Math.max(4, Math.floor(contentBudget / colCount));
    const fixedCols = natural.slice(1).map((w) => Math.min(w, fixedMax));
    const fixedTotal = fixedCols.reduce((s, w) => s + w, 0);
    const flexWidth = Math.max(minWidths[0] ?? 4, contentBudget - fixedTotal);
    contentWidths = [flexWidth, ...fixedCols];
  }

  // Enforce minimums
  for (let i = 0; i < contentWidths.length; i++) {
    const min = minWidths[i] ?? 3;
    contentWidths[i] = Math.max(contentWidths[i], min);
  }

  // cli-table3 colWidths include padding
  const tableColWidths = contentWidths.map((w) => w + 2);

  const table = new Table({
    head: headers.map((h) => chalk.yellow(h)),
    colWidths: tableColWidths,
    wordWrap: true,
    style: {
      head: [],
      border: ["gray"],
      compact: false,
    },
    chars: {
      top: "─",
      "top-mid": "┬",
      "top-left": "┌",
      "top-right": "┐",
      bottom: "─",
      "bottom-mid": "┴",
      "bottom-left": "└",
      "bottom-right": "┘",
      left: "│",
      "left-mid": "├",
      mid: "─",
      "mid-mid": "┼",
      right: "│",
      "right-mid": "┤",
      middle: "│",
    },
  });

  for (const row of rows) {
    table.push(row);
  }

  return table.toString();
}
