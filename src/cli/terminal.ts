export const DEFAULT_TERMINAL_WIDTH = 80;
export const DEFAULT_TERMINAL_HEIGHT = 24;

export function enterAlternateScreen(): void {
  process.stdout?.write("\x1b[?1049h");
}

export function exitAlternateScreen(): void {
  process.stdout?.write("\x1b[?1049l");
}

export function getTerminalWidth(
  defaultWidth = DEFAULT_TERMINAL_WIDTH,
): number {
  if (process.stdout && typeof process.stdout.columns === "number") {
    return process.stdout.columns;
  }
  return defaultWidth;
}

export function getTerminalHeight(
  defaultHeight = DEFAULT_TERMINAL_HEIGHT,
): number {
  if (process.stdout && typeof process.stdout.rows === "number") {
    return process.stdout.rows;
  }
  return defaultHeight;
}
