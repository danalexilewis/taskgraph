/**
 * Loading progress bar for the dashboard. Animates over a fixed duration (default 4s)
 * so users see a bar moving across the terminal while data loads.
 */

export const DASHBOARD_LOADING_DURATION_MS = 4000;
const TICK_MS = 80;

const FILL = "█";
const EMPTY = "░";

/**
 * Renders a single line progress bar that fills across the given width.
 * @param progress 0..1
 * @param width terminal/box width
 */
export function renderProgressBar(progress: number, width: number): string {
  const barWidth = Math.max(0, width - 1);
  const filled = Math.floor(progress * barWidth);
  const empty = barWidth - filled;
  return FILL.repeat(filled) + EMPTY.repeat(empty);
}

/**
 * Full loading screen content: "Loading" plus a progress bar line.
 */
export function renderLoadingView(progress: number, width: number): string {
  return `Loading\n${renderProgressBar(progress, width)}`;
}

export type RunLoadingProgressBarOptions = {
  onTick: (content: string) => void;
  getWidth: () => number;
  durationMs?: number;
};

/**
 * Runs a 4-second progress bar, calling onTick with the current bar string every TICK_MS.
 * Returns stop() to clear the interval (call when content is ready).
 */
export function runLoadingProgressBar(options: RunLoadingProgressBarOptions): {
  stop: () => void;
} {
  const durationMs = options.durationMs ?? DASHBOARD_LOADING_DURATION_MS;
  const start = Date.now();
  let cleared = false;

  const tick = () => {
    if (cleared) return;
    const elapsed = Date.now() - start;
    const progress = Math.min(1, elapsed / durationMs);
    const width = options.getWidth();
    options.onTick(renderLoadingView(progress, width));
  };

  tick();
  const interval = setInterval(tick, TICK_MS);

  return {
    stop: () => {
      cleared = true;
      clearInterval(interval);
    },
  };
}
