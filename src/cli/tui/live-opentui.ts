/**
 * OpenTUI live renderer for tg status --dashboard.
 * When createCliRenderer() or OpenTUI init fails (e.g. under Node), the caller
 * should fall back to the minimal TUI (setInterval + ANSI clear + printHumanStatus).
 */

import { ResultAsync } from "neverthrow";
import type {
  InitiativeRow,
  ProjectRow,
  StatusData,
  StatusOptions,
  TaskRow,
} from "../status.js";
import {
  fetchInitiativesTableData,
  fetchProjectsTableData,
  fetchStaleDoingTasks,
  fetchStatusData,
  fetchTasksTableData,
  formatDashboardProjectsView,
  formatDashboardTasksView,
  formatInitiativesAsString,
  formatProjectsAsString,
  formatStatusAsString,
  formatTasksAsString,
  getDashboardFooterLine,
} from "../status.js";
import { getTerminalWidth } from "../terminal.js";
import type { Config } from "../utils.js";

const STATUS_ROOT_ID = "tg-status-root";
const REFRESH_MS = 2000;

export type FetchStatusFn = (
  config: Config,
  options: StatusOptions,
) => ResultAsync<StatusData, import("../../domain/errors.js").AppError>;

/**
 * Run the live status view using OpenTUI. Resolves when the user exits (q or Ctrl+C).
 * Throws if OpenTUI is not available (e.g. Node runtime) so the caller can fall back.
 */
type OpenTUIRenderer = {
  root: {
    add: (node: unknown) => number;
    remove: (id: string) => void;
    getRenderable: (id: string) => OpenTUIRenderable | undefined;
    requestRender?: () => void;
  };
  prependInputHandler: (fn: (seq: string) => boolean) => void;
  on: (ev: string, fn: () => void) => void;
  setupTerminal: () => Promise<void>;
  destroy: () => void;
  isDestroyed: boolean;
};

type OpenTUIRenderable = {
  destroy: () => void;
  getChildren?: () => OpenTUIRenderable[];
} & ({ content?: string } | object);

type OpenTUIMod = {
  createCliRenderer: (config?: object) => Promise<OpenTUIRenderer>;
  Box: (props: object, ...children: unknown[]) => unknown;
  Text: (props: { content: string }) => unknown;
};

/**
 * Update the Text child of the root Box in place so OpenTUI can diff and only redraw changed pixels.
 * Returns true if the update was applied, false if we need to replace the node (e.g. first run or wrong shape).
 */
function updateRootTextContent(
  renderer: OpenTUIRenderer,
  rootId: string,
  newContent: string,
): boolean {
  const box = renderer.root.getRenderable(rootId);
  if (!box?.getChildren) return false;
  const children = box.getChildren();
  const textNode = children[0];
  if (
    !textNode ||
    typeof (textNode as { content?: string }).content === "undefined"
  )
    return false;
  (textNode as { content: string }).content = newContent;
  renderer.root.requestRender?.();
  return true;
}

function replaceRootWithNewBox(
  renderer: OpenTUIRenderer,
  Box: OpenTUIMod["Box"],
  Text: OpenTUIMod["Text"],
  rootId: string,
  newContent: string,
  width: number,
): void {
  const child = renderer.root.getRenderable(rootId);
  if (child) {
    child.destroy();
    renderer.root.remove(rootId);
  }
  const newBox = Box(
    {
      id: rootId,
      borderStyle: "round",
      border: true,
      width,
      height: "auto",
    },
    Text({ content: newContent }),
  );
  renderer.root.add(newBox);
}

