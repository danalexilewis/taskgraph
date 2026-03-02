import chalk from "chalk";
import Table from "cli-table3";
import { useAsciiBorders } from "./tui/boxen";

export interface TableOptions {
  headers: string[];
  rows: string[][];
  maxWidth?: number;
  /** Minimum column widths (indexed by column). Falls back to 3. */
  minWidths?: number[];
  /**
   * Index of the column that gets extra space when under budget and shrinks first when over.
   * Default 0 (first column).
   */
  flexColumnIndex?: number;
  /** Maximum column widths (indexed by column). Use undefined for no cap. */
  maxWidths?: (number | undefined)[];
  /** When true, no visible borders (empty chars); table still aligns columns and uses full width. */
  borderVisible?: boolean;
}

/**
 * Render a table that fits within `maxWidth`, using cli-table3 for
 * ANSI-aware width calculations and word wrapping.
 *
 * By default the first column is the "flex" column. Use `flexColumnIndex` to
 * choose another (e.g. 1 for Task column). Use `maxWidths` to cap columns (e.g. Id at 10).
 */
export function renderTable(opts: TableOptions): string {
  const {
    headers,
    rows,
    maxWidth = 80,
    minWidths = [],
    flexColumnIndex = 0,
    maxWidths = [],
    borderVisible = true,
  } = opts;
  const colCount = headers.length;

  // Table width = content + padding on both sides of each cell + vertical bars (if visible).
  // cli-table3 colWidths = content + 2 (1 left + 1 right padding per cell).
  // Total rendered = sum(colWidths) + (colCount + 1) vertical bars when borderVisible.
  const borders = borderVisible ? colCount + 1 : 0;
  const cellPaddingTotal = colCount * 2;

  const available = Math.max(colCount * 3, maxWidth - borders);

  // Measure natural content widths (max of header + all rows per column); apply maxWidths cap
  const natural: number[] = headers.map((h) => h.length);
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      natural[i] = Math.max(natural[i] ?? 0, row[i].length);
    }
  }
  for (let i = 0; i < natural.length; i++) {
    if (maxWidths[i] != null) {
      natural[i] = Math.min(natural[i], maxWidths[i] as number);
    }
  }

  // Content budget: available minus padding on both sides of every cell.
  const contentBudget = available - cellPaddingTotal;

  const fixedMax = Math.max(4, Math.floor(contentBudget / colCount));

  let contentWidths: number[];
  const totalNatural = natural.reduce((s, w) => s + w, 0);

  if (totalNatural <= contentBudget) {
    contentWidths = natural.map((w, i) =>
      Math.min(w, maxWidths[i] ?? Number.POSITIVE_INFINITY),
    );
    // Give leftover space to the flex column (e.g. Plan name) so table fills width
    const totalSoFar = contentWidths.reduce((s, x) => s + x, 0);
    const leftover = contentBudget - totalSoFar;
    if (leftover > 0) {
      const flexMax = maxWidths[flexColumnIndex] ?? Number.POSITIVE_INFINITY;
      contentWidths[flexColumnIndex] = Math.min(
        flexMax,
        contentWidths[flexColumnIndex] + leftover,
      );
    }
  } else {
    // Fixed columns (all but flex) get natural capped by fixedMax and maxWidths
    contentWidths = natural.map((w, i) => {
      const cap = Math.min(fixedMax, maxWidths[i] ?? Number.POSITIVE_INFINITY);
      return i === flexColumnIndex ? 0 : Math.min(w, cap);
    });
    const fixedTotal = contentWidths.reduce((s, w) => s + w, 0);
    contentWidths[flexColumnIndex] = Math.max(
      minWidths[flexColumnIndex] ?? 4,
      contentBudget - fixedTotal,
    );
  }

  // Enforce minimums and maxWidths
  for (let i = 0; i < contentWidths.length; i++) {
    const min = minWidths[i] ?? 3;
    const max = maxWidths[i] ?? Number.POSITIVE_INFINITY;
    contentWidths[i] = Math.max(min, Math.min(contentWidths[i], max));
  }

  // Cap total width so we never exceed maxWidth (no terminal wrap)
  let totalContent = contentWidths.reduce((s, x) => s + x, 0);
  let totalRendered = totalContent + cellPaddingTotal + borders;
  if (totalRendered > maxWidth) {
    const overflow = totalRendered - maxWidth;
    const flexMin = minWidths[flexColumnIndex] ?? 3;
    const flexMax = maxWidths[flexColumnIndex] ?? Number.POSITIVE_INFINITY;
    contentWidths[flexColumnIndex] = Math.max(
      flexMin,
      Math.min(flexMax, contentWidths[flexColumnIndex] - overflow),
    );
    totalContent = contentWidths.reduce((s, x) => s + x, 0);
    totalRendered = totalContent + cellPaddingTotal + borders;
    if (totalRendered > maxWidth) {
      const remainingOverflow = totalRendered - maxWidth;
      let slack = 0;
      for (let i = 0; i < contentWidths.length; i++) {
        if (i === flexColumnIndex) continue;
        const min = minWidths[i] ?? 3;
        slack += Math.max(0, contentWidths[i] - min);
      }
      if (slack >= remainingOverflow) {
        for (let i = 0; i < contentWidths.length; i++) {
          if (i === flexColumnIndex) continue;
          const min = minWidths[i] ?? 3;
          const max = maxWidths[i] ?? Number.POSITIVE_INFINITY;
          const canTake = Math.max(0, contentWidths[i] - min);
          const take = Math.min(
            canTake,
            Math.round((canTake / slack) * remainingOverflow),
          );
          contentWidths[i] = Math.max(
            min,
            Math.min(max, contentWidths[i] - take),
          );
        }
      } else {
        for (let i = 0; i < contentWidths.length; i++) {
          if (i === flexColumnIndex) continue;
          contentWidths[i] = minWidths[i] ?? 3;
        }
        let extra = remainingOverflow - slack;
        for (let i = 0; extra > 0 && i < contentWidths.length; i++) {
          if (i === flexColumnIndex) continue;
          const max = maxWidths[i] ?? Number.POSITIVE_INFINITY;
          const take = Math.min(contentWidths[i] - 1, extra);
          contentWidths[i] = Math.min(max, contentWidths[i] - take);
          extra -= take;
        }
      }
    }
  }

  // cli-table3 colWidths include padding
  const tableColWidths = contentWidths.map((w) => w + 2);

  const emptyBorderChars = {
    top: "",
    "top-mid": "",
    "top-left": "",
    "top-right": "",
    bottom: "",
    "bottom-mid": "",
    "bottom-left": "",
    "bottom-right": "",
    left: "",
    "left-mid": "",
    mid: "",
    "mid-mid": "",
    right: "",
    "right-mid": "",
    middle: "",
  };

  const table = new Table({
    head: headers.map((h) => (borderVisible ? chalk.yellow(h) : h)),
    colWidths: tableColWidths,
    wordWrap: true,
    style: {
      head: [],
      border: ["gray"],
      compact: false,
    },
    chars: borderVisible
      ? useAsciiBorders()
        ? {
            top: "-",
            "top-mid": "+",
            "top-left": "+",
            "top-right": "+",
            bottom: "-",
            "bottom-mid": "+",
            "bottom-left": "+",
            "bottom-right": "+",
            left: "|",
            "left-mid": "+",
            mid: "-",
            "mid-mid": "+",
            right: "|",
            "right-mid": "+",
            middle: "|",
          }
        : {
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
          }
      : emptyBorderChars,
  });

  for (const row of rows) {
    table.push(row);
  }

  return table.toString();
}
