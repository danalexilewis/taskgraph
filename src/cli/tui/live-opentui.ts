/**
 * OpenTUI live renderer for tg status --dashboard.
 * When createCliRenderer() or OpenTUI init fails (e.g. under Node), the caller
 * should fall back to the minimal TUI (setInterval + ANSI clear + printHumanStatus).
 */

import { ResultAsync } from "neverthrow";
import stripAnsi from "strip-ansi";
import type {
  InitiativeRow,
  ProjectRow,
  StatusData,
  StatusOptions,
  TaskRow,
} from "../status.js";
import {
  DASHBOARD_MAX_PLANS,
  fetchInitiativesTableData,
  fetchProjectsTableData,
  fetchStaleDoingTasks,
  fetchStatusData,
  fetchTasksTableData,
  formatDashboardProjectsView,
  formatDashboardTasksView,
  formatInitiativesAsString,
  formatProjectsAsString,
  formatTasksAsString,
  getActivePlansSectionContent,
  getActivePlansTableData,
  getDashboardFooterContent,
  getDashboardFooterLine,
  getDashboardRowLimitsDynamic,
  getMergedActiveNextContent,
  getMergedActiveNextTableData,
  sortActivePlansForDashboard,
} from "../status.js";
import { getTerminalHeight, getTerminalWidth } from "../terminal.js";
import type { Config } from "../utils.js";
import { getBoxInnerWidthDashboard } from "./boxen.js";
import { runLoadingProgressBar } from "./loading-progress.js";

const STATUS_ROOT_ID = "tg-status-root";
const REFRESH_MS = 2000;
const SETUP_TIMEOUT_MS = 5000;

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
  /** Optional: for TextTable section content. */
  h?: (type: unknown, props?: object, ...children: unknown[]) => unknown;
  TextTableRenderable?: new (
    ctx: unknown,
    options: { content?: unknown },
  ) => unknown;
  RGBA?: {
    fromHex: (hex: string) => { r: number; g: number; b: number; a: number };
  };
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
      border: false,
      width,
      height: "auto",
    },
    Text({ content: newContent }),
  );
  renderer.root.add(newBox);
}

const SECTION_ID_PROJECTS = "tg-dash-projects";
const SECTION_ID_TASKS = "tg-dash-tasks";
const SECTION_ID_STATS = "tg-dash-stats";

/**
 * Build section content for the default dashboard (OpenTUI path).
 * Uses same status helpers as fallback but strips chalk ANSI; section titles
 * and frame styling come from Box title + borderColor, not embedded ANSI.
 */
function getDefaultDashboardSectionContent(
  data: StatusData,
  w: number,
): { projects: string; tasks: string; stats: string } {
  const innerW = getBoxInnerWidthDashboard(w);
  const sortedPlans = sortActivePlansForDashboard(data.activePlans);
  const actualTaskRows = data.activeWork.length + data.nextTasks.length;
  const actualPlanRows = data.activePlans.length;
  const { maxTaskRows } = getDashboardRowLimitsDynamic(
    actualTaskRows,
    actualPlanRows,
    getTerminalHeight(),
  );
  const plansContent = getActivePlansSectionContent(
    { ...data, activePlans: sortedPlans },
    w,
    DASHBOARD_MAX_PLANS,
    innerW,
  );
  const tasksContent = getMergedActiveNextContent(data, w, maxTaskRows, innerW);
  const statsContent = getDashboardFooterContent(data, innerW);
  return {
    projects: plansContent ? stripAnsi(plansContent) : "",
    tasks: stripAnsi(tasksContent),
    stats: stripAnsi(statsContent),
  };
}

/**
 * Build OpenTUI TextTableContent from headers + rows (same data as renderTable).
 * Header row gets distinct fg; body cells use plain text (ANSI stripped).
 */
function buildTextTableContent(
  headers: string[],
  rows: string[][],
  headerFg: unknown,
): unknown[] {
  const headerRow: unknown[][] = headers.map((h) => [
    { __isChunk: true as const, text: stripAnsi(h), fg: headerFg },
  ]);
  const bodyRows: unknown[][] = rows.map((row) =>
    row.map((cell) => [{ __isChunk: true as const, text: stripAnsi(cell) }]),
  );
  return [...headerRow, ...bodyRows];
}