export async function runOpenTUILive(
  config: Config,
  statusOptions: StatusOptions,
  fetchStatus: FetchStatusFn = fetchStatusData,
): Promise<void> {
  const importTimeoutMs = 300;
  const mod = (await Promise.race([
    import("@opentui/core"),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("OpenTUI import timeout")),
        importTimeoutMs,
      ),
    ),
  ]).catch(() => null)) as OpenTUIMod | null;
  if (!mod?.createCliRenderer || !mod.Box || !mod.Text) {
    throw new Error("OpenTUI not available");
  }

  const initTimeoutMs = 350;
  const rendererPromise = mod.createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 10,
  });
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("OpenTUI init timeout")), initTimeoutMs),
  );
  const renderer = await Promise.race([rendererPromise, timeoutPromise]);

  const w = getTerminalWidth();
  const { Box, Text } = mod;
  const rootBox = Box(
    {
      id: STATUS_ROOT_ID,
      borderStyle: "round",
      border: true,
      width: w,
      height: "auto",
    },
    Text({ content: "Loading..." }),
  );
  renderer.root.add(rootBox);

  process.on("SIGINT", () => {
    renderer.destroy();
    process.exit(0);
  });
  renderer.prependInputHandler((sequence: string) => {
    if (sequence.toLowerCase() === "q" || sequence === "\x03") {
      renderer.destroy();
      process.exit(0);
      return true;
    }
    return false;
  });

  const refreshContent = (data: StatusData) => {
    try {
      const newContent = formatStatusAsString(data, getTerminalWidth(), {
        dashboard: true,
      });
      if (!updateRootTextContent(renderer, STATUS_ROOT_ID, newContent)) {
        replaceRootWithNewBox(
          renderer,
          Box,
          Text,
          STATUS_ROOT_ID,
          newContent,
          getTerminalWidth(),
        );
      }
    } catch {
      // ignore
    }
  };

  const timer = setInterval(async () => {
    if (renderer.isDestroyed) {
      clearInterval(timer);
      return;
    }
    const result = await fetchStatus(config, statusOptions);
    result.match(refreshContent, () => {});
  }, REFRESH_MS);

  renderer.on("destroy", () => {
    clearInterval(timer);
  });

  await renderer.setupTerminal();

  fetchStatus(config, statusOptions).then((result) => {
    result.match(refreshContent, () => {});
  });

  return new Promise<void>((resolve) => {
    renderer.on("destroy", () => resolve());
  });
}

/**
 * Run the live dashboard tasks view using OpenTUI: Active tasks, Next 7 runnable, Last 7 completed.
 * Uses fetchStatusData and fetchTasksTableData(..., { filter: 'active' }); 2s refresh.
 */
export async function runOpenTUILiveDashboardTasks(
  config: Config,
  statusOptions: StatusOptions,
): Promise<void> {
  const importTimeoutMs = 300;
  const mod = (await Promise.race([
    import("@opentui/core"),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("OpenTUI import timeout")),
        importTimeoutMs,
      ),
    ),
  ]).catch(() => null)) as OpenTUIMod | null;
  if (!mod?.createCliRenderer || !mod.Box || !mod.Text) {
    throw new Error("OpenTUI not available");
  }

  const initTimeoutMs = 350;
  const rendererPromise = mod.createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 10,
  });
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("OpenTUI init timeout")), initTimeoutMs),
  );
  const renderer = await Promise.race([rendererPromise, timeoutPromise]);

  const w = getTerminalWidth();
  const activeOptions = { ...statusOptions, filter: "active" as const };
  const { Box, Text } = mod;
  const rootBox = Box(
    {
      id: STATUS_ROOT_ID,
      borderStyle: "round",
      border: true,
      width: w,
      height: "auto",
    },
    Text({ content: "Loading..." }),
  );
  renderer.root.add(rootBox);

  process.on("SIGINT", () => {
    renderer.destroy();
    process.exit(0);
  });
  renderer.prependInputHandler((sequence: string) => {
    if (sequence.toLowerCase() === "q" || sequence === "\x03") {
      renderer.destroy();
      process.exit(0);
      return true;
    }
    return false;
  });

  const refreshContent = (data: StatusData, activeRows: TaskRow[]) => {
    try {
      const width = getTerminalWidth();
      const newContent =
        formatDashboardTasksView(data, activeRows, width) +
        "\n\n" +
        getDashboardFooterLine(data);
      if (!updateRootTextContent(renderer, STATUS_ROOT_ID, newContent)) {
        replaceRootWithNewBox(
          renderer,
          Box,
          Text,
          STATUS_ROOT_ID,
          newContent,
          width,
        );
      }
    } catch {
      // ignore
    }
  };

  const timer = setInterval(async () => {
    if (renderer.isDestroyed) {
      clearInterval(timer);
      return;
    }
    const [resStatus, resActive] = await Promise.all([
      fetchStatusData(config, statusOptions),
      fetchTasksTableData(config, activeOptions),
    ]);
    let data: StatusData | null = null;
    let activeRows: TaskRow[] = [];
    resStatus.match(
      (d) => {
        data = d;
      },
      () => {},
    );
    resActive.match(
      (rows) => {
        activeRows = rows;
      },
      () => {},
    );
    if (data != null) refreshContent(data, activeRows);
  }, REFRESH_MS);

  renderer.on("destroy", () => {
    clearInterval(timer);
  });

  await renderer.setupTerminal();

  Promise.all([
    fetchStatusData(config, statusOptions),
    fetchTasksTableData(config, activeOptions),
  ]).then(([statusResult, activeResult]) => {
    let data: StatusData | null = null;
    let activeRows: TaskRow[] = [];
    statusResult.match(
      (d) => {
        data = d;
      },
      () => {},
    );
    activeResult.match(
      (rows) => {
        activeRows = rows;
      },
      () => {},
    );
    if (data != null) refreshContent(data, activeRows);
  });

  return new Promise<void>((resolve) => {
    renderer.on("destroy", () => resolve());
  });
}

