import type { Command } from "commander";
import { sqlEscape } from "../db/escape";
import { query } from "../db/query";
import type { AppError } from "../domain/errors";
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

export function statsCommand(program: Command) {
  program
    .command("stats")
    .description(
      "Derive agent metrics from event data: tasks completed, review pass/fail counts, average elapsed time per task",
    )
    .option("--agent <name>", "Filter by agent name")
    .option("--plan <planId>", "Filter by plan ID or title")
    .action(async (options, cmd) => {
      const configResult = readConfig();
      if (configResult.isErr()) {
        console.error(configResult.error.message);
        process.exit(1);
      }
      const config = configResult.value;
      const json = rootOpts(cmd).json ?? false;
      const q = query(config.doltRepoPath);

      const agentFilter =
        options.agent != null && String(options.agent).trim() !== ""
          ? `AND agent = '${sqlEscape(String(options.agent).trim())}'`
          : "";

      const planFilterForDone =
        options.plan != null && String(options.plan).trim() !== ""
          ? (() => {
              const plan = sqlEscape(String(options.plan).trim());
              const isUUID =
                /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i.test(
                  options.plan,
                );
              const planCondition = isUUID
                ? `p.plan_id = '${plan}'`
                : `p.title = '${plan}'`;
              return `AND d.task_id IN (SELECT t.task_id FROM \`task\` t JOIN \`plan\` p ON t.plan_id = p.plan_id WHERE ${planCondition})`;
            })()
          : "";

      const tasksDoneSqlFinal = `
        SELECT agent, COUNT(*) AS tasks_done
        FROM event d
        JOIN (
          SELECT e.task_id, JSON_UNQUOTE(JSON_EXTRACT(e.body, '$.agent')) AS agent
          FROM event e
          WHERE e.kind = 'started'
          AND e.created_at = (SELECT MAX(e2.created_at) FROM event e2 WHERE e2.task_id = e.task_id AND e2.kind = 'started')
        ) s ON d.task_id = s.task_id
        WHERE d.kind = 'done'
        ${planFilterForDone}
        ${agentFilter}
        GROUP BY agent
        ORDER BY tasks_done DESC
      `;

      const elapsedSqlFinal = `
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
          ${planFilterForDone}
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

      const tasksResult = await q.raw<AgentRow>(tasksDoneSqlFinal);
      const elapsedResult = await q.raw<ElapsedRow>(elapsedSqlFinal);
      const reviewResult = await q.raw<ReviewRow>(reviewSql);

      tasksResult.match(
        (tasksRows) => {
          elapsedResult.match(
            (elapsedRows) => {
              reviewResult.match(
                (reviewRows) => {
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
                    else if (v === "FAIL") entry.review_fail += Number(r.cnt);
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

                  if (json) {
                    console.log(JSON.stringify(out, null, 2));
                  } else {
                    if (out.length === 0) {
                      console.log("No agent metrics (no done/started events).");
                      return;
                    }
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
                },
                (e: AppError) => {
                  console.error(`Error fetching review stats: ${e.message}`);
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
            },
            (e: AppError) => {
              console.error(`Error fetching elapsed stats: ${e.message}`);
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
        },
        (e: AppError) => {
          console.error(`Error fetching tasks-done stats: ${e.message}`);
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
    });
}
