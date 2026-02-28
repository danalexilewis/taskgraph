import chalk from "chalk";
import type { Command } from "commander";
import type { ResultAsync } from "neverthrow";
import { sqlEscape } from "../db/escape";
import { tableExists } from "../db/migrate";
import { query } from "../db/query";
import type { AppError } from "../domain/errors";
import { renderTable } from "./table";
import { getTerminalWidth } from "./terminal";
import { boxedSection } from "./tui/boxen";
import { type Config, readConfig, rootOpts } from "./utils";

const INITIATIVES_STUB_MESSAGE =
  "Initiatives view requires the Initiative-Project hierarchy (initiative table). Add the initiative table and optional plan.initiative_id to enable this view.";

export type StatusViewMode = "dashboard" | "tasks" | "projects" | "initiatives";

export interface StatusOptions {
  plan?: string;
  domain?: string;
  skill?: string;
  changeType?: string;
  all?: boolean;
  projects?: boolean;
  initiatives?: boolean;
  tasks?: boolean;
  filter?: string;
}

export interface ProjectRow {
  plan_id: string;
  title: string;
  status: string;
  todo: number;
  doing: number;
  blocked: number;
  done: number;
}

export interface InitiativeRow {
  initiative_id: string;
  title: string;
  status: string;
  cycle_start: string | null;
  cycle_end: string | null;
  project_count: number;
}

export interface TaskRow {
  task_id: string;
  hash_id: string | null;
  title: string;
  plan_title: string;
  status: string;
  owner: string;
}

function bt(name: string): string {
  return `\`${name}\``;
}

interface ActivePlanRow {
  plan_id: string;
  title: string;
  status: string;
  count: number;
}

interface NextTaskRow {
  task_id: string;
  hash_id: string | null;
  title: string;
  plan_title: string;
}

interface ActiveWorkRow {
  task_id: string;
  hash_id: string | null;
  title: string;
  plan_title: string;
  body: string | object | null;
  created_at: string | null;
}

export interface StatusData {
  completedPlans: number;
  completedTasks: number;
  canceledTasks: number;
  activePlans: Array<{
    plan_id: string;
    title: string;
    todo: number;
    doing: number;
    blocked: number;
    done: number;
    actionable: number;
  }>;
  staleTasks: Array<{ task_id: string; hash_id: string | null; title: string }>;
  nextTasks: NextTaskRow[];
  activeWork: ActiveWorkRow[];
  plansCount: number;
  statusCounts: Record<string, number>;
  actionableCount: number;
}

