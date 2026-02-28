/**
 * OpenTUI live renderer for tg status --dashboard.
 * When createCliRenderer() or OpenTUI init fails (e.g. under Node), the caller
 * should fall back to the minimal TUI (setInterval + ANSI clear + printHumanStatus).
 */

import type { ResultAsync } from "neverthrow";
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
  fetchStatusData,
  fetchTasksTableData,
  formatInitiativesAsString,
  formatProjectsAsString,
  formatStatusAsString,
  formatTasksAsString,
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
type OpenTUIMod = {
  createCliRenderer: (config?: object) => Promise<{
    root: {
      add: (node: unknown) => number;
      remove: (id: string) => void;
      getRenderable: (id: string) => { destroy: () => void } | undefined;
    };
    prependInputHandler: (fn: (seq: string) => boolean) => void;
    on: (ev: string, fn: () => void) => void;
    setupTerminal: () => Promise<void>;
    destroy: () => void;
    isDestroyed: boolean;
  }>;
  Box: (props: object, ...children: unknown[]) => unknown;
  Text: (props: { content: string }) => unknown;
};

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
  let initialData: StatusData | null = null;

  const firstResult = await fetchStatus(config, statusOptions);
  firstResult.match(
    (d) => {
      initialData = d;
    },
    () => {},
  );

  const content = initialData
    ? formatStatusAsString(initialData, w)
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

  renderer.prependInputHandler((sequence: string) => {
    if (sequence.toLowerCase() === "q") {
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
    const result = await fetchStatus(config, statusOptions);
    result.match(
      (data) => {
        try {
          const child = renderer.root.getRenderable(STATUS_ROOT_ID);
          if (child) {
            child.destroy();
            renderer.root.remove(STATUS_ROOT_ID);
          }
          const newContent = formatStatusAsString(data, getTerminalWidth());
          const newBox = Box(
            {
              id: STATUS_ROOT_ID,
              borderStyle: "round",
              border: true,
              width: getTerminalWidth(),
              height: "auto",
            },
            Text({ content: newContent }),
          );
          renderer.root.add(newBox);
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

  renderer.prependInputHandler((sequence: string) => {
    if (sequence.toLowerCase() === "q") {
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
          const child = renderer.root.getRenderable(STATUS_ROOT_ID);
          if (child) {
            child.destroy();
            renderer.root.remove(STATUS_ROOT_ID);
          }
          const newContent = formatProjectsAsString(data, getTerminalWidth());
          const newBox = Box(
            {
              id: STATUS_ROOT_ID,
              borderStyle: "round",
              border: true,
              width: getTerminalWidth(),
              height: "auto",
            },
            Text({ content: newContent }),
          );
          renderer.root.add(newBox);
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

  const firstResult = await fetchTasks(config, statusOptions);
  firstResult.match(
    (rows) => {
      initialRows = rows;
    },
    () => {},
  );

  const content = initialRows.length
    ? formatTasksAsString(initialRows, w)
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

  renderer.prependInputHandler((sequence: string) => {
    if (sequence.toLowerCase() === "q") {
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
    const result = await fetchTasks(config, statusOptions);
    result.match(
      (data) => {
        try {
          const child = renderer.root.getRenderable(STATUS_ROOT_ID);
          if (child) {
            child.destroy();
            renderer.root.remove(STATUS_ROOT_ID);
          }
          const newContent = formatTasksAsString(data, getTerminalWidth());
          const newBox = Box(
            {
              id: STATUS_ROOT_ID,
              borderStyle: "round",
              border: true,
              width: getTerminalWidth(),
              height: "auto",
            },
            Text({ content: newContent }),
          );
          renderer.root.add(newBox);
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

  renderer.prependInputHandler((sequence: string) => {
    if (sequence.toLowerCase() === "q") {
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
          const child = renderer.root.getRenderable(STATUS_ROOT_ID);
          if (child) {
            child.destroy();
            renderer.root.remove(STATUS_ROOT_ID);
          }
          const newContent = formatInitiativesAsString(
            data,
            getTerminalWidth(),
          );
          const newBox = Box(
            {
              id: STATUS_ROOT_ID,
              borderStyle: "round",
              border: true,
              width: getTerminalWidth(),
              height: "auto",
            },
            Text({ content: newContent }),
          );
          renderer.root.add(newBox);
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
