/// <reference path="../ansi-diff.d.ts" />
import ansiDiff from "ansi-diff";
import type { Command } from "commander";
import { ResultAsync } from "neverthrow";
import type { AppError } from "../domain/errors";
import {
  fetchStatusData,
  fetchTasksTableData,
  formatDashboardProjectsView,
  formatDashboardTasksView,
  formatStatusAsString,
  getDashboardFooterLine,
  type StatusOptions,
  type StatusViewMode,
} from "./status";
import { getTerminalWidth } from "./terminal";
import { runLoadingProgressBar } from "./tui/loading-progress";
import type { Config } from "./utils";
import { readConfig } from "./utils";

const REFRESH_MS = 2000;

/** OpenTUI is Bun/native-oriented; under Node we use the ansi-diff fallback for the same dashboard look. */
function isBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
}

/** Write content to stdout via ansi-diff so only changed pixels are updated (no full-screen clear). */
function createDiffWriter(): (content: string) => void {
  const diff = ansiDiff({
    width: getTerminalWidth(),
    height:
      typeof process.stdout.rows === "number" ? process.stdout.rows : undefined,
  });
  process.stdout.on("resize", () => {
    diff.resize({
      width: getTerminalWidth(),
      height:
        typeof process.stdout.rows === "number"
          ? process.stdout.rows
          : undefined,
    });
  });
  return (content: string) => {
    process.stdout.write(diff.update(`\n${content}\n`));
  };
}

async function runLiveFallbackDashboard(
  config: Config,
  statusOptions: StatusOptions,
): Promise<void> {
  const stdin = process.stdin;
  let timer: ReturnType<typeof setInterval>;
  const cleanup = () => {
    if (timer) clearInterval(timer);
    if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(false);
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  if (stdin.isTTY && stdin.setRawMode) {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", (ch) => {
      const s = ch.toString();
      if (s.toLowerCase() === "q" || s === "\x03") cleanup();
    });
  }
  const write = createDiffWriter();
  const progressBar = runLoadingProgressBar({
    onTick: write,
    getWidth: getTerminalWidth,
  });
  let consecutiveErrors = 0;
  timer = setInterval(async () => {
    const r = await readConfig().asyncAndThen((c: Config) =>
      fetchStatusData(c, statusOptions),
    );
    r.match(
      (data) => {
        consecutiveErrors = 0;
        write(
          formatStatusAsString(data, getTerminalWidth(), {
            dashboard: true,
          }),
        );
      },
      (e: AppError) => {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          write(`[tg] DB refresh error: ${e.message}`);
        }
      },
    );
  }, REFRESH_MS);
  fetchStatusData(config, statusOptions).then((result) => {
    progressBar.stop();
    result.match(
      (d) => {
        write(formatStatusAsString(d, getTerminalWidth(), { dashboard: true }));
      },
      (e: AppError) => {
        if (timer) clearInterval(timer);
        console.error(e.message);
        process.exit(1);
      },
    );
  });
  return new Promise<void>(() => {});
}

/** Live fallback for tg dashboard --tasks: Active + Next 7 + Last 7 sections, 2s refresh. */
async function runLiveFallbackDashboardTasks(
  config: Config,
  statusOptions: StatusOptions,
): Promise<void> {
  const stdin = process.stdin;
  let timer: ReturnType<typeof setInterval>;
  const cleanup = () => {
    if (timer) clearInterval(timer);
    if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(false);
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  if (stdin.isTTY && stdin.setRawMode) {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", (ch) => {
      const s = ch.toString();
      if (s.toLowerCase() === "q" || s === "\x03") cleanup();
    });
  }
  const activeOptions = { ...statusOptions, filter: "active" as const };
  const [statusResult, activeResult] = await Promise.all([
    fetchStatusData(config, statusOptions),
    fetchTasksTableData(config, activeOptions),
  ]);
  const write = createDiffWriter();
  statusResult.match(
    (d) => {
      activeResult.match(
        (activeRows) => {
          const w = getTerminalWidth();
          write(
            formatDashboardTasksView(d, activeRows, w) +
              "\n\n" +
              getDashboardFooterLine(d),
          );
          let consecutiveErrors = 0;
          timer = setInterval(async () => {
            const r = await readConfig().asyncAndThen((c: Config) =>
              ResultAsync.combine([
                fetchStatusData(c, statusOptions),
                fetchTasksTableData(c, activeOptions),
              ]),
            );
            r.match(
              ([data, active]) => {
                consecutiveErrors = 0;
                write(
                  formatDashboardTasksView(data, active, getTerminalWidth()) +
                    "\n\n" +
                    getDashboardFooterLine(data),
                );
              },
              (e: AppError) => {
                consecutiveErrors++;
                if (consecutiveErrors >= 3) {
                  write(`[tg] DB refresh error: ${e.message}`);
                }
              },
            );
          }, REFRESH_MS);
        },
        (e: AppError) => {
          console.error(e.message);
          process.exit(1);
        },
      );
    },
    (e: AppError) => {
      console.error(e.message);
      process.exit(1);
    },
  );
  return new Promise<void>(() => {});
}