export function fetchStatusData(
  config: Config,
  options: StatusOptions,
): ResultAsync<StatusData, AppError> {
  const q = query(config.doltRepoPath);

  const isUUID =
    options.plan &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      options.plan,
    );

  const dimFilter =
    (options.domain
      ? ` AND EXISTS (SELECT 1 FROM ${bt("task_doc")} td WHERE td.task_id = t.task_id AND td.doc = '${sqlEscape(options.domain)}')`
      : "") +
    (options.skill
      ? ` AND EXISTS (SELECT 1 FROM ${bt("task_skill")} ts WHERE ts.task_id = t.task_id AND ts.skill = '${sqlEscape(options.skill)}')`
      : "") +
    (options.changeType
      ? ` AND t.${bt("change_type")} = '${sqlEscape(options.changeType)}'`
      : "");

  const excludeCanceledAbandoned = options.all
    ? ""
    : " AND t.status != 'canceled' AND p.status != 'abandoned' ";
  const planAbandonedFilter = options.all
    ? ""
    : " AND `status` != 'abandoned' ";

  let planWhere = "";
  if (options.plan) {
    if (isUUID) {
      planWhere = `WHERE ${bt("plan_id")} = '${sqlEscape(options.plan)}'`;
    } else {
      planWhere = `WHERE ${bt("title")} = '${sqlEscape(options.plan)}'`;
    }
  }

  const planFilter = options.plan
    ? isUUID
      ? `WHERE p.plan_id = '${sqlEscape(options.plan)}'`
      : `WHERE p.title = '${sqlEscape(options.plan)}'`
    : "";

  const completedPlansSql = `SELECT COUNT(*) AS count FROM ${bt("plan")} WHERE status = 'done'`;
  const completedTasksSql = `SELECT COUNT(*) AS count FROM ${bt("task")} WHERE status = 'done'`;
  const canceledTasksSql = `SELECT COUNT(*) AS count FROM ${bt("task")} WHERE status = 'canceled'`;

  const activePlansSql = `
    SELECT p.plan_id, p.title, t.status, COUNT(*) AS count
    FROM ${bt("plan")} p
    JOIN ${bt("task")} t ON t.plan_id = p.plan_id
    WHERE p.status NOT IN ('done', 'abandoned')
      AND t.status NOT IN ('canceled')
    ${options.plan ? (isUUID ? `AND p.plan_id = '${sqlEscape(options.plan)}'` : `AND p.title = '${sqlEscape(options.plan)}'`) : ""}
    ${dimFilter}
    GROUP BY p.plan_id, p.title, t.status
    ORDER BY p.title ASC
  `;

  const actionablePerPlanSql = `
    SELECT p.plan_id, COUNT(*) AS count
    FROM ${bt("task")} t
    JOIN ${bt("plan")} p ON t.plan_id = p.plan_id
    WHERE t.status = 'todo'
      AND p.status NOT IN ('done', 'abandoned')
      AND (SELECT COUNT(*) FROM ${bt("edge")} e
           JOIN ${bt("task")} bt ON e.from_task_id = bt.task_id
           WHERE e.to_task_id = t.task_id AND e.type = 'blocks'
           AND bt.status NOT IN ('done','canceled')) = 0
    ${options.plan ? (isUUID ? `AND p.plan_id = '${sqlEscape(options.plan)}'` : `AND p.title = '${sqlEscape(options.plan)}'`) : ""}
    ${dimFilter}
    GROUP BY p.plan_id
  `;

  const staleSql = `
    SELECT t.task_id, t.hash_id, t.title
    FROM ${bt("task")} t
    WHERE t.status = 'doing'
  `;

  const plansCountSql = dimFilter
    ? `SELECT COUNT(DISTINCT p.plan_id) AS count FROM ${bt("plan")} p JOIN ${bt("task")} t ON t.plan_id = p.plan_id ${planFilter || "WHERE 1=1"} ${dimFilter}${excludeCanceledAbandoned}`
    : `SELECT COUNT(*) AS count FROM ${bt("plan")} ${planWhere || "WHERE 1=1"}${planAbandonedFilter}`;
  const statusCountsSql = `SELECT t.status, COUNT(*) AS count FROM ${bt("task")} t JOIN ${bt("plan")} p ON t.plan_id = p.plan_id ${planFilter || "WHERE 1=1"} ${dimFilter}${excludeCanceledAbandoned} GROUP BY t.status`;
  const actionableCountSql = `
    SELECT COUNT(*) AS count FROM ${bt("task")} t
    JOIN ${bt("plan")} p ON t.plan_id = p.plan_id
    WHERE t.status = 'todo'
    AND (SELECT COUNT(*) FROM ${bt("edge")} e
         JOIN ${bt("task")} bt ON e.from_task_id = bt.task_id
         WHERE e.to_task_id = t.task_id AND e.type = 'blocks'
         AND bt.status NOT IN ('done','canceled')) = 0
    ${options.plan ? (isUUID ? `AND p.plan_id = '${sqlEscape(options.plan)}'` : `AND p.title = '${sqlEscape(options.plan)}'`) : ""}
    ${dimFilter}
    ${excludeCanceledAbandoned}
  `;
  const nextSql = `
    SELECT t.task_id, t.hash_id, t.title, p.title as plan_title
    FROM ${bt("task")} t
    JOIN ${bt("plan")} p ON t.plan_id = p.plan_id
    WHERE t.status = 'todo'
    AND (SELECT COUNT(*) FROM ${bt("edge")} e
         JOIN ${bt("task")} bt ON e.from_task_id = bt.task_id
         WHERE e.to_task_id = t.task_id AND e.type = 'blocks'
         AND bt.status NOT IN ('done','canceled')) = 0
    ${options.plan ? (isUUID ? `AND p.plan_id = '${sqlEscape(options.plan)}'` : `AND p.title = '${sqlEscape(options.plan)}'`) : ""}
    ${dimFilter}
    ${excludeCanceledAbandoned}
    ORDER BY p.priority DESC, t.created_at ASC
    LIMIT 3
  `;
  const activeWorkSql = `
    SELECT t.task_id, t.hash_id, t.title, p.title as plan_title, e.body, e.created_at
    FROM ${bt("task")} t
    JOIN ${bt("plan")} p ON t.plan_id = p.plan_id
    LEFT JOIN ${bt("event")} e ON e.task_id = t.task_id AND e.kind = 'started'
      AND e.created_at = (
        SELECT MAX(e2.created_at) FROM ${bt("event")} e2
        WHERE e2.task_id = t.task_id AND e2.kind = 'started'
      )
    WHERE t.status = 'doing'
    ${options.plan ? (isUUID ? `AND p.plan_id = '${sqlEscape(options.plan)}'` : `AND p.title = '${sqlEscape(options.plan)}'`) : ""}
    ${dimFilter}
    ${excludeCanceledAbandoned}
    ORDER BY e.created_at DESC, t.task_id
  `;

  return q.raw<{ count: number }>(completedPlansSql).andThen((cpRes) => {
    const completedPlans = cpRes[0]?.count ?? 0;
    return q.raw<{ count: number }>(completedTasksSql).andThen((ctRes) => {
      const completedTasks = ctRes[0]?.count ?? 0;
      return q.raw<{ count: number }>(canceledTasksSql).andThen((canRes) => {
        const canceledTasks = canRes[0]?.count ?? 0;
        return q.raw<ActivePlanRow>(activePlansSql).andThen((apRows) =>
          q
            .raw<{
              plan_id: string;
              count: number;
            }>(actionablePerPlanSql)
            .andThen((actionableRows) => {
              const actionableMap = new Map(
                actionableRows.map((r) => [r.plan_id, r.count]),
              );
              const planMap = new Map<
                string,
                {
                  plan_id: string;
                  title: string;
                  todo: number;
                  doing: number;
                  blocked: number;
                  done: number;
                  actionable: number;
                }
              >();
              for (const row of apRows) {
                if (!planMap.has(row.plan_id)) {
                  planMap.set(row.plan_id, {
                    plan_id: row.plan_id,
                    title: row.title,
                    todo: 0,
                    doing: 0,
                    blocked: 0,
                    done: 0,
                    actionable: actionableMap.get(row.plan_id) ?? 0,
                  });
                }
                const entry = planMap.get(row.plan_id);
                if (entry) {
                  if (row.status === "todo") entry.todo = row.count;
                  else if (row.status === "doing") entry.doing = row.count;
                  else if (row.status === "blocked") entry.blocked = row.count;
                  else if (row.status === "done") entry.done = row.count;
                }
              }
              const activePlans = Array.from(planMap.values());

              return q
                .raw<{
                  task_id: string;
                  hash_id: string | null;
                  title: string;
                }>(staleSql)
                .andThen((staleRows) =>
                  q.raw<{ count: number }>(plansCountSql).andThen((plansRes) =>
                    q
                      .raw<{
                        status: string;
                        count: number;
                      }>(statusCountsSql)
                      .andThen((statusRows) => {
                        const statusCounts: Record<string, number> = {};
                        statusRows.forEach((r) => {
                          statusCounts[r.status] = r.count;
                        });
                        return q
                          .raw<{
                            count: number;
                          }>(actionableCountSql)
                          .andThen((actionableRes) =>
                            q.raw<NextTaskRow>(nextSql).andThen((nextTasks) =>
                              q.raw<ActiveWorkRow>(activeWorkSql).map(
                                (activeWork): StatusData => ({
                                  completedPlans,
                                  completedTasks,
                                  canceledTasks,
                                  activePlans,
                                  staleTasks: staleRows,
                                  nextTasks,
                                  activeWork,
                                  plansCount: plansRes[0]?.count ?? 0,
                                  statusCounts,
                                  actionableCount: actionableRes[0]?.count ?? 0,
                                }),
                              ),
                            ),
                          );
                      }),
                  ),
                );
            }),
        );
      });
    });
  });
}

