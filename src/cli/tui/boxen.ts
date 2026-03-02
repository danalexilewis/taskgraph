import boxen from "boxen";

/** When set (e.g. "1"), use ASCII-only borders (+ - |) so the dashboard is readable in terminals that don't support Unicode box-drawing. */
export const ASCII_DASHBOARD_ENV = "TG_ASCII_DASHBOARD";

export function useAsciiBorders(): boolean {
  return (
    process.env[ASCII_DASHBOARD_ENV] === "1" ||
    process.env[ASCII_DASHBOARD_ENV] === "true"
  );
}

/** Chars taken by box per side: 1 border + 1 padding = 2. Both sides = 4. */
const BOX_HORIZONTAL_DEDUCTION = 4;
/** Extra buffer so table does not touch box inner edge (2 per side). */
const BOX_INNER_BUFFER = 4;
/** When padding is 0: border only, 1 char per side. */
const BOX_BORDER_ONLY_DEDUCTION = 2;

/**
 * Effective inner width for content inside a boxedSection.
 * Account for padding on both sides: box uses 2 chars left (border+padding) and 2 right,
 * then we subtract a small buffer so the table stays clear of the box. Floored at 20.
 */
export function getBoxInnerWidth(outerWidth: number): number {
  return Math.max(20, outerWidth - BOX_HORIZONTAL_DEDUCTION - BOX_INNER_BUFFER);
}

/**
 * Inner width when box uses padding 0 (tight). Use for compact boxes (e.g. dashboard footer).
 * Deduction = border only (2) + optional buffer (2) = 4.
 */
export function getBoxInnerWidthTight(outerWidth: number): number {
  return Math.max(20, outerWidth - BOX_BORDER_ONLY_DEDUCTION - 2);
}

/**
 * Inner content width when using dashboard box padding (top 0.5, bottom 0, left/right 2).
 */
export function getBoxInnerWidthDashboard(outerWidth: number): number {
  return Math.max(20, outerWidth - 2 - 2 - 2);
}

/** Padding shape: number (uniform) or per-side. */
export type BoxPadding =
  | number
  | { top: number; right: number; bottom: number; left: number };

/**
 * Wrap a section title and content in a boxen box for terminal output.
 * Uses getTerminalWidth() when width is not provided so box width respects terminal.
 * When fullWidth is true, the box uses the full width (no 200-char cap); use for dashboard --projects.
 * When padding is an object, per-side padding is used (e.g. { top: 1, bottom: 1, left: 2, right: 2 }).
 */
export function boxedSection(
  title: string,
  content: string,
  width: number,
  options?: { borderColor?: string; fullWidth?: boolean; padding?: BoxPadding },
): string {
  const inner = title.trim() ? `${title}\n${content}` : content;
  const padding = options?.padding ?? 1;
  // boxen 5.x has no explicit width option — it derives box width from content and
  // uses terminalColumns() as the ceiling. When content+padding+borders equals
  // terminalColumns() exactly, boxen sets LINE_SEPARATOR='' and produces a single
  // line with no newlines. Fix: tell boxen the terminal is 1 char wider than our
  // intended box width so the condition is never triggered.
  const savedCols = process.env.COLUMNS;
  process.env.COLUMNS = String(width + 1);
  const borderStyle = useAsciiBorders()
    ? {
        topLeft: "+",
        topRight: "+",
        bottomRight: "+",
        bottomLeft: "+",
        vertical: "|",
        horizontal: "-",
      }
    : "double";
  try {
    return boxen(inner, {
      padding,
      borderStyle,
      borderColor: options?.borderColor ?? "blue",
    });
  } finally {
    if (savedCols === undefined) {
      delete process.env.COLUMNS;
    } else {
      process.env.COLUMNS = savedCols;
    }
  }
}
