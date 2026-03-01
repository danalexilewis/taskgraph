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
import type { Config } from "./utils";
import { readConfig } from "./utils";

const REFRESH_MS = 2000;

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
  write("Loading...");
  timer = setInterval(async () => {
    const r = await readConfig().asyncAndThen((c: Config) =>
      fetchStatusData(c, statusOptions),
    );
    r.match(
      (data) => {
        write(
          formatStatusAsString(data, getTerminalWidth(), {
            dashboard: true,
          }),
        );
      },
      () => {},
    );
  }, REFRESH_MS);
  fetchStatusData(config, statusOptions).then((result) => {
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
          timer = setInterval(async () => {
            const r = await readConfig().asyncAndThen((c: Config) =>
              ResultAsync.combine([
                fetchStatusData(c, statusOptions),
                fetchTasksTableData(c, activeOptions),
              ]),
            );
            r.match(
              ([data, active]) => {
                write(
                  formatDashboardTasksView(data, active, getTerminalWidth()) +
                    "\n\n" +
                    getDashboardFooterLine(data),
                );
              },
              () => {},
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
      timer = setInterval(async () => {
        const r = await readConfig().asyncAndThen((c: Config) =>
          fetchStatusData(c, statusOptions),
        );
        r.match(
          (data) => {
            write(
              formatDashboardProjectsView(data, getTerminalWidth()) +
                "\n\n" +
                getDashboardFooterLine(data),
            );
          },
          () => {},
        );
      }, REFRESH_MS);
    },
    (e: AppError) => {
      console.error(e.message);
      process.exit(1);
    },
  );
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

      const configResult = await readConfig();
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
        const { runOpenTUILiveDashboardProjects } = await import(
          "./tui/live-opentui.js"
        );
        try {
          await runOpenTUILiveDashboardProjects(config, statusOptions);
          return;
        } catch {
          // OpenTUI not available; use fallback live loop
        }
        await runLiveFallbackDashboardProjects(config, statusOptions);
        return;
      }

      if (viewMode === "tasks") {
        const { runOpenTUILiveDashboardTasks } = await import(
          "./tui/live-opentui.js"
        );
        try {
          await runOpenTUILiveDashboardTasks(config, statusOptions);
          return;
        } catch {
          // OpenTUI not available; use fallback live loop
        }
        await runLiveFallbackDashboardTasks(config, statusOptions);
        return;
      }

      const { runOpenTUILive } = await import("./tui/live-opentui.js");
      try {
        await runOpenTUILive(config, statusOptions);
        return;
      } catch {
        // OpenTUI not available; use fallback live loop
      }
      await runLiveFallbackDashboard(config, statusOptions);
    });
}