/**
 * Fetch projects (plans) table: one row per plan with task counts.
 * Reuses --plan, --domain, --skill, --all. When --filter active, plan status NOT IN ('done','abandoned').
 */
export function fetchProjectsTableData(
  config: Config,
  options: StatusOptions,
): ResultAsync<ProjectRow[], AppError> {
  const q = query(config.doltRepoPath);
  const isUUID =
    options.plan &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      options.plan,
    );

  const planWhere = options.plan
    ? isUUID
      ? `AND p.${bt("plan_id")} = '${sqlEscape(options.plan)}'`
      : `AND p.${bt("title")} = '${sqlEscape(options.plan)}'`
    : "";

  const dimJoin =
    (options.domain
      ? ` AND EXISTS (SELECT 1 FROM ${bt("task_doc")} td WHERE td.task_id = t.task_id AND td.doc = '${sqlEscape(options.domain)}')`
      : "") +
    (options.skill
      ? ` AND EXISTS (SELECT 1 FROM ${bt("task_skill")} ts WHERE ts.task_id = t.task_id AND ts.skill = '${sqlEscape(options.skill)}')`
      : "");

  const taskNotCanceled = options.all ? "" : " AND t.status != 'canceled' ";
  const planNotAbandoned = options.all ? "" : " AND p.status != 'abandoned' ";
  const filterActive =
    options.filter === "active"
      ? ` AND p.${bt("status")} NOT IN ('done', 'abandoned') `
      : "";

  const projectsSql = `
    SELECT p.plan_id, p.title, p.status,
      COALESCE(SUM(CASE WHEN t.status = 'todo' THEN 1 ELSE 0 END), 0) AS todo,
      COALESCE(SUM(CASE WHEN t.status = 'doing' THEN 1 ELSE 0 END), 0) AS doing,
      COALESCE(SUM(CASE WHEN t.status = 'blocked' THEN 1 ELSE 0 END), 0) AS blocked,
      COALESCE(SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END), 0) AS done
    FROM ${bt("plan")} p
    LEFT JOIN ${bt("task")} t ON t.plan_id = p.plan_id ${taskNotCanceled} ${dimJoin}
    WHERE 1=1 ${planWhere} ${planNotAbandoned} ${filterActive}
    GROUP BY p.plan_id, p.title, p.status
    ORDER BY p.title ASC
  `;

  return q.raw<{
    plan_id: string;
    title: string;
    status: string;
    todo: number;
    doing: number;
    blocked: number;
    done: number;
  }>(projectsSql);
}