/**
 * Run the live dashboard projects view using OpenTUI: Active plans, Next 7 upcoming, Last 7 completed.
 * Uses fetchStatusData only; 2s refresh.
 */
export async function runOpenTUILiveDashboardProjects(
  config: Config,
  statusOptions: StatusOptions,
): Promise<void> {
  const importTimeoutMs = 300;
  const mod = (await Promise.race([
    import("@opentui/core"),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("OpenTUI import timeout")),
        importTimeoutMs,
      ),
    ),
  ]).catch(() => null)) as OpenTUIMod | null;
  if (!mod?.createCliRenderer || !mod.Box || !mod.Text) {
    throw new Error("OpenTUI not available");
  }

  const initTimeoutMs = 350;
  const rendererPromise = mod.createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 10,
  });
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("OpenTUI init timeout")), initTimeoutMs),
  );
  const renderer = await Promise.race([rendererPromise, timeoutPromise]);

  const w = getTerminalWidth();
  const { Box, Text } = mod;
  const rootBox = Box(
    {
      id: STATUS_ROOT_ID,
      borderStyle: "round",
      border: true,
      width: w,
      height: "auto",
    },
    Text({ content: "Loading..." }),
  );
  renderer.root.add(rootBox);

  process.on("SIGINT", () => {
    renderer.destroy();
    process.exit(0);
  });
  renderer.prependInputHandler((sequence: string) => {
    if (sequence.toLowerCase() === "q" || sequence === "\x03") {
      renderer.destroy();
      process.exit(0);
      return true;
    }
    return false;
  });

  const refreshContent = (data: StatusData) => {
    try {
      const width = getTerminalWidth();
      const newContent =
        formatDashboardProjectsView(data, width) +
        "\n\n" +
        getDashboardFooterLine(data);
      if (!updateRootTextContent(renderer, STATUS_ROOT_ID, newContent)) {
        replaceRootWithNewBox(
          renderer,
          Box,
          Text,
          STATUS_ROOT_ID,
          newContent,
          width,
        );
      }
    } catch {
      // ignore
    }
  };

  const timer = setInterval(async () => {
    if (renderer.isDestroyed) {
      clearInterval(timer);
      return;
    }
    const result = await fetchStatusData(config, statusOptions);
    result.match(refreshContent, () => {});
  }, REFRESH_MS);

  renderer.on("destroy", () => {
    clearInterval(timer);
  });

  await renderer.setupTerminal();

  fetchStatusData(config, statusOptions).then((result) => {
    result.match(refreshContent, () => {});
  });

  return new Promise<void>((resolve) => {
    renderer.on("destroy", () => resolve());
  });
}

export type FetchProjectsFn = (
  config: Config,
  options: StatusOptions,
) => ResultAsync<ProjectRow[], import("../../domain/errors.js").AppError>;

/**
 * Run the live projects view using OpenTUI. Same behavior as runOpenTUILive
 * but uses fetchProjectsTableData and formatProjectsAsString.
 */
