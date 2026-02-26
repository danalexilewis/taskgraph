import { Command } from "commander";
import { readConfig, Config, rootOpts } from "./utils";
import { ResultAsync } from "neverthrow";
import { AppError } from "../domain/errors";
import { query } from "../db/query";
import { sqlEscape } from "../db/escape";

function backtickWrap(name: string): string {
  return `\`${name}\``;
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
    .action(async (options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        const q = query(config.doltRepoPath);

        const isUUID =
          options.plan &&
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
            options.plan,
          );

        let planWhere = "";
        if (options.plan) {
          if (isUUID) {
            planWhere = `WHERE ${backtickWrap("plan_id")} = '${sqlEscape(options.plan)}'`;
          } else {
            planWhere = `WHERE ${backtickWrap("title")} = '${sqlEscape(options.plan)}'`;
          }
        }
        const dimFilter =
          (options.domain
            ? ` AND EXISTS (SELECT 1 FROM \`task_domain\` td WHERE td.task_id = t.task_id AND td.domain = '${sqlEscape(options.domain)}')`
            : "") +
          (options.skill
            ? ` AND EXISTS (SELECT 1 FROM \`task_skill\` ts WHERE ts.task_id = t.task_id AND ts.skill = '${sqlEscape(options.skill)}')`
            : "") +
          (options.changeType
            ? ` AND t.\`change_type\` = '${sqlEscape(options.changeType)}'`
            : "");

        const planFilter = options.plan
          ? isUUID
            ? `WHERE p.plan_id = '${sqlEscape(options.plan)}'`
            : `WHERE p.title = '${sqlEscape(options.plan)}'`
          : "";
        const plansCountSql = dimFilter
          ? `SELECT COUNT(DISTINCT p.plan_id) AS count FROM \`plan\` p JOIN \`task\` t ON t.plan_id = p.plan_id ${planFilter || "WHERE 1=1"} ${dimFilter}`
          : `SELECT COUNT(*) AS count FROM \`plan\` ${planWhere}`;
        const statusCountsSql = `SELECT t.status, COUNT(*) AS count FROM \`task\` t JOIN \`plan\` p ON t.plan_id = p.plan_id ${planFilter || "WHERE 1=1"} ${dimFilter} GROUP BY t.status`;
        const actionableCountSql = `
          SELECT COUNT(*) AS count FROM \`task\` t
          JOIN \`plan\` p ON t.plan_id = p.plan_id
          WHERE t.status = 'todo'
          AND (SELECT COUNT(*) FROM \`edge\` e
               JOIN \`task\` bt ON e.from_task_id = bt.task_id
               WHERE e.to_task_id = t.task_id AND e.type = 'blocks'
               AND bt.status NOT IN ('done','canceled')) = 0
          ${options.plan ? (isUUID ? `AND p.plan_id = '${sqlEscape(options.plan)}'` : `AND p.title = '${sqlEscape(options.plan)}'`) : ""}
          ${dimFilter}
        `;
        const nextSql = `
          SELECT t.task_id, t.title, p.title as plan_title
          FROM \`task\` t
          JOIN \`plan\` p ON t.plan_id = p.plan_id
          WHERE t.status = 'todo'
          AND (SELECT COUNT(*) FROM \`edge\` e
               JOIN \`task\` bt ON e.from_task_id = bt.task_id
               WHERE e.to_task_id = t.task_id AND e.type = 'blocks'
               AND bt.status NOT IN ('done','canceled')) = 0
          ${options.plan ? (isUUID ? `AND p.plan_id = '${sqlEscape(options.plan)}'` : `AND p.title = '${sqlEscape(options.plan)}'`) : ""}
          ${dimFilter}
          ORDER BY p.priority DESC, t.created_at ASC
          LIMIT 2
        `;

        const activeWorkSql = `
          SELECT t.task_id, t.title, p.title as plan_title, e.body, e.created_at
          FROM \`task\` t
          JOIN \`plan\` p ON t.plan_id = p.plan_id
          JOIN \`event\` e ON e.task_id = t.task_id AND e.kind = 'started'
          WHERE t.status = 'doing'
          AND e.created_at = (
            SELECT MAX(e2.created_at) FROM \`event\` e2
            WHERE e2.task_id = t.task_id AND e2.kind = 'started'
          )
          ${options.plan ? (isUUID ? `AND p.plan_id = '${sqlEscape(options.plan)}'` : `AND p.title = '${sqlEscape(options.plan)}'`) : ""}
          ${dimFilter}
          ORDER BY e.created_at DESC
        `;

        return q.raw<{ count: number }>(plansCountSql).andThen((plansRes) => {
          const plansCount = plansRes[0]?.count ?? 0;
          return q
            .raw<{ status: string; count: number }>(statusCountsSql)
            .andThen((statusRows) => {
              const statusCounts: Record<string, number> = {};
              statusRows.forEach((r) => {
                statusCounts[r.status] = r.count;
              });
              return q
                .raw<{ count: number }>(actionableCountSql)
                .andThen((actionableRes) => {
                  const actionableCount = actionableRes[0]?.count ?? 0;
                  return q
                    .raw<{
                      task_id: string;
                      title: string;
                      plan_title: string;
                    }>(nextSql)
                    .andThen((nextTasks) =>
                      q
                        .raw<{
                          task_id: string;
                          title: string;
                          plan_title: string;
                          body: string;
                          created_at: string;
                        }>(activeWorkSql)
                        .map((activeWork) => ({
                          plansCount,
                          statusCounts,
                          actionableCount,
                          nextTasks,
                          activeWork,
                        })),
                    );
                });
            });
        });
      });

      result.match(
        (data: unknown) => {
          const d = data as {
            plansCount: number;
            statusCounts: Record<string, number>;
            actionableCount: number;
            nextTasks: Array<{
              task_id: string;
              title: string;
              plan_title: string;
            }>;
            activeWork: Array<{
              task_id: string;
              title: string;
              plan_title: string;
              body: string | object;
              created_at: string;
            }>;
          };
          if (!rootOpts(cmd).json) {
            console.log(`Plans: ${d.plansCount}`);
            const todo = d.statusCounts["todo"] ?? 0;
            const doing = d.statusCounts["doing"] ?? 0;
            const blocked = d.statusCounts["blocked"] ?? 0;
            const notDone = todo + doing + blocked;
            console.log(
              `Tasks: ${notDone} not done (${doing} in progress, ${blocked} blocked, ${d.actionableCount} actionable)`,
            );
            const statusOrder = [
              "todo",
              "doing",
              "blocked",
              "done",
              "canceled",
            ];
            statusOrder.forEach((s) => {
              const count = d.statusCounts[s] ?? 0;
              if (count > 0) console.log(`  ${s}: ${count}`);
            });
            if (d.activeWork.length > 0) {
              console.log("Active work:");
              d.activeWork.forEach((w) => {
                const body =
                  typeof w.body === "string"
                    ? (JSON.parse(w.body) as { agent?: string })
                    : (w.body as { agent?: string });
                const agent = body?.agent ?? "unknown";
                console.log(
                  `  ${w.task_id}  ${w.title} (${w.plan_title}) [${agent}] ${w.created_at}`,
                );
              });
            }
            if (d.nextTasks.length > 0) {
              console.log("Next runnable:");
              d.nextTasks.forEach((t) => {
                console.log(`  ${t.task_id}  ${t.title} (${t.plan_title})`);
              });
            }
          } else {
            const todo = d.statusCounts["todo"] ?? 0;
            const doing = d.statusCounts["doing"] ?? 0;
            const blocked = d.statusCounts["blocked"] ?? 0;
            console.log(
              JSON.stringify(
                {
                  ...d,
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