/**
 * Fetch tasks table: one row per task with task id or hash, title, plan title, status, owner.
 * Reuses --plan, --domain, --skill, --change-type, --all. When --filter active: status IN (todo, doing, blocked).
 */
export function fetchTasksTableData(
  config: Config,
  options: StatusOptions,
): ResultAsync<TaskRow[], AppError> {
  const q = query(config.doltRepoPath);
  const isUUID =
    options.plan &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      options.plan,
    );

  const planFilter = options.plan
    ? isUUID
      ? `AND p.${bt("plan_id")} = '${sqlEscape(options.plan)}'`
      : `AND p.${bt("title")} = '${sqlEscape(options.plan)}'`
    : "";

  const dimFilter =
    (options.domain
      ? ` AND EXISTS (SELECT 1 FROM ${bt("task_doc")} td WHERE td.task_id = t.task_id AND td.doc = '${sqlEscape(options.domain)}')`
      : "") +
    (options.skill
      ? ` AND EXISTS (SELECT 1 FROM ${bt("task_skill")} ts WHERE ts.task_id = t.task_id AND ts.skill = '${sqlEscape(options.skill)}')`
      : "") +
    (options.changeType
      ? ` AND t.${bt("change_type")} = '${sqlEscape(options.changeType)}'`
      : "");

  const excludeCanceledAbandoned = options.all
    ? ""
    : " AND t.status != 'canceled' AND p.status != 'abandoned' ";
  const filterActive =
    options.filter === "active"
      ? ` AND t.${bt("status")} IN ('todo', 'doing', 'blocked') `
      : "";

  const tasksSql = `
    SELECT t.task_id, t.hash_id, t.title, p.title AS plan_title, t.status, t.owner
    FROM ${bt("task")} t
    JOIN ${bt("plan")} p ON t.plan_id = p.plan_id
    WHERE 1=1 ${planFilter} ${dimFilter} ${excludeCanceledAbandoned} ${filterActive}
    ORDER BY p.title ASC, t.created_at ASC
  `;

  return q.raw<TaskRow>(tasksSql);
}

/**
 * Fetch initiatives table: one row per initiative (initiative_id, title, status, cycle_start, cycle_end, project_count).
 * When --filter upcoming: status = 'draft' OR cycle_start > CURDATE(). Requires initiative table to exist.
 */
export function fetchInitiativesTableData(
  config: Config,
  options: StatusOptions,
): ResultAsync<InitiativeRow[], AppError> {
  const q = query(config.doltRepoPath);
  const filterUpcoming =
    options.filter === "upcoming"
      ? ` AND (i.${bt("status")} = 'draft' OR i.${bt("cycle_start")} > CURDATE()) `
      : "";

  const initiativesSql = `
    SELECT i.initiative_id, i.title, i.status, i.cycle_start, i.cycle_end,
      0 AS project_count
    FROM ${bt("initiative")} i
    WHERE 1=1 ${filterUpcoming}
    ORDER BY i.cycle_start ASC, i.title ASC
  `;

  return q.raw<InitiativeRow>(initiativesSql);
}