/**
 * Build root Box with three section Boxes (Active Projects, Active tasks, Stats).
 * When data is undefined, each section shows "Loading...".
 * When mod exposes h + TextTableRenderable + RGBA, Projects and Tasks use TextTable; Stats stays Text.
 */
function buildDefaultDashboardRoot(
  mod: OpenTUIMod,
  w: number,
  data?: StatusData,
): unknown {
  const { Box, Text } = mod;
  const loading = "Loading...";
  const sectionContent = data
    ? getDefaultDashboardSectionContent(data, w)
    : { projects: loading, tasks: loading, stats: loading };
  const projectsContent = sectionContent.projects || loading;
  const tasksContent = sectionContent.tasks;
  const statsContent = sectionContent.stats;

  const useTextTable =
    typeof mod.h === "function" &&
    mod.TextTableRenderable != null &&
    mod.RGBA != null;

  let projectsChild: unknown = Text({ content: projectsContent });
  let tasksChild: unknown = Text({ content: tasksContent });

  if (useTextTable && data) {
    const innerW = getBoxInnerWidthDashboard(w);
    const sortedPlans = sortActivePlansForDashboard(data.activePlans);
    const actualTaskRows = data.activeWork.length + data.nextTasks.length;
    const actualPlanRows = data.activePlans.length;
    const { maxTaskRows } = getDashboardRowLimitsDynamic(
      actualTaskRows,
      actualPlanRows,
      getTerminalHeight(),
    );
    const headerFg = mod.RGBA?.fromHex("#6b7280");
    const plansTableData = getActivePlansTableData(
      { ...data, activePlans: sortedPlans },
      w,
      DASHBOARD_MAX_PLANS,
      innerW,
    );
    const tasksTableData = getMergedActiveNextTableData(
      data,
      w,
      maxTaskRows,
      innerW,
    );
    const h = mod.h;
    const TextTableRenderable = mod.TextTableRenderable;
    if (headerFg && h && TextTableRenderable) {
      if (plansTableData) {
        projectsChild = h(TextTableRenderable, {
          content: buildTextTableContent(
            plansTableData.headers,
            plansTableData.rows,
            headerFg,
          ),
          showBorders: false,
          border: false,
        });
      }
      tasksChild = h(TextTableRenderable, {
        content: buildTextTableContent(
          tasksTableData.headers,
          tasksTableData.rows,
          headerFg,
        ),
        showBorders: false,
        border: false,
      });
    }
  }

  return Box(
    {
      id: STATUS_ROOT_ID,
      border: false,
      width: w,
      height: "auto",
      flexDirection: "column",
      gap: 1,
    },
    Box(
      {
        id: SECTION_ID_PROJECTS,
        borderStyle: "round",
        border: true,
        borderColor: "cyan",
        title: "Active Projects",
        padding: 1,
        width: w,
      },
      projectsChild,
    ),
    Box(
      {
        id: SECTION_ID_TASKS,
        borderStyle: "round",
        border: true,
        borderColor: "cyan",
        title: "Active tasks and upcoming",
        padding: 1,
        width: w,
      },
      tasksChild,
    ),
    Box(
      {
        id: SECTION_ID_STATS,
        borderStyle: "round",
        border: true,
        borderColor: "yellow",
        title: "Stats",
        padding: 1,
        width: w,
      },
      Text({ content: statsContent }),
    ),
  );
}

/**
 * Update the three section content nodes in place (Text or TextTable).
 * Returns true if updated, false if structure doesn't match.
 */
