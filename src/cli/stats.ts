import type { Command } from "commander";
import { sqlEscape } from "../db/escape";
import { query } from "../db/query";
import type { AppError } from "../domain/errors";
import { renderTable } from "./table";
import { getTerminalWidth } from "./terminal";
import { readConfig, rootOpts } from "./utils";

interface AgentRow {
  agent: string | null;
  tasks_done: number;
}

interface ElapsedRow {
  agent: string | null;
  avg_seconds: number;
}

interface ReviewRow {
  verdict: string | null;
  reviewer: string | null;
  cnt: number;
}

interface PlanSummaryRow {
  title: string;
  plan_started_at: string | null;
  plan_done_at: string | null;
  total_elapsed_s: number | null;
  task_count: number;
}

interface PlanTaskRow {
  hash_id: string;
  title: string;
  elapsed_s: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tool_calls: number | null;
}

interface TimelineRow {
  plan_id: string;
  title: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  total_elapsed_s: number | null;
  task_count: number;
  done_count: number;
}

interface TokenRow {
  agent: string | null;
  tasks_done: number;
  avg_tokens_in: number | null;
  avg_tokens_out: number | null;
  avg_tool_calls: number | null;
  total_tokens_in: number | null;
  total_tokens_out: number | null;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const s = Math.round(Number(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function formatVelocity(taskCount: number, elapsedS: number | null): string {
  if (elapsedS == null || elapsedS <= 0) return "N/A";
  const velocity = taskCount / (Number(elapsedS) / 3600);
  return `${velocity.toFixed(1)} tasks/hr`;
}

export function statsCommand(program: Command) {
  program
    .command("stats")
    .description(
      "Derive agent metrics from event data: tasks completed, review pass/fail counts, average elapsed time per task",
    )
      .option("--agent <name>", "Filter by agent name")
      .option('--benchmark <benchmark>', 'Filter by benchmark')
    .option(
      "--plan <planId>",
      "Show per-task elapsed table and plan summary for a specific plan",
    )
    .option("--timeline", "Show cross-plan execution history sorted by date")
    .option("--recovery", "Include recovery metrics: investigator fix rate")
    .option("--benchmark", "Filter to benchmark plans (only include projects where is_benchmark = 1)")
    .option("--benchmark", "Filter benchmark projects")
    .action(async (options, cmd) => {
      const configResult = readConfig();
      if (configResult.isErr()) {
        console.error(configResult.error.message);
        process.exit(1);
      }
      const config = configResult.value;
      const json = rootOpts(cmd).json ?? false;
      const benchmark = options.benchmark ?? false;
      const filterSql = benchmark ? "AND p.is_benchmark = 1" : "";
      const q = query(config.doltRepoPath);

      // --timeline mode: show cross-plan history
      if (options.timeline) {
        const tableName = "project";
        const filterSql = benchmark ? "WHERE p.is_benchmark = 1" : "";
        let timelineSql = `
          SELECT
            p.plan_id,
            p.title,
            p.status,
            MIN(e_start.created_at) AS started_at,
            MAX(e_done.created_at)  AS completed_at,
            TIMESTAMPDIFF(SECOND, MIN(e_start.created_at), MAX(e_done.created_at)) AS total_elapsed_s,
            COUNT(DISTINCT t.task_id) AS task_count,
            COUNT(DISTINCT CASE WHEN e_done.kind = 'done' THEN t.task_id END) AS done_count
          FROM \`${tableName}\` p
          LEFT JOIN task t ON t.plan_id = p.plan_id
          LEFT JOIN event e_start ON e_start.task_id = t.task_id AND e_start.kind = 'started'
          LEFT JOIN event e_done  ON e_done.task_id  = t.task_id AND e_done.kind  = 'done'
          GROUP BY p.plan_id, p.title, p.status
          ORDER BY started_at DESC
        `;

        if (options.benchmark) {
          timelineSql = timelineSql.replace(`FROM \`${tableName}\` p`, `FROM \`${tableName}\` p WHERE p.is_benchmark = 1`);
        }
        const timelineResult = await q.raw<TimelineRow>(timelineSql);
        timelineResult.match(
          (rows) => {
            if (json) {
              const out = rows.map((r) => ({
                plan_id: r.plan_id,
                title: r.title,
                status: r.status,
                started_at: r.started_at ?? null,
                completed_at: r.completed_at ?? null,
                total_elapsed_s:
                  r.total_elapsed_s != null ? Number(r.total_elapsed_s) : null,
                task_count: Number(r.task_count),
                done_count: Number(r.done_count),
              }));
              console.log(JSON.stringify(out, null, 2));
              return;
            }
            if (rows.length === 0) {
              console.log("No plan history found.");
              return;
            }
            const w = getTerminalWidth();
            const tableRows = rows.map((r) => [
              r.started_at ? String(r.started_at).slice(0, 10) : "—",
              r.title,
              r.status,
              `${Number(r.done_count)}/${Number(r.task_count)}`,
              formatDuration(r.total_elapsed_s),
              formatVelocity(Number(r.done_count), r.total_elapsed_s),
            ]);
            const table = renderTable({
              headers: [
                "Started",
                "Plan",
                "Status",
                "Tasks",
                "Duration",
                "Velocity",
              ],
              rows: tableRows,
              maxWidth: w,
              flexColumnIndex: 1,
            });
            console.log("Plan Timeline:");
            console.log(table);
          },
          (e: AppError) => {
            console.error(`Error fetching timeline: ${e.message}`);
            if (json) {
              console.log(
                JSON.stringify({
                  status: "error",
                  code: e.code,
                  message: e.message,
                }),
              );
            }
            process.exit(1);
          },
        );
        return;
      }

      // --plan mode: show per-task elapsed table and plan summary
      if (options.plan != null && String(options.plan).trim() !== "") {
        const planRaw = sqlEscape(String(options.plan).trim());
        const isUUID =
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i.test(
            options.plan,
          );
        let planCondition = isUUID
          ? `p.plan_id = '${planRaw}'`
          : `p.title = '${planRaw}'`;
        const tableName = "project";

        const planSummarySql = `
          SELECT
            p.title,
            MIN(e_start.created_at) AS plan_started_at,
            MAX(e_done.created_at)  AS plan_done_at,
            TIMESTAMPDIFF(SECOND, MIN(e_start.created_at), MAX(e_done.created_at)) AS total_elapsed_s,
            COUNT(DISTINCT t.task_id) AS task_count
          FROM \`${tableName}\` p
          JOIN task t ON t.plan_id = p.plan_id
          JOIN event e_start ON e_start.task_id = t.task_id AND e_start.kind = 'started'
          JOIN event e_done  ON e_done.task_id  = t.task_id AND e_done.kind  = 'done'
          WHERE ${planCondition} ${filterSql}
        `;

        const planTasksSql = `
          SELECT
            t.hash_id,
            t.title,
            TIMESTAMPDIFF(SECOND, e_start.created_at, e_done.created_at) AS elapsed_s,
            CAST(JSON_EXTRACT(e_done.body, '$.tokens_in') AS UNSIGNED) AS tokens_in,
            CAST(JSON_EXTRACT(e_done.body, '$.tokens_out') AS UNSIGNED) AS tokens_out,
            CAST(JSON_EXTRACT(e_done.body, '$.tool_calls') AS UNSIGNED) AS tool_calls
          FROM task t
          JOIN \`${tableName}\` p ON p.plan_id = t.plan_id
          JOIN event e_start ON e_start.task_id = t.task_id AND e_start.kind = 'started'
          JOIN event e_done  ON e_done.task_id  = t.task_id AND e_done.kind  = 'done'
          WHERE ${planCondition} ${filterSql}
          ORDER BY elapsed_s DESC
        `;

        const summaryResult = await q.raw<PlanSummaryRow>(planSummarySql);
        const tasksResult = await q.raw<PlanTaskRow>(planTasksSql);

        summaryResult.match(
          (summaryRows) => {
            tasksResult.match(
              (taskRows) => {
                const summary = summaryRows[0];

                if (json) {
                  const planSummary = summary
                    ? {
                        title: summary.title,
                        plan_started_at: summary.plan_started_at ?? null,
                        plan_done_at: summary.plan_done_at ?? null,
                        total_elapsed_s:
                          summary.total_elapsed_s != null
                            ? Number(summary.total_elapsed_s)
                            : null,
                        task_count: Number(summary.task_count),
                        velocity: formatVelocity(
                          Number(summary.task_count),
                          summary.total_elapsed_s,
                        ),
                      }
                    : null;
                  const tasks = taskRows.map((r) => ({
                    hash_id: r.hash_id,
                    title: r.title,
                    elapsed_s: r.elapsed_s != null ? Number(r.elapsed_s) : null,
                    tokens_in: r.tokens_in != null ? Number(r.tokens_in) : null,
                    tokens_out:
                      r.tokens_out != null ? Number(r.tokens_out) : null,
                    tool_calls:
                      r.tool_calls != null ? Number(r.tool_calls) : null,
                  }));
                  console.log(JSON.stringify({ planSummary, tasks }, null, 2));
                  return;
                }

                if (!summary) {
                  console.log(`No data found for plan: ${options.plan}`);
                  return;
                }

                const duration = formatDuration(summary.total_elapsed_s);
                const velocity = formatVelocity(
                  Number(summary.task_count),
                  summary.total_elapsed_s,
                );
                console.log(
                  `Plan: ${summary.title} | Duration: ${duration} | Velocity: ${velocity} | Tasks: ${Number(summary.task_count)}`,
                );

                if (taskRows.length === 0) {
                  console.log("  No task data.");
                  return;
                }

                const hasTokens = taskRows.some(
                  (r) => r.tokens_in != null || r.tokens_out != null,
                );
                const w = getTerminalWidth();
                const headers = hasTokens
                  ? [
                      "Id",
                      "Task",
                      "Elapsed",
                      "Tokens In",
                      "Tokens Out",
                      "Tool Calls",
                    ]
                  : ["Id", "Task", "Elapsed"];
                const tableRows = taskRows.map((r) => {
                  const base = [
                    r.hash_id,
                    r.title,
                    formatDuration(r.elapsed_s),
                  ];
                  if (hasTokens) {
                    base.push(
                      r.tokens_in != null ? String(r.tokens_in) : "N/A",
                      r.tokens_out != null ? String(r.tokens_out) : "N/A",
                      r.tool_calls != null ? String(r.tool_calls) : "N/A",
                    );
                  }
                  return base;
                });
                const table = renderTable({
                  headers,
                  rows: tableRows,
                  maxWidth: w,
                  flexColumnIndex: 1,
                });
                console.log(table);
              },
              (e: AppError) => {
                console.error(`Error fetching plan tasks: ${e.message}`);
                if (json)
                  console.log(
                    JSON.stringify({
                      status: "error",
                      code: e.code,
                      message: e.message,
                    }),
                  );
                process.exit(1);
              },
            );
          },
          (e: AppError) => {
            console.error(`Error fetching plan summary: ${e.message}`);
            if (json)
              console.log(
                JSON.stringify({
                  status: "error",
                  code: e.code,
                  message: e.message,
                }),
              );
            process.exit(1);
          },
        );
        return;
      }

      // Default mode: agent metrics + optional token usage section
      const agentFilter =
        options.agent != null && String(options.agent).trim() !== ""
          ? `AND agent = '${sqlEscape(String(options.agent).trim())}'`
          : "";

      const tasksDoneSql = `
        SELECT agent, COUNT(*) AS tasks_done
        FROM event d
        JOIN (
          SELECT e.task_id, JSON_UNQUOTE(JSON_EXTRACT(e.body, '$.agent')) AS agent
          FROM event e
          WHERE e.kind = 'started'
          AND e.created_at = (SELECT MAX(e2.created_at) FROM event e2 WHERE e2.task_id = e.task_id AND e2.kind = 'started')
        ) s ON d.task_id = s.task_id
        WHERE d.kind = 'done'
        ${agentFilter}
        GROUP BY agent
        ORDER BY tasks_done DESC
      `;

      const elapsedSql = `
        SELECT agent, AVG(seconds) AS avg_seconds
        FROM (
          SELECT
            (SELECT JSON_UNQUOTE(JSON_EXTRACT(e.body, '$.agent')) FROM event e WHERE e.task_id = d.task_id AND e.kind = 'started' ORDER BY e.created_at DESC LIMIT 1) AS agent,
            TIMESTAMPDIFF(SECOND,
              (SELECT created_at FROM event e WHERE e.task_id = d.task_id AND e.kind = 'started' ORDER BY e.created_at DESC LIMIT 1),
              d.created_at
            ) AS seconds
          FROM event d
          WHERE d.kind = 'done'
        ) x
        WHERE agent IS NOT NULL
        ${agentFilter}
        GROUP BY agent
      `;

      const reviewSql = `
        SELECT
          JSON_UNQUOTE(JSON_EXTRACT(JSON_UNQUOTE(JSON_EXTRACT(body, '$.message')), '$.verdict')) AS verdict,
          JSON_UNQUOTE(JSON_EXTRACT(JSON_UNQUOTE(JSON_EXTRACT(body, '$.message')), '$.reviewer')) AS reviewer,
          COUNT(*) AS cnt
        FROM event
        WHERE kind = 'note'
        AND JSON_UNQUOTE(JSON_EXTRACT(JSON_UNQUOTE(JSON_EXTRACT(body, '$.message')), '$.type')) = 'review'
        GROUP BY verdict, reviewer
      `;

      const tokenSql = `
        SELECT
          t.owner AS agent,
          COUNT(*) AS tasks_done,
          AVG(CAST(JSON_EXTRACT(e.body, '$.tokens_in') AS UNSIGNED)) AS avg_tokens_in,
          AVG(CAST(JSON_EXTRACT(e.body, '$.tokens_out') AS UNSIGNED)) AS avg_tokens_out,
          AVG(CAST(JSON_EXTRACT(e.body, '$.tool_calls') AS UNSIGNED)) AS avg_tool_calls,
          SUM(CAST(JSON_EXTRACT(e.body, '$.tokens_in') AS UNSIGNED)) AS total_tokens_in,
          SUM(CAST(JSON_EXTRACT(e.body, '$.tokens_out') AS UNSIGNED)) AS total_tokens_out
        FROM task t
        JOIN event e ON e.task_id = t.task_id AND e.kind = 'done'
        WHERE JSON_EXTRACT(e.body, '$.tokens_in') IS NOT NULL
        GROUP BY t.owner
      `;

      const tasksResult = await q.raw<AgentRow>(tasksDoneSql);
      const elapsedResult = await q.raw<ElapsedRow>(elapsedSql);
      const reviewResult = await q.raw<ReviewRow>(reviewSql);
      const tokenResult = await q.raw<TokenRow>(tokenSql);

      tasksResult.match(
        (tasksRows) => {
          elapsedResult.match(
            (elapsedRows) => {
              reviewResult.match(
                (reviewRows) => {
                  tokenResult.match(
                    (tokenRows) => {
                      const agents = new Map<
                        string,
                        {
                          tasks_done: number;
                          avg_seconds: number | null;
                          review_pass: number;
                          review_fail: number;
                        }
                      >();
                      for (const r of tasksRows) {
                        const agent = r.agent ?? "unknown";
                        agents.set(agent, {
                          tasks_done: Number(r.tasks_done),
                          avg_seconds: null,
                          review_pass: 0,
                          review_fail: 0,
                        });
                      }
                      for (const r of elapsedRows) {
                        const agent = r.agent ?? "unknown";
                        if (!agents.has(agent)) {
                          agents.set(agent, {
                            tasks_done: 0,
                            avg_seconds: Number(r.avg_seconds),
                            review_pass: 0,
                            review_fail: 0,
                          });
                        } else {
                          (
                            agents.get(agent) as { avg_seconds: number | null }
                          ).avg_seconds = Number(r.avg_seconds);
                        }
                      }
                      for (const r of reviewRows) {
                        const reviewer = r.reviewer ?? "unknown";
                        if (!agents.has(reviewer)) {
                          agents.set(reviewer, {
                            tasks_done: 0,
                            avg_seconds: null,
                            review_pass: 0,
                            review_fail: 0,
                          });
                        }
                        const entry = agents.get(reviewer);
                        if (!entry) continue;
                        const v = (r.verdict ?? "").toUpperCase();
                        if (v === "PASS") entry.review_pass += Number(r.cnt);
                        else if (v === "FAIL")
                          entry.review_fail += Number(r.cnt);
                      }

                      const out = Array.from(agents.entries()).map(
                        ([agent, m]) => ({
                          agent,
                          tasks_done: m.tasks_done,
                          avg_seconds: m.avg_seconds,
                          review_pass: m.review_pass,
                          review_fail: m.review_fail,
                        }),
                      );

                      const tokenUsage = tokenRows.map((r) => ({
                        agent: r.agent ?? "unknown",
                        tasks_done: Number(r.tasks_done),
                        avg_tokens_in:
                          r.avg_tokens_in != null
                            ? Number(r.avg_tokens_in)
                            : null,
                        avg_tokens_out:
                          r.avg_tokens_out != null
                            ? Number(r.avg_tokens_out)
                            : null,
                        avg_tool_calls:
                          r.avg_tool_calls != null
                            ? Number(r.avg_tool_calls)
                            : null,
                        total_tokens_in:
                          r.total_tokens_in != null
                            ? Number(r.total_tokens_in)
                            : null,
                        total_tokens_out:
                          r.total_tokens_out != null
                            ? Number(r.total_tokens_out)
                            : null,
                      }));

                      if (json) {
                        const result: Record<string, unknown> = {
                          agent_metrics: out,
                        };
                        if (tokenUsage.length > 0)
                          result.token_usage = tokenUsage;
                        if (options.recovery) {
            const recoverySql = `
              SELECT
                SUM(CASE WHEN had_failure THEN 1 ELSE 0 END) AS plans_with_failure,
                SUM(CASE WHEN fixed THEN 1 ELSE 0 END) AS plans_fixed
              FROM (
                SELECT
                  p.plan_id,
                  MAX(CASE WHEN body LIKE '%gate:full failed%' THEN 1 ELSE 0 END) = 1 AS had_failure,
                  MAX(CASE WHEN body LIKE '%gate:full passed%' THEN 1 ELSE 0 END) = 1 AS fixed
                FROM project p
                JOIN task t ON t.plan_id = p.plan_id
                JOIN event e ON e.task_id = t.task_id AND e.kind = 'done'
                WHERE t.title RLIKE 'run[ -]?full[ -]?suite|gate:full'
                GROUP BY p.plan_id
              ) x
            `;
            const recoveryResult = await q.raw<{plans_with_failure: number; plans_fixed: number;}>(recoverySql);
            recoveryResult.match(
              (rows) => {
                const stats = rows[0];
                result.recovery = {
                  plans_with_failure: Number(stats.plans_with_failure),
                  plans_fixed: Number(stats.plans_fixed),
                  fix_rate: stats.plans_with_failure > 0 ? Number(stats.plans_fixed) / Number(stats.plans_with_failure) : null,
                };
              },
              (e: AppError) => {
                console.error(`Error fetching recovery stats: ${e.message}`);
                if (json) {
                  console.log(JSON.stringify({ status: "error", code: e.code, message: e.message }, null, 2));
                }
                process.exit(1);
              },
            );
          }
          console.log(JSON.stringify(result, null, 2));
                      } else {
                        if (out.length === 0) {
                          console.log(
                            "No agent metrics (no done/started events).",
                          );
                        } else {
                          console.log("Agent metrics (from event data):");
                          for (const row of out) {
                            const avg =
                              row.avg_seconds != null
                                ? `${Math.round(row.avg_seconds)}s`
                                : "—";
                            const review =
                              row.review_pass > 0 || row.review_fail > 0
                                ? `  review: ${row.review_pass} PASS, ${row.review_fail} FAIL`
                                : "";
                            console.log(
                              `  ${row.agent}  tasks_done: ${row.tasks_done}  avg_elapsed: ${avg}${review}`,
                            );
                          }
                        }

                        if (tokenUsage.length > 0) {
                          console.log("\nToken Usage (self-reported):");
                          for (const row of tokenUsage) {
                            console.log(
                              `  ${row.agent}  avg_tokens_in: ${row.avg_tokens_in ?? "N/A"}  avg_tokens_out: ${row.avg_tokens_out ?? "N/A"}  avg_tool_calls: ${row.avg_tool_calls ?? "N/A"}  total_in: ${row.total_tokens_in ?? "N/A"}  total_out: ${row.total_tokens_out ?? "N/A"}`,
                            );
                          }
                        }
                      }
                    },
                    (e: AppError) => {
                      console.error(`Error fetching token stats: ${e.message}`);
                      if (json)
                        console.log(
                          JSON.stringify({
                            status: "error",
                            code: e.code,
                            message: e.message,
                          }),
                        );
                      process.exit(1);
                    },
                  );
                },
                (e: AppError) => {
                  console.error(`Error fetching review stats: ${e.message}`);
                  if (json)
                    console.log(
                      JSON.stringify({
                        status: "error",
                        code: e.code,
                        message: e.message,
                      }),
                    );
                  process.exit(1);
                },
              );
            },
            (e: AppError) => {
              console.error(`Error fetching elapsed stats: ${e.message}`);
              if (json)
                console.log(
                  JSON.stringify({
                    status: "error",
                    code: e.code,
                    message: e.message,
                  }),
                );
              process.exit(1);
            },
          );
        },
        (e: AppError) => {
          console.error(`Error fetching tasks-done stats: ${e.message}`);
          if (json)
            console.log(
              JSON.stringify({
                status: "error",
                code: e.code,
                message: e.message,
              }),
            );
          process.exit(1);
        },
      );
    });
}