export function statusCommand(program: Command) {
  program
    .command("status")
    .description(
      "Quick overview: plans count, tasks by status, next runnable tasks",
    )
    .option("--plan <planId>", "Filter by plan ID or title")
    .option("--domain <domain>", "Filter by task domain")
    .option("--skill <skill>", "Filter by task skill")
    .option(
      "--change-type <type>",
      "Filter by change type: create, modify, refactor, fix, investigate, test, document",
    )
    .option("--all", "Include canceled tasks and abandoned plans")
    .option(
      "--projects",
      "Show projects (plans) table: Plan, Status, Todo, Doing, Blocked, Done",
    )
    .option(
      "--tasks",
      "Show tasks table: Id, Title, Plan, Status, Owner (reuses --plan, --domain, --skill, --filter active)",
    )
    .option(
      "--initiatives",
      "Show initiatives table (requires initiative table); stub message if missing",
    )
    .option(
      "--filter <filter>",
      "Filter: active (--projects or --tasks: plans not done/abandoned, or tasks todo/doing/blocked), upcoming (--initiatives)",
    )
    .option(
      "--dashboard",
      "Open status dashboard (live-updating TUI; 2s refresh, q or Ctrl+C to quit)",
    )
    .action(async (options, cmd) => {
      const useLive = options.dashboard;
      const statusOptions: StatusOptions = {
        plan: options.plan,
        domain: options.domain,
        skill: options.skill,
        changeType: options.changeType,
        all: options.all,
        projects: options.projects,
        initiatives: options.initiatives,
        tasks: options.tasks,
        filter: options.filter,
      };

      const viewCount = [
        options.tasks,
        options.projects,
        options.initiatives,
      ].filter(Boolean).length;
      if (viewCount > 1) {
        console.error(
          "tg status: only one of --tasks, --projects, or --initiatives is allowed.",
        );
        process.exit(1);
      }

      const viewMode: StatusViewMode = options.tasks
        ? "tasks"
        : options.initiatives
          ? "initiatives"
          : options.projects
            ? "projects"
            : "dashboard";

      if (viewMode === "initiatives") {
        const configResult = await readConfig();
        if (configResult.isErr()) {
          console.error(configResult.error.message);
          process.exit(1);
        }
        const config = configResult.value;
        const existsResult = await tableExists(
          config.doltRepoPath,
          "initiative",
        );
        if (existsResult.isErr()) {
          console.error(existsResult.error.message);
          process.exit(1);
        }
        if (!existsResult.value) {
          if (!rootOpts(cmd).json) {
            console.log(INITIATIVES_STUB_MESSAGE);
          } else {
            console.log(
              JSON.stringify({
                stub: true,
                message: INITIATIVES_STUB_MESSAGE,
              }),
            );
          }
          process.exit(0);
        }
        if (!useLive) {
          const result = await fetchInitiativesTableData(config, statusOptions);
          result.match(
            (rows: InitiativeRow[]) => {
              if (!rootOpts(cmd).json) {
                const w = getTerminalWidth();
                console.log(`\n${formatInitiativesAsString(rows, w)}\n`);
              } else {
                console.log(JSON.stringify(rows, null, 2));
              }
            },
            (e: AppError) => {
              console.error(`Error fetching initiatives: ${e.message}`);
              if (rootOpts(cmd).json) {
                console.log(
                  JSON.stringify({
                    status: "error",
                    code: e.code,
                    message: e.message,
                    cause: e.cause,
                  }),
                );
              }
              process.exit(1);
            },
          );
          return;
        }
        if (rootOpts(cmd).json) {
          console.error("tg status --dashboard does not support --json");
          process.exit(1);
        }
        const { runOpenTUILiveInitiatives } = await import(
          "./tui/live-opentui.js"
        );
        try {
          await runOpenTUILiveInitiatives(config, statusOptions);
          return;
        } catch {
          // OpenTUI not available; use fallback live loop
        }
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
            if (ch.toString().toLowerCase() === "q") cleanup();
          });
        }
        const firstResult = await fetchInitiativesTableData(
          config,
          statusOptions,
        );
        firstResult.match(
          (rows: InitiativeRow[]) => {
            const w = getTerminalWidth();
            console.log(`\n${formatInitiativesAsString(rows, w)}\n`);
            timer = setInterval(async () => {
              const r = await readConfig().asyncAndThen((c: Config) =>
                fetchInitiativesTableData(c, statusOptions),
              );
              r.match(
                (data) => {
                  process.stdout.write("\x1b[2J\x1b[H");
                  console.log(
                    `\n${formatInitiativesAsString(data, getTerminalWidth())}\n`,
                  );
                },
                () => {},
              );
            }, 2000);
          },
          (e: AppError) => {
            console.error(e.message);
            process.exit(1);
          },
        );
        return;
      }

      if (viewMode === "tasks" && !useLive) {
        const result = await readConfig().asyncAndThen((config: Config) =>
          fetchTasksTableData(config, statusOptions),
        );
        result.match(
          (rows: TaskRow[]) => {
            if (!rootOpts(cmd).json) {
              const w = getTerminalWidth();
              console.log(`\n${formatTasksAsString(rows, w)}\n`);
            } else {
              console.log(JSON.stringify(rows, null, 2));
            }
          },
          (e: AppError) => {
            console.error(`Error fetching tasks: ${e.message}`);
            if (rootOpts(cmd).json) {
              console.log(
                JSON.stringify({
                  status: "error",
                  code: e.code,
                  message: e.message,
                  cause: e.cause,
                }),
              );
            }
            process.exit(1);
          },
        );
        return;
      }

      if (viewMode === "projects" && !useLive) {
        const result = await readConfig().asyncAndThen((config: Config) =>
          fetchProjectsTableData(config, statusOptions),
        );
        result.match(
          (rows: ProjectRow[]) => {
            if (!rootOpts(cmd).json) {
              const w = getTerminalWidth();
              console.log(`\n${formatProjectsAsString(rows, w)}\n`);
            } else {
              console.log(JSON.stringify(rows, null, 2));
            }
          },
          (e: AppError) => {
            console.error(`Error fetching projects: ${e.message}`);
            if (rootOpts(cmd).json) {
              console.log(
                JSON.stringify({
                  status: "error",
                  code: e.code,
                  message: e.message,
                  cause: e.cause,
                }),
              );
            }
            process.exit(1);
          },
        );
        return;
      }

      if (useLive) {
        if (rootOpts(cmd).json) {
          console.error("tg status --dashboard does not support --json");
          process.exit(1);
        }
        const configResult = await readConfig();
        if (configResult.isErr()) {
          console.error(configResult.error.message);
          process.exit(1);
        }
        const config = configResult.value;

        if (viewMode === "projects") {
          const { runOpenTUILiveProjects } = await import(
            "./tui/live-opentui.js"
          );
          try {
            await runOpenTUILiveProjects(config, statusOptions);
            return;
          } catch {
            // OpenTUI not available; use fallback live loop
          }
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
              if (ch.toString().toLowerCase() === "q") cleanup();
            });
          }
          const firstResult = await fetchProjectsTableData(
            config,
            statusOptions,
          );
          firstResult.match(
            (rows: ProjectRow[]) => {
              const w = getTerminalWidth();
              console.log(`\n${formatProjectsAsString(rows, w)}\n`);
              timer = setInterval(async () => {
                const r = await readConfig().asyncAndThen((c: Config) =>
                  fetchProjectsTableData(c, statusOptions),
                );
                r.match(
                  (data) => {
                    process.stdout.write("\x1b[2J\x1b[H");
                    console.log(
                      `\n${formatProjectsAsString(data, getTerminalWidth())}\n`,
                    );
                  },
                  () => {},
                );
              }, 2000);
            },
            (e: AppError) => {
              console.error(e.message);
              process.exit(1);
            },
          );
          return;
        }

        if (viewMode === "tasks") {
          const { runOpenTUILiveTasks } = await import("./tui/live-opentui.js");
          try {
            await runOpenTUILiveTasks(config, statusOptions);
            return;
          } catch {
            // OpenTUI not available; use fallback live loop
          }
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
              if (ch.toString().toLowerCase() === "q") cleanup();
            });
          }
          const firstResult = await fetchTasksTableData(config, statusOptions);
          firstResult.match(
            (rows: TaskRow[]) => {
              const w = getTerminalWidth();
              console.log(`\n${formatTasksAsString(rows, w)}\n`);
              timer = setInterval(async () => {
                const r = await readConfig().asyncAndThen((c: Config) =>
                  fetchTasksTableData(c, statusOptions),
                );
                r.match(
                  (data) => {
                    process.stdout.write("\x1b[2J\x1b[H");
                    console.log(
                      `\n${formatTasksAsString(data, getTerminalWidth())}\n`,
                    );
                  },
                  () => {},
                );
              }, 2000);
            },
            (e: AppError) => {
              console.error(e.message);
              process.exit(1);
            },
          );
          return;
        }

        const { runOpenTUILive } = await import("./tui/live-opentui.js");
        try {
          await runOpenTUILive(config, statusOptions);
          return;
        } catch {
          // OpenTUI not available (e.g. Node); use fallback live loop
        }

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
            if (ch.toString().toLowerCase() === "q") cleanup();
          });
        }
        const result = await fetchStatusData(config, statusOptions);
        result.match(
          (d: StatusData) => {
            printHumanStatus(d);
            timer = setInterval(async () => {
              const r = await readConfig().asyncAndThen((c: Config) =>
                fetchStatusData(c, statusOptions),
              );
              r.match(
                (data) => {
                  process.stdout.write("\x1b[2J\x1b[H");
                  printHumanStatus(data);
                },
                () => {},
              );
            }, 2000);
          },
          (e: AppError) => {
            console.error(e.message);
            process.exit(1);
          },
        );
        return;
      }

      const result = await readConfig().asyncAndThen((config: Config) =>
        fetchStatusData(config, statusOptions),
      );
      result.match(
        (data: unknown) => {
          const d = data as StatusData;
          if (!rootOpts(cmd).json) {
            printHumanStatus(d);
          } else {
            printJsonStatus(d);
          }
        },
        (error: AppError) => {
          console.error(`Error fetching status: ${error.message}`);
          if (rootOpts(cmd).json) {
            console.log(
              JSON.stringify({
                status: "error",
                code: error.code,
                message: error.message,
                cause: error.cause,
              }),
            );
          }
          process.exit(1);
        },
      );
    });
}