function updateDefaultDashboardSections(
  renderer: OpenTUIRenderer,
  mod: OpenTUIMod,
  rootId: string,
  data: StatusData,
): boolean {
  const root = renderer.root.getRenderable(rootId);
  if (!root?.getChildren) return false;
  const children = root.getChildren();
  if (children.length !== 3) return false;
  const w = getTerminalWidth();
  const sectionContent = getDefaultDashboardSectionContent(data, w);
  const useTextTable =
    typeof mod.h === "function" &&
    mod.TextTableRenderable != null &&
    mod.RGBA != null;

  const innerW = getBoxInnerWidthDashboard(w);
  const sortedPlans = sortActivePlansForDashboard(data.activePlans);
  const actualTaskRows = data.activeWork.length + data.nextTasks.length;
  const actualPlanRows = data.activePlans.length;
  const { maxTaskRows } = getDashboardRowLimitsDynamic(
    actualTaskRows,
    actualPlanRows,
    getTerminalHeight(),
  );
  const headerFg = useTextTable ? mod.RGBA?.fromHex("#6b7280") : null;
  const plansTableData = useTextTable
    ? getActivePlansTableData(
        { ...data, activePlans: sortedPlans },
        w,
        DASHBOARD_MAX_PLANS,
        innerW,
      )
    : null;
  const tasksTableData = useTextTable
    ? getMergedActiveNextTableData(data, w, maxTaskRows, innerW)
    : null;

  const stringContents = [
    sectionContent.projects || "Loading...",
    sectionContent.tasks,
    sectionContent.stats,
  ];

  for (let i = 0; i < 3; i++) {
    const sectionBox = children[i];
    if (!sectionBox?.getChildren) return false;
    const contentNode = sectionBox.getChildren()[0];
    if (!contentNode) return false;
    const node = contentNode as { content?: string | unknown[] };
    if (typeof node.content === "undefined") return false;
    if (Array.isArray(node.content)) {
      if (!headerFg || !tasksTableData) return false;
      if (i === 0) {
        if (!plansTableData) return false;
        node.content = buildTextTableContent(
          plansTableData.headers,
          plansTableData.rows,
          headerFg,
        );
      } else if (i === 1) {
        node.content = buildTextTableContent(
          tasksTableData.headers,
          tasksTableData.rows,
          headerFg,
        );
      }
      // i === 2 is Stats, always string
    } else {
      node.content = stringContents[i];
    }
  }
  renderer.root.requestRender?.();
  return true;
}

/**
 * Replace root with the multi-section dashboard root (used after error state or initial load).
 */
function replaceRootWithDashboardSections(
  renderer: OpenTUIRenderer,
  mod: OpenTUIMod,
  rootId: string,
  data: StatusData | undefined,
  w: number,
): void {
  const child = renderer.root.getRenderable(rootId);
  if (child) {
    child.destroy();
    renderer.root.remove(rootId);
  }
  const newRoot = buildDefaultDashboardRoot(mod, w, data);
  renderer.root.add(newRoot);
}