/** Live fallback for tg dashboard --projects: Active plans + Next 7 + Last 7 sections, 2s refresh. */
async function runLiveFallbackDashboardProjects(
  config: Config,
  statusOptions: StatusOptions,
): Promise<void> {
  const stdin = process.stdin;
  let timer: ReturnType<typeof setInterval>;
  const cleanup = () => {
    if (timer) clearInterval(timer);
    if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(false);
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  if (stdin.isTTY && stdin.setRawMode) {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", (ch) => {
      const s = ch.toString();
      if (s.toLowerCase() === "q" || s === "\x03") cleanup();
    });
  }
  const write = createDiffWriter();
  const result = await fetchStatusData(config, statusOptions);
  result.match(
    (d) => {
      const w = getTerminalWidth();
      write(
        `${formatDashboardProjectsView(d, w)}\n\n${getDashboardFooterLine(d)}`,
      );
      let consecutiveErrors = 0;
      timer = setInterval(async () => {
        const r = await readConfig().asyncAndThen((c: Config) =>
          fetchStatusData(c, statusOptions),
        );
        r.match(
          (data) => {
            consecutiveErrors = 0;
            write(
              formatDashboardProjectsView(data, getTerminalWidth()) +
                "\n\n" +
                getDashboardFooterLine(data),
            );
          },
          (e: AppError) => {
            consecutiveErrors++;
            if (consecutiveErrors >= 3) {
              write(`[tg] DB refresh error: ${e.message}`);
            }
          },
        );
      }, REFRESH_MS);
    },
    (e: AppError) => {
      console.error(e.message);
      process.exit(1);
    },
  );
  return new Promise<void>(() => {});
}

export function dashboardCommand(program: Command) {
  program
    .command("dashboard")
    .description(
      "Open status dashboard (live-updating TUI; 2s refresh, q or Ctrl+C to quit). Use --tasks or --projects for table view.",
    )
    .option("--tasks", "Live tasks table view")
    .option("--projects", "Live projects table view")
    .action(async (options) => {
      if (options.tasks && options.projects) {
        console.error(
          "tg dashboard: only one of --tasks or --projects is allowed.",
        );
        process.exit(1);
      }

      const viewMode: StatusViewMode = options.tasks
        ? "tasks"
        : options.projects
          ? "projects"
          : "dashboard";

      const configResult = readConfig();
      if (configResult.isErr()) {
        console.error(configResult.error.message);
        process.exit(1);
      }
      const config = configResult.value;

      const statusOptions: StatusOptions = {
        view: viewMode,
        tasksView: options.tasks === true,
      };

      if (viewMode === "projects") {
        if (isBun()) {
          const { runOpenTUILiveDashboardProjects } = await import(
            "./tui/live-opentui.js"
          );
          try {
            await runOpenTUILiveDashboardProjects(config, statusOptions);
            return;
          } catch {
            // OpenTUI not available; use fallback
          }
        }
        await runLiveFallbackDashboardProjects(config, statusOptions);
        return;
      }

      if (viewMode === "tasks") {
        if (isBun()) {
          const { runOpenTUILiveDashboardTasks } = await import(
            "./tui/live-opentui.js"
          );
          try {
            await runOpenTUILiveDashboardTasks(config, statusOptions);
            return;
          } catch {
            // OpenTUI not available; use fallback
          }
        }
        await runLiveFallbackDashboardTasks(config, statusOptions);
        return;
      }

      if (isBun()) {
        const { runOpenTUILive } = await import("./tui/live-opentui.js");
        try {
          await runOpenTUILive(config, statusOptions);
          return;
        } catch {
          // OpenTUI not available; use fallback
        }
      }
      await runLiveFallbackDashboard(config, statusOptions);
    });
}