function getCompletedSectionContent(d: StatusData): string {
  return (
    `  Plans: ${chalk.green(d.completedPlans)} done    ` +
    `Tasks: ${chalk.green(d.completedTasks)} done    ` +
    `Canceled: ${chalk.gray(d.canceledTasks)}`
  );
}

function getActivePlansSectionContent(d: StatusData, w: number): string {
  if (d.activePlans.length === 0) return "";
  const planRows = d.activePlans.map((p) => [
    p.title,
    String(p.todo),
    p.doing > 0 ? chalk.cyan(String(p.doing)) : "0",
    p.blocked > 0 ? chalk.red(String(p.blocked)) : "0",
    p.done > 0 ? chalk.green(String(p.done)) : "0",
    p.actionable > 0 ? chalk.greenBright(String(p.actionable)) : "0",
  ]);
  const sumTodo = d.activePlans.reduce((s, p) => s + p.todo, 0);
  const sumDoing = d.activePlans.reduce((s, p) => s + p.doing, 0);
  const sumBlocked = d.activePlans.reduce((s, p) => s + p.blocked, 0);
  const sumDone = d.activePlans.reduce((s, p) => s + p.done, 0);
  const sumReady = d.activePlans.reduce((s, p) => s + p.actionable, 0);
  const aggRow = [
    chalk.dim("Total"),
    String(sumTodo),
    sumDoing > 0 ? chalk.cyan(String(sumDoing)) : "0",
    sumBlocked > 0 ? chalk.red(String(sumBlocked)) : "0",
    sumDone > 0 ? chalk.green(String(sumDone)) : "0",
    sumReady > 0 ? chalk.greenBright(String(sumReady)) : "0",
  ];
  return renderTable({
    headers: ["Plan", "Todo", "Doing", "Blocked", "Done", "Ready"],
    rows: [...planRows, aggRow],
    maxWidth: w,
    minWidths: [12, 4, 5, 7, 4, 5],
  });
}

