import boxen from "boxen";

/**
 * Wrap a section title and content in a boxen box for terminal output.
 * Uses getTerminalWidth() when width is not provided so box width respects terminal.
 */
export function boxedSection(
  title: string,
  content: string,
  width: number,
  options?: { borderColor?: string },
): string {
  const inner = title.trim() ? `${title}\n${content}` : content;
  return boxen(inner, {
    padding: 1,
    width: Math.min(width, 200),
    borderStyle: "round",
    borderColor: options?.borderColor ?? "blue",
  });
}