export async function runOpenTUILiveProjects(
  config: Config,
  statusOptions: StatusOptions,
  fetchProjects: FetchProjectsFn = fetchProjectsTableData,
): Promise<void> {
  const importTimeoutMs = 300;
  const mod = (await Promise.race([
    import("@opentui/core"),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("OpenTUI import timeout")),
        importTimeoutMs,
      ),
    ),
  ]).catch(() => null)) as OpenTUIMod | null;
  if (!mod?.createCliRenderer || !mod.Box || !mod.Text) {
    throw new Error("OpenTUI not available");
  }

  const initTimeoutMs = 350;
  const rendererPromise = mod.createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 10,
  });
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("OpenTUI init timeout")), initTimeoutMs),
  );
  const renderer = await Promise.race([rendererPromise, timeoutPromise]);

  const w = getTerminalWidth();
  let initialRows: ProjectRow[] = [];

  const firstResult = await fetchProjects(config, statusOptions);
  firstResult.match(
    (rows) => {
      initialRows = rows;
    },
    () => {},
  );

  const content = initialRows.length
    ? formatProjectsAsString(initialRows, w)
    : "Loading...";

  const { Box, Text } = mod;
  const rootBox = Box(
    {
      id: STATUS_ROOT_ID,
      borderStyle: "round",
      border: true,
      width: w,
      height: "auto",
    },
    Text({ content }),
  );
  renderer.root.add(rootBox);

  process.on("SIGINT", () => {
    renderer.destroy();
    process.exit(0);
  });
  renderer.prependInputHandler((sequence: string) => {
    if (sequence.toLowerCase() === "q" || sequence === "\x03") {
      renderer.destroy();
      process.exit(0);
      return true;
    }
    return false;
  });

  const timer = setInterval(async () => {
    if (renderer.isDestroyed) {
      clearInterval(timer);
      return;
    }
    const result = await fetchProjects(config, statusOptions);
    result.match(
      (data) => {
        try {
          const w = getTerminalWidth();
          const newContent = formatProjectsAsString(data, w);
          if (!updateRootTextContent(renderer, STATUS_ROOT_ID, newContent)) {
            replaceRootWithNewBox(
              renderer,
              Box,
              Text,
              STATUS_ROOT_ID,
              newContent,
              w,
            );
          }
        } catch {
          // ignore update errors
        }
      },
      () => {},
    );
  }, REFRESH_MS);

  renderer.on("destroy", () => {
    clearInterval(timer);
  });

  await renderer.setupTerminal();
  return new Promise<void>((resolve) => {
    renderer.on("destroy", () => resolve());
  });
}

export type FetchTasksFn = (
  config: Config,
  options: StatusOptions,
) => ResultAsync<TaskRow[], import("../../domain/errors.js").AppError>;

/**
 * Run the live tasks view using OpenTUI. Same behavior as runOpenTUILiveProjects
 * but uses fetchTasksTableData and formatTasksAsString.
 */
export async function runOpenTUILiveTasks(
  config: Config,
  statusOptions: StatusOptions,
  fetchTasks: FetchTasksFn = fetchTasksTableData,
): Promise<void> {
  const importTimeoutMs = 300;
  const mod = (await Promise.race([
    import("@opentui/core"),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("OpenTUI import timeout")),
        importTimeoutMs,
      ),
    ),
  ]).catch(() => null)) as OpenTUIMod | null;
  if (!mod?.createCliRenderer || !mod.Box || !mod.Text) {
    throw new Error("OpenTUI not available");
  }

  const initTimeoutMs = 350;
  const rendererPromise = mod.createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 10,
  });
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("OpenTUI init timeout")), initTimeoutMs),
  );
  const renderer = await Promise.race([rendererPromise, timeoutPromise]);

  const w = getTerminalWidth();
  let initialRows: TaskRow[] = [];
  let initialStaleIds = new Set<string>();

  const firstResult = await ResultAsync.combine([
    fetchTasks(config, statusOptions),
    fetchStaleDoingTasks(
      config.doltRepoPath,
      statusOptions.staleThreshold ?? 2,
    ),
  ]);
  firstResult.match(
    ([rows, staleDoingTasks]) => {
      initialRows = rows;
      initialStaleIds = new Set(staleDoingTasks.map((t) => t.task_id));
    },
    () => {},
  );

  const content = initialRows.length
    ? formatTasksAsString(initialRows, w, {
        staleTaskIds: initialStaleIds,
      })
    : "Loading...";

  const { Box, Text } = mod;
  const rootBox = Box(
    {
      id: STATUS_ROOT_ID,
      borderStyle: "round",
      border: true,
      width: w,
      height: "auto",
    },
    Text({ content }),
  );
  renderer.root.add(rootBox);

  process.on("SIGINT", () => {
    renderer.destroy();
    process.exit(0);
  });
  renderer.prependInputHandler((sequence: string) => {
    if (sequence.toLowerCase() === "q" || sequence === "\x03") {
      renderer.destroy();
      process.exit(0);
      return true;
    }
    return false;
  });

  const timer = setInterval(async () => {
    if (renderer.isDestroyed) {
      clearInterval(timer);
      return;
    }
    const result = await ResultAsync.combine([
      fetchTasks(config, statusOptions),
      fetchStaleDoingTasks(
        config.doltRepoPath,
        statusOptions.staleThreshold ?? 2,
      ),
    ]);
    result.match(
      ([data, staleDoingTasks]) => {
        try {
          const w = getTerminalWidth();
          const staleIds = new Set(staleDoingTasks.map((t) => t.task_id));
          const newContent = formatTasksAsString(data, w, {
            staleTaskIds: staleIds,
          });
          if (!updateRootTextContent(renderer, STATUS_ROOT_ID, newContent)) {
            replaceRootWithNewBox(
              renderer,
              Box,
              Text,
              STATUS_ROOT_ID,
              newContent,
              w,
            );
          }
        } catch {
          // ignore update errors
        }
      },
      () => {},
    );
  }, REFRESH_MS);

  renderer.on("destroy", () => {
    clearInterval(timer);
  });

  await renderer.setupTerminal();
  return new Promise<void>((resolve) => {
    renderer.on("destroy", () => resolve());
  });
}

