import boxen from "boxen";

/** Chars taken by box per side: 1 border + 1 padding = 2. Both sides = 4. */
const BOX_HORIZONTAL_DEDUCTION = 4;
/** Extra buffer so table does not touch box inner edge (2 per side). */
const BOX_INNER_BUFFER = 4;

/**
 * Effective inner width for content inside a boxedSection.
 * Account for padding on both sides: box uses 2 chars left (border+padding) and 2 right,
 * then we subtract a small buffer so the table stays clear of the box. Floored at 20.
 */
export function getBoxInnerWidth(outerWidth: number): number {
  return Math.max(20, outerWidth - BOX_HORIZONTAL_DEDUCTION - BOX_INNER_BUFFER);
}

/**
 * Wrap a section title and content in a boxen box for terminal output.
 * Uses getTerminalWidth() when width is not provided so box width respects terminal.
 * When fullWidth is true, the box uses the full width (no 200-char cap); use for dashboard --projects.
 */
export function boxedSection(
  title: string,
  content: string,
  width: number,
  options?: { borderColor?: string; fullWidth?: boolean },
): string {
  const inner = title.trim() ? `${title}\n${content}` : content;
  const boxWidth = options?.fullWidth ? width : Math.min(width, 200);
  return boxen(inner, {
    padding: 1,
    width: boxWidth,
    borderStyle: "round",
    borderColor: options?.borderColor ?? "blue",
  });
}
