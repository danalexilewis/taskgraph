export const DEFAULT_TERMINAL_WIDTH = 80;

export function getTerminalWidth(
  defaultWidth = DEFAULT_TERMINAL_WIDTH,
): number {
  if (process.stdout && typeof process.stdout.columns === "number") {
    return process.stdout.columns;
  }
  return defaultWidth;
}