export type FetchInitiativesFn = (
  config: Config,
  options: StatusOptions,
) => ResultAsync<InitiativeRow[], import("../../domain/errors.js").AppError>;

/**
 * Run the live initiatives view using OpenTUI. Same behavior as runOpenTUILiveProjects
 * but uses fetchInitiativesTableData and formatInitiativesAsString.
 */
export async function runOpenTUILiveInitiatives(
  config: Config,
  statusOptions: StatusOptions,
  fetchInitiatives: FetchInitiativesFn = fetchInitiativesTableData,
): Promise<void> {
  const importTimeoutMs = 300;
  const mod = (await Promise.race([
    import("@opentui/core"),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("OpenTUI import timeout")),
        importTimeoutMs,
      ),
    ),
  ]).catch(() => null)) as OpenTUIMod | null;
  if (!mod?.createCliRenderer || !mod.Box || !mod.Text) {
    throw new Error("OpenTUI not available");
  }

  const initTimeoutMs = 350;
  const rendererPromise = mod.createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 10,
  });
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("OpenTUI init timeout")), initTimeoutMs),
  );
  const renderer = await Promise.race([rendererPromise, timeoutPromise]);

  const w = getTerminalWidth();
  let initialRows: InitiativeRow[] = [];

  const firstResult = await fetchInitiatives(config, statusOptions);
  firstResult.match(
    (rows) => {
      initialRows = rows;
    },
    () => {},
  );

  const content = initialRows.length
    ? formatInitiativesAsString(initialRows, w)
    : "Loading...";

  const { Box, Text } = mod;
  const rootBox = Box(
    {
      id: STATUS_ROOT_ID,
      borderStyle: "round",
      border: true,
      width: w,
      height: "auto",
    },
    Text({ content }),
  );
  renderer.root.add(rootBox);

  process.on("SIGINT", () => {
    renderer.destroy();
    process.exit(0);
  });
  renderer.prependInputHandler((sequence: string) => {
    if (sequence.toLowerCase() === "q" || sequence === "\x03") {
      renderer.destroy();
      process.exit(0);
      return true;
    }
    return false;
  });

  const timer = setInterval(async () => {
    if (renderer.isDestroyed) {
      clearInterval(timer);
      return;
    }
    const result = await fetchInitiatives(config, statusOptions);
    result.match(
      (data) => {
        try {
          const w = getTerminalWidth();
          const newContent = formatInitiativesAsString(data, w);
          if (!updateRootTextContent(renderer, STATUS_ROOT_ID, newContent)) {
            replaceRootWithNewBox(
              renderer,
              Box,
              Text,
              STATUS_ROOT_ID,
              newContent,
              w,
            );
          }
        } catch {
          // ignore update errors
        }
      },
      () => {},
    );
  }, REFRESH_MS);

  renderer.on("destroy", () => {
    clearInterval(timer);
  });

  await renderer.setupTerminal();
  return new Promise<void>((resolve) => {
    renderer.on("destroy", () => resolve());
  });
}