export async function runOpenTUILive(
  config: Config,
  statusOptions: StatusOptions,
  fetchStatus: FetchStatusFn = fetchStatusData,
): Promise<void> {
  const importTimeoutMs = 3000;
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

  const initTimeoutMs = 2000;
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
  const rootBox = buildDefaultDashboardRoot(mod, w, undefined);
  renderer.root.add(rootBox);

  const progressBar = runLoadingProgressBar({
    onTick: (content) => {
      if (updateRootTextContent(renderer, STATUS_ROOT_ID, content)) {
        renderer.root.requestRender?.();
      }
    },
    getWidth: getTerminalWidth,
  });

  process.on("SIGINT", () => {
    progressBar.stop();
    renderer.destroy();
    process.exit(0);
  });
  renderer.prependInputHandler((sequence: string) => {
    if (sequence.toLowerCase() === "q" || sequence === "\x03") {
      progressBar.stop();
      renderer.destroy();
      process.exit(0);
      return true;
    }
    return false;
  });

  const refreshContent = (data: StatusData) => {
    try {
      if (
        !updateDefaultDashboardSections(renderer, mod, STATUS_ROOT_ID, data)
      ) {
        replaceRootWithDashboardSections(
          renderer,
          mod,
          STATUS_ROOT_ID,
          data,
          getTerminalWidth(),
        );
      }
      renderer.root.requestRender?.();
    } catch {
      // ignore
    }
  };

  let consecutiveErrors = 0;
  let timer: ReturnType<typeof setInterval>;

  const startRefreshInterval = () => {
    timer = setInterval(async () => {
      if (renderer.isDestroyed) {
        clearInterval(timer);
        return;
      }
      const result = await fetchStatus(config, statusOptions);
      result.match(
        (data) => {
          consecutiveErrors = 0;
          refreshContent(data);
        },
        (e) => {
          consecutiveErrors++;
          if (consecutiveErrors >= 3) {
            const msg = `[tg] DB refresh error: ${e.message}`;
            replaceRootWithNewBox(
              renderer,
              Box,
              Text,
              STATUS_ROOT_ID,
              msg,
              getTerminalWidth(),
            );
            renderer.root.requestRender?.();
          }
        },
      );
    }, REFRESH_MS);
  };

  renderer.on("destroy", () => {
    progressBar.stop();
    if (timer) clearInterval(timer);
  });

  // Run setupTerminal then initial fetch (no interval yet, so fetch isn't competing for DB).
  await Promise.race([
    renderer.setupTerminal(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("setupTerminal timeout")),
        SETUP_TIMEOUT_MS,
      ),
    ),
  ]);

  const result = await fetchStatus(config, statusOptions);
  progressBar.stop();
  result.match(refreshContent, () => {});
  renderer.root.requestRender?.();
  startRefreshInterval();

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
  const importTimeoutMs = 3000;
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

  const initTimeoutMs = 2000;
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
      border: false,
      width: w,
      height: "auto",
    },
    Text({ content: "Loading\n" }),
  );
  renderer.root.add(rootBox);

  const progressBarTasks = runLoadingProgressBar({
    onTick: (content) => {
      if (updateRootTextContent(renderer, STATUS_ROOT_ID, content)) {
        renderer.root.requestRender?.();
      }
    },
    getWidth: getTerminalWidth,
  });

  process.on("SIGINT", () => {
    progressBarTasks.stop();
    renderer.destroy();
    process.exit(0);
  });
  renderer.prependInputHandler((sequence: string) => {
    if (sequence.toLowerCase() === "q" || sequence === "\x03") {
      progressBarTasks.stop();
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
      renderer.root.requestRender?.();
    } catch {
      // ignore
    }
  };

  let consecutiveErrors = 0;
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
    if (data != null) {
      consecutiveErrors = 0;
      refreshContent(data, activeRows);
    } else {
      consecutiveErrors++;
      if (consecutiveErrors >= 3) {
        const msg = "[tg] DB refresh error";
        if (!updateRootTextContent(renderer, STATUS_ROOT_ID, msg)) {
          replaceRootWithNewBox(
            renderer,
            Box,
            Text,
            STATUS_ROOT_ID,
            msg,
            getTerminalWidth(),
          );
        }
        renderer.root.requestRender?.();
      }
    }
  }, REFRESH_MS);

  renderer.on("destroy", () => {
    clearInterval(timer);
  });

  const initialFetchPromise = Promise.all([
    fetchStatusData(config, statusOptions),
    fetchTasksTableData(config, activeOptions),
  ]);

  await Promise.race([
    renderer.setupTerminal(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("setupTerminal timeout")),
        SETUP_TIMEOUT_MS,
      ),
    ),
  ]);

  const [statusResult, activeResult] = await initialFetchPromise;
  progressBarTasks.stop();
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
  if (data != null) {
    refreshContent(data, activeRows);
    renderer.root.requestRender?.();
  }

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
  const importTimeoutMs = 3000;
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

  const initTimeoutMs = 2000;
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
      border: false,
      width: w,
      height: "auto",
    },
    Text({ content: "Loading\n" }),
  );
  renderer.root.add(rootBox);

  const progressBarProjects = runLoadingProgressBar({
    onTick: (content) => {
      if (updateRootTextContent(renderer, STATUS_ROOT_ID, content)) {
        renderer.root.requestRender?.();
      }
    },
    getWidth: getTerminalWidth,
  });

  process.on("SIGINT", () => {
    progressBarProjects.stop();
    renderer.destroy();
    process.exit(0);
  });
  renderer.prependInputHandler((sequence: string) => {
    if (sequence.toLowerCase() === "q" || sequence === "\x03") {
      progressBarProjects.stop();
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
      renderer.root.requestRender?.();
    } catch {
      // ignore
    }
  };

  let consecutiveErrors = 0;
  const timer = setInterval(async () => {
    if (renderer.isDestroyed) {
      clearInterval(timer);
      return;
    }
    const result = await fetchStatusData(config, statusOptions);
    result.match(
      (data) => {
        consecutiveErrors = 0;
        refreshContent(data);
      },
      (e) => {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          const msg = `[tg] DB refresh error: ${e.message}`;
          if (!updateRootTextContent(renderer, STATUS_ROOT_ID, msg)) {
            replaceRootWithNewBox(
              renderer,
              Box,
              Text,
              STATUS_ROOT_ID,
              msg,
              getTerminalWidth(),
            );
          }
          renderer.root.requestRender?.();
        }
      },
    );
  }, REFRESH_MS);

  renderer.on("destroy", () => {
    clearInterval(timer);
  });

  const initialFetchPromise = fetchStatusData(config, statusOptions);

  await Promise.race([
    renderer.setupTerminal(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("setupTerminal timeout")),
        SETUP_TIMEOUT_MS,
      ),
    ),
  ]);

  const result = await initialFetchPromise;
  progressBarProjects.stop();
  result.match(refreshContent, () => {});
  renderer.root.requestRender?.();

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
  const importTimeoutMs = 3000;
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

  const initTimeoutMs = 2000;
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
      border: false,
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

  let consecutiveErrors = 0;
  const timer = setInterval(async () => {
    if (renderer.isDestroyed) {
      clearInterval(timer);
      return;
    }
    const result = await fetchProjects(config, statusOptions);
    result.match(
      (data) => {
        consecutiveErrors = 0;
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
      (e) => {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          const msg = `[tg] DB refresh error: ${e.message}`;
          if (!updateRootTextContent(renderer, STATUS_ROOT_ID, msg)) {
            replaceRootWithNewBox(
              renderer,
              Box,
              Text,
              STATUS_ROOT_ID,
              msg,
              getTerminalWidth(),
            );
          }
        }
      },
    );
  }, REFRESH_MS);

  renderer.on("destroy", () => {
    clearInterval(timer);
  });

  await Promise.race([
    renderer.setupTerminal(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("setupTerminal timeout")),
        SETUP_TIMEOUT_MS,
      ),
    ),
  ]);
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
  const importTimeoutMs = 3000;
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

  const initTimeoutMs = 2000;
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
      border: false,
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

  let consecutiveErrors = 0;
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
        consecutiveErrors = 0;
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
      (e) => {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          const msg = `[tg] DB refresh error: ${e.message}`;
          if (!updateRootTextContent(renderer, STATUS_ROOT_ID, msg)) {
            replaceRootWithNewBox(
              renderer,
              Box,
              Text,
              STATUS_ROOT_ID,
              msg,
              getTerminalWidth(),
            );
          }
        }
      },
    );
  }, REFRESH_MS);

  renderer.on("destroy", () => {
    clearInterval(timer);
  });

  await Promise.race([
    renderer.setupTerminal(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("setupTerminal timeout")),
        SETUP_TIMEOUT_MS,
      ),
    ),
  ]);
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
  const importTimeoutMs = 3000;
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

  const initTimeoutMs = 2000;
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
      border: false,
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

  let consecutiveErrors = 0;
  const timer = setInterval(async () => {
    if (renderer.isDestroyed) {
      clearInterval(timer);
      return;
    }
    const result = await fetchInitiatives(config, statusOptions);
    result.match(
      (data) => {
        consecutiveErrors = 0;
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
      (e) => {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          const msg = `[tg] DB refresh error: ${e.message}`;
          if (!updateRootTextContent(renderer, STATUS_ROOT_ID, msg)) {
            replaceRootWithNewBox(
              renderer,
              Box,
              Text,
              STATUS_ROOT_ID,
              msg,
              getTerminalWidth(),
            );
          }
        }
      },
    );
  }, REFRESH_MS);

  renderer.on("destroy", () => {
    clearInterval(timer);
  });

  await Promise.race([
    renderer.setupTerminal(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("setupTerminal timeout")),
        SETUP_TIMEOUT_MS,
      ),
    ),
  ]);
  return new Promise<void>((resolve) => {
    renderer.on("destroy", () => resolve());
  });
}