function getActiveWorkSectionContent(d: StatusData, w: number): string {
  const workRows =
    d.activeWork.length > 0
      ? d.activeWork.map((work) => {
          const body =
            work.body == null
              ? null
              : typeof work.body === "string"
                ? (JSON.parse(work.body) as { agent?: string })
                : (work.body as { agent?: string });
          const agent = body?.agent ?? "—";
          return [
            work.hash_id ?? work.task_id,
            work.title,
            work.plan_title,
            agent,
          ];
        })
      : [["—", "No active tasks", "—", "—"]];
  return renderTable({
    headers: ["Id", "Task", "Plan", "Agent"],
    rows: workRows,
    maxWidth: w,
    minWidths: [10, 12, 10, 6],
  });
}

function getNextRunnableSectionContent(d: StatusData, w: number): string {
  if (d.nextTasks.length === 0) return "";
  return renderTable({
    headers: ["Id", "Task", "Plan"],
    rows: d.nextTasks.map((t) => [
      t.hash_id ?? t.task_id,
      t.title,
      t.plan_title,
    ]),
    maxWidth: w,
    minWidths: [10, 12, 10],
  });
}

/**
 * Format projects table as a single string (boxed). Used for one-shot and live projects view.
 */
export function formatProjectsAsString(
  rows: ProjectRow[],
  width: number,
): string {
  const w = width;
  const projectRows = rows.map((p) => [
    p.title,
    p.status,
    String(p.todo),
    p.doing > 0 ? chalk.cyan(String(p.doing)) : "0",
    p.blocked > 0 ? chalk.red(String(p.blocked)) : "0",
    p.done > 0 ? chalk.green(String(p.done)) : "0",
  ]);
  const table = renderTable({
    headers: ["Project", "Status", "Todo", "Doing", "Blocked", "Done"],
    rows:
      projectRows.length > 0
        ? projectRows
        : [["No projects", "—", "0", "0", "0", "0"]],
    maxWidth: w,
    minWidths: [12, 8, 4, 5, 7, 4],
  });
  return boxedSection("Projects", table, w);
}

/**
 * Format tasks table as a single string (boxed). Used for one-shot and live tasks view.
 */
export function formatTasksAsString(rows: TaskRow[], width: number): string {
  const w = width;
  const taskRows = rows.map((r) => {
    const id = r.hash_id ?? r.task_id;
    return [id, r.title, r.plan_title, r.status, r.owner ?? "—"];
  });
  const table = renderTable({
    headers: ["Id", "Title", "Plan", "Status", "Owner"],
    rows: taskRows.length > 0 ? taskRows : [["—", "No tasks", "—", "—", "—"]],
    maxWidth: w,
    minWidths: [10, 12, 10, 8, 6],
  });
  return boxedSection("Tasks", table, w);
}

/**
 * Format initiatives table as a single string (boxed). Used for one-shot and live initiatives view.
 */
export function formatInitiativesAsString(
  rows: InitiativeRow[],
  width: number,
): string {
  const w = width;
  const initiativeRows = rows.map((r) => [
    r.title,
    r.status,
    r.cycle_start ?? "—",
    r.cycle_end ?? "—",
    String(r.project_count),
  ]);
  const table = renderTable({
    headers: ["Initiative", "Status", "Cycle Start", "Cycle End", "Projects"],
    rows:
      initiativeRows.length > 0
        ? initiativeRows
        : [["No initiatives", "—", "—", "—", "0"]],
    maxWidth: w,
    minWidths: [12, 8, 12, 10, 8],
  });
  return boxedSection("Initiatives", table, w);
}

/**
 * Format status as a single string (with section headers). Used by OpenTUI live view
 * and for consistent section content.
 */
export function formatStatusAsString(d: StatusData, width: number): string {
  const w = width;
  const parts: string[] = [];

  parts.push("Completed");
  parts.push(getCompletedSectionContent(d));

  const activePlans = getActivePlansSectionContent(d, w);
  if (activePlans) {
    parts.push("Active Plans");
    parts.push(activePlans);
  }

  parts.push("Active Work");
  parts.push(getActiveWorkSectionContent(d, w));

  const nextRunnable = getNextRunnableSectionContent(d, w);
  if (nextRunnable) {
    parts.push("Next Runnable");
    parts.push(nextRunnable);
  }

  return parts.join("\n\n");
}

function printHumanStatus(d: StatusData): void {
  const w = getTerminalWidth();

  console.log(
    `\n${boxedSection("Completed", getCompletedSectionContent(d), w)}`,
  );

  const activePlansContent = getActivePlansSectionContent(d, w);
  if (activePlansContent) {
    console.log(`\n${boxedSection("Active Plans", activePlansContent, w)}`);
  }

  console.log(
    `\n${boxedSection("Active Work", getActiveWorkSectionContent(d, w), w)}`,
  );

  const nextRunnableContent = getNextRunnableSectionContent(d, w);
  if (nextRunnableContent) {
    console.log(`\n${boxedSection("Next Runnable", nextRunnableContent, w)}`);
  }

  console.log("");
}

function printJsonStatus(d: StatusData): void {
  const todo = d.statusCounts.todo ?? 0;
  const doing = d.statusCounts.doing ?? 0;
  const blocked = d.statusCounts.blocked ?? 0;
  console.log(
    JSON.stringify(
      {
        completedPlans: d.completedPlans,
        completedTasks: d.completedTasks,
        canceledTasks: d.canceledTasks,
        activePlans: d.activePlans,
        staleTasks: d.staleTasks,
        plansCount: d.plansCount,
        statusCounts: d.statusCounts,
        actionableCount: d.actionableCount,
        nextTasks: d.nextTasks,
        activeWork: d.activeWork,
        summary: {
          not_done: todo + doing + blocked,
          in_progress: doing,
          blocked,
          actionable: d.actionableCount,
        },
      },
      null,
      2,
    ),
  );
}
