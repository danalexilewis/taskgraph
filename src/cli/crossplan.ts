import type { Command } from "commander";
import {
  err,
  errAsync,
  ok,
  okAsync,
  type Result,
  ResultAsync,
} from "neverthrow";
import { doltCommit } from "../db/commit";
import { sqlEscape } from "../db/escape";
import { query } from "../db/query";
import { syncBlockedStatusForTask } from "../domain/blocked-status";
import type { AppError } from "../domain/errors";
import { checkNoBlockerCycle } from "../domain/invariants";
import type { Edge } from "../domain/types";
import { resolveInitiativeId } from "./status";
import { type Config, readConfig, rootOpts } from "./utils";

/** Parse plan file_tree into normalized file paths (no trailing slash, no (create)/(modify) suffix). */
export function parseFileTree(fileTree: string | null): string[] {
  if (!fileTree || typeof fileTree !== "string") return [];
  return fileTree
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.endsWith("/"))
    .map((l) => l.replace(/\s+\((?:create|modify)\)$/i, ""));
}

export function crossplanCommand(program: Command) {
  const crossplan = program
    .command("crossplan")
    .description(
      "Cross-project analysis: domains, skills, file overlaps, and proposed edges",
    )
    .option(
      "--initiative <id|title>",
      "Filter to projects under this initiative",
    );

  crossplan
    .command("domains")
    .description(
      "Show domains shared across multiple projects with task counts",
    )
    .option("--json", "Output as JSON")
    .action(async (options, cmd) => {
      const configResult = await readConfig();
      if (configResult.isErr()) {
        console.error(configResult.error.message);
        process.exit(1);
      }
      const config = configResult.value;
      const initiativeId = await getInitiativeId(config, cmd);
      const result = runDomains(
        config,
        rootOpts(cmd).json ?? options.json,
        initiativeId,
      );
      return outputResult(result, cmd, (data) => {
        if (rootOpts(cmd).json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          (
            data as {
              domain: string;
              plan_count: number;
              task_count: number;
              plan_titles: string[];
            }[]
          ).forEach((r) => {
            console.log(
              `${r.domain}: ${r.plan_count} plans, ${r.task_count} tasks`,
            );
            console.log(`  Plans: ${r.plan_titles.join(", ")}`);
          });
        }
      });
    });

  crossplan
    .command("skills")
    .description("Show skills shared across multiple projects with task counts")
    .option("--json", "Output as JSON")
    .action(async (options, cmd) => {
      const configResult = await readConfig();
      if (configResult.isErr()) {
        console.error(configResult.error.message);
        process.exit(1);
      }
      const config = configResult.value;
      const initiativeId = await getInitiativeId(config, cmd);
      const result = runSkills(
        config,
        rootOpts(cmd).json ?? options.json,
        initiativeId,
      );
      return outputResult(result, cmd, (data) => {
        if (rootOpts(cmd).json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          (
            data as {
              skill: string;
              plan_count: number;
              task_count: number;
              plan_titles: string[];
            }[]
          ).forEach((r) => {
            console.log(
              `${r.skill}: ${r.plan_count} projects, ${r.task_count} tasks`,
            );
            console.log(`  Projects: ${r.plan_titles.join(", ")}`);
          });
        }
      });
    });

  crossplan
    .command("files")
    .description(
      "Find files touched by multiple projects (from project file_tree)",
    )
    .option("--json", "Output as JSON")
    .action(async (options, cmd) => {
      const configResult = await readConfig();
      if (configResult.isErr()) {
        console.error(configResult.error.message);
        process.exit(1);
      }
      const config = configResult.value;
      const initiativeId = await getInitiativeId(config, cmd);
      const result = runFiles(
        config,
        rootOpts(cmd).json ?? options.json,
        initiativeId,
      );
      return outputResult(result, cmd, (data) => {
        if (rootOpts(cmd).json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          (
            data as {
              file: string;
              plan_count: number;
              plan_titles: string[];
            }[]
          ).forEach((r) => {
            console.log(`${r.file}: ${r.plan_count} projects`);
            console.log(`  Projects: ${r.plan_titles.join(", ")}`);
          });
        }
      });
    });

  crossplan
    .command("edges")
    .description(
      "Propose cross-project edges (blocks from file overlap, relates from domain overlap)",
    )
    .option("--dry-run", "Show proposals without writing to Dolt", false)
    .option("--json", "Output as JSON")
    .action(async (options, cmd) => {
      const dryRun = options.dryRun === true;
      const configResult = await readConfig();
      if (configResult.isErr()) {
        console.error(configResult.error.message);
        process.exit(1);
      }
      const config = configResult.value;
      const initiativeId = await getInitiativeId(config, cmd);
      const result = runEdges(
        config,
        dryRun,
        rootOpts(cmd).json ?? options.json,
        cmd,
        initiativeId,
      );
      return outputResult(result, cmd, (data) => {
        if (rootOpts(cmd).json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          const d = data as {
            proposed: {
              type: string;
              from_task_id: string;
              to_task_id: string;
              reason?: string;
            }[];
            added?: {
              from_task_id: string;
              to_task_id: string;
              type: string;
            }[];
          };
          console.log("Proposed edges:");
          d.proposed.forEach((e) => {
            console.log(
              `  ${e.type}: ${e.from_task_id} -> ${e.to_task_id}${e.reason ? ` (${e.reason})` : ""}`,
            );
          });
          if (d.added && d.added.length > 0) {
            console.log("Added to DB:");
            d.added.forEach((e) => {
              console.log(`  ${e.type}: ${e.from_task_id} -> ${e.to_task_id}`);
            });
          }
        }
      });
    });

  crossplan
    .command("plans")
    .description(
      "Summary of tasks by project: task counts per project (optionally by status)",
    )
    .option("--json", "Output as JSON")
    .action(async (options, cmd) => {
      const configResult = await readConfig();
      if (configResult.isErr()) {
        console.error(configResult.error.message);
        process.exit(1);
      }
      const config = configResult.value;
      const initiativeId = await getInitiativeId(config, cmd);
      const result = runPlans(
        config,
        rootOpts(cmd).json ?? options.json,
        initiativeId,
      );
      return outputResult(result, cmd, (data) => {
        if (rootOpts(cmd).json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          (
            data as {
              plan_id: string;
              title: string;
              status: string;
              task_count: number;
              todo: number;
              doing: number;
              blocked: number;
              done: number;
              canceled: number;
            }[]
          ).forEach((r) => {
            console.log(
              `${r.title} (${r.plan_id}): ${r.task_count} tasks [todo: ${r.todo}, doing: ${r.doing}, blocked: ${r.blocked}, done: ${r.done}, canceled: ${r.canceled}]`,
            );
          });
        }
      });
    });

  crossplan
    .command("summary")
    .description(
      "All cross-project analysis in one output: domains, skills, files, proposed edges",
    )
    .option("--json", "Output as JSON")
    .action(async (options, cmd) => {
      const configResult = await readConfig();
      if (configResult.isErr()) {
        console.error(configResult.error.message);
        process.exit(1);
      }
      const config = configResult.value;
      const initiativeId = await getInitiativeId(config, cmd);
      const result = runSummary(
        config,
        rootOpts(cmd).json ?? options.json,
        cmd,
        initiativeId,
      );
      return outputResult(result, cmd, (data) => {
        console.log(JSON.stringify(data, null, 2));
      });
    });
}

/** Get resolved initiative ID from parent command option, or undefined if not set. */
async function getInitiativeId(
  config: Config,
  cmd: Command,
): Promise<string | undefined> {
  const parentOpts = (
    cmd.parent && typeof (cmd.parent as Command).opts === "function"
      ? (cmd.parent as Command).opts()
      : {}
  ) as { initiative?: string };
  if (!parentOpts.initiative) return undefined;
  const result = await resolveInitiativeId(
    config.doltRepoPath,
    parentOpts.initiative,
  );
  let id: string | undefined;
  result.match(
    (v) => {
      id = v;
    },
    (e: AppError) => {
      console.error(e.message);
      process.exit(1);
    },
  );
  return id;
}

function outputResult<T>(
  result: ResultAsync<T, AppError>,
  cmd: Command,
  onOk: (data: T) => void,
): Promise<void> {
  return result.match(
    (data) => {
      onOk(data);
    },
    (error: AppError) => {
      console.error(`Error: ${error.message}`);
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
}

interface PlansRow {
  plan_id: string;
  title: string;
  status: string;
  task_count: number;
  todo: number;
  doing: number;
  blocked: number;
  done: number;
  canceled: number;
}

function runPlans(
  config: Config,
  _json: boolean,
  initiativeId?: string,
): ResultAsync<PlansRow[], AppError> {
  const q = query(config.doltRepoPath);
  const initiativeWhere = initiativeId
    ? ` AND p.initiative_id = '${sqlEscape(initiativeId)}' `
    : "";
  const sql = `
    SELECT
      p.plan_id,
      p.title,
      p.status,
      COUNT(t.task_id) AS task_count,
      SUM(CASE WHEN t.status = 'todo' THEN 1 ELSE 0 END) AS todo,
      SUM(CASE WHEN t.status = 'doing' THEN 1 ELSE 0 END) AS doing,
      SUM(CASE WHEN t.status = 'blocked' THEN 1 ELSE 0 END) AS blocked,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN t.status = 'canceled' THEN 1 ELSE 0 END) AS canceled
    FROM \`project\` p
    LEFT JOIN \`task\` t ON p.plan_id = t.plan_id
    WHERE p.status != 'abandoned' ${initiativeWhere}
    GROUP BY p.plan_id, p.title, p.status
    ORDER BY task_count DESC, p.title ASC
  `;
  return q.raw<PlansRow>(sql).map((rows) =>
    rows.map((r) => ({
      plan_id: r.plan_id,
      title: r.title,
      status: r.status,
      task_count: Number(r.task_count),
      todo: Number(r.todo),
      doing: Number(r.doing),
      blocked: Number(r.blocked),
      done: Number(r.done),
      canceled: Number(r.canceled),
    })),
  );
}

function runDomains(
  config: Config,
  _json: boolean,
  initiativeId?: string,
): ResultAsync<unknown, AppError> {
  const q = query(config.doltRepoPath);
  const initiativeWhere = initiativeId
    ? ` AND p.initiative_id = '${sqlEscape(initiativeId)}' `
    : "";
  const sql = `
    SELECT td.doc AS domain,
           COUNT(DISTINCT t.plan_id) AS plan_count,
           COUNT(DISTINCT t.task_id) AS task_count,
           GROUP_CONCAT(DISTINCT p.title ORDER BY p.title) AS plan_titles
    FROM \`task_doc\` td
    JOIN \`task\` t ON td.task_id = t.task_id
    JOIN \`project\` p ON t.plan_id = p.plan_id
    WHERE p.status != 'abandoned' ${initiativeWhere}
    GROUP BY td.doc
    HAVING plan_count > 1
    ORDER BY plan_count DESC, task_count DESC
  `;
  return q
    .raw<{
      domain: string;
      plan_count: number;
      task_count: number;
      plan_titles: string;
    }>(sql)
    .map((rows) =>
      rows.map((r) => ({
        domain: r.domain,
        plan_count: r.plan_count,
        task_count: r.task_count,
        plan_titles: (r.plan_titles ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      })),
    );
}

function runSkills(
  config: Config,
  _json: boolean,
  initiativeId?: string,
): ResultAsync<unknown, AppError> {
  const q = query(config.doltRepoPath);
  const initiativeWhere = initiativeId
    ? ` AND p.initiative_id = '${sqlEscape(initiativeId)}' `
    : "";
  const sql = `
    SELECT ts.skill,
           COUNT(DISTINCT t.plan_id) AS plan_count,
           COUNT(DISTINCT t.task_id) AS task_count,
           GROUP_CONCAT(DISTINCT p.title ORDER BY p.title) AS plan_titles
    FROM \`task_skill\` ts
    JOIN \`task\` t ON ts.task_id = t.task_id
    JOIN \`project\` p ON t.plan_id = p.plan_id
    WHERE p.status != 'abandoned' ${initiativeWhere}
    GROUP BY ts.skill
    HAVING plan_count > 1
    ORDER BY plan_count DESC, task_count DESC
  `;
  return q
    .raw<{
      skill: string;
      plan_count: number;
      task_count: number;
      plan_titles: string;
    }>(sql)
    .map((rows) =>
      rows.map((r) => ({
        skill: r.skill,
        plan_count: r.plan_count,
        task_count: r.task_count,
        plan_titles: (r.plan_titles ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      })),
    );
}

function runFiles(
  config: Config,
  _json: boolean,
  initiativeId?: string,
): ResultAsync<unknown, AppError> {
  const q = query(config.doltRepoPath);
  const initiativeWhere = initiativeId
    ? ` AND initiative_id = '${sqlEscape(initiativeId)}' `
    : "";
  return q
    .raw<{
      plan_id: string;
      title: string;
      file_tree: string | null;
    }>(
      `SELECT plan_id, title, file_tree FROM \`project\` WHERE status != 'abandoned' ${initiativeWhere}`,
    )
    .map((plans) => {
      const fileToPlans = new Map<
        string,
        { plan_count: number; plan_titles: string[] }
      >();
      for (const plan of plans) {
        const files = parseFileTree(plan.file_tree);
        const seen = new Set<string>();
        for (const f of files) {
          if (seen.has(f)) continue;
          seen.add(f);
          const cur = fileToPlans.get(f);
          if (!cur) {
            fileToPlans.set(f, { plan_count: 1, plan_titles: [plan.title] });
          } else {
            cur.plan_count += 1;
            cur.plan_titles.push(plan.title);
          }
        }
      }
      return Array.from(fileToPlans.entries())
        .filter(([, v]) => v.plan_count > 1)
        .map(([file, v]) => ({
          file,
          plan_count: v.plan_count,
          plan_titles: v.plan_titles,
        }))
        .sort((a, b) => b.plan_count - a.plan_count);
    });
}

interface ProposedEdge {
  type: "blocks" | "relates";
  from_task_id: string;
  to_task_id: string;
  reason?: string;
}

function runEdges(
  config: Config,
  dryRun: boolean,
  _json: boolean,
  cmd: Command,
  initiativeId?: string,
): ResultAsync<
  {
    proposed: ProposedEdge[];
    added: { from_task_id: string; to_task_id: string; type: string }[];
  },
  AppError
> {
  const q = query(config.doltRepoPath);
  const initiativeWhereP1P2 = initiativeId
    ? ` AND p1.initiative_id = '${sqlEscape(initiativeId)}' AND p2.initiative_id = '${sqlEscape(initiativeId)}' `
    : "";
  const projectWhereInitiative = initiativeId
    ? ` AND initiative_id = '${sqlEscape(initiativeId)}' `
    : "";
  return ResultAsync.fromPromise(
    (async (): Promise<
      Result<
        {
          proposed: ProposedEdge[];
          added: { from_task_id: string; to_task_id: string; type: string }[];
        },
        AppError
      >
    > => {
      const proposed: ProposedEdge[] = [];

      const domainSql = `
    SELECT td1.task_id AS from_id, td2.task_id AS to_id, td1.doc AS domain
    FROM \`task_doc\` td1
    JOIN \`task_doc\` td2 ON td1.doc = td2.doc AND td1.task_id < td2.task_id
    JOIN \`task\` t1 ON td1.task_id = t1.task_id
    JOIN \`task\` t2 ON td2.task_id = t2.task_id
    JOIN \`project\` p1 ON t1.plan_id = p1.plan_id
    JOIN \`project\` p2 ON t2.plan_id = p2.plan_id
    WHERE t1.plan_id != t2.plan_id
      AND p1.status != 'abandoned'
      AND p2.status != 'abandoned' ${initiativeWhereP1P2}
  `;
      const domainRows = await q.raw<{
        from_id: string;
        to_id: string;
        domain: string;
      }>(domainSql);
      if (domainRows.isErr()) return err(domainRows.error);
      for (const r of domainRows.value) {
        proposed.push({
          type: "relates",
          from_task_id: r.from_id,
          to_task_id: r.to_id,
          reason: `domain: ${r.domain}`,
        });
      }

      const planRows = await q.raw<{
        plan_id: string;
        title: string;
        file_tree: string | null;
      }>(
        `SELECT plan_id, title, file_tree FROM \`project\` WHERE status != 'abandoned' ${projectWhereInitiative}`,
      );
      if (planRows.isErr()) return err(planRows.error);
      const plans = planRows.value.filter((p) => p.file_tree);
      const fileToPlanIds = new Map<string, string[]>();
      for (const p of plans) {
        for (const f of parseFileTree(p.file_tree)) {
          const list = fileToPlanIds.get(f) ?? [];
          if (!list.includes(p.plan_id)) list.push(p.plan_id);
          fileToPlanIds.set(f, list);
        }
      }
      const taskByPlanRes = await q.raw<{ plan_id: string; task_id: string }>(
        plans.length > 0
          ? `SELECT plan_id, task_id FROM \`task\` WHERE plan_id IN (${plans.map((p) => `'${sqlEscape(p.plan_id)}'`).join(",")}) ORDER BY created_at ASC`
          : "SELECT plan_id, task_id FROM `task` WHERE 1=0",
      );
      if (taskByPlanRes.isErr()) return err(taskByPlanRes.error);
      const planToFirstTask = new Map<string, string>();
      for (const row of taskByPlanRes.value) {
        if (!planToFirstTask.has(row.plan_id))
          planToFirstTask.set(row.plan_id, row.task_id);
      }
      const seenBlocks = new Set<string>();
      for (const [, planIds] of fileToPlanIds) {
        if (planIds.length < 2) continue;
        for (let i = 0; i < planIds.length; i++) {
          for (let j = 0; j < planIds.length; j++) {
            if (i === j) continue;
            const fromPlan = planIds[i];
            const toPlan = planIds[j];
            const fromTask = planToFirstTask.get(fromPlan);
            const toTask = planToFirstTask.get(toPlan);
            if (!fromTask || !toTask) continue;
            const key = `${fromTask}:${toTask}`;
            if (seenBlocks.has(key)) continue;
            seenBlocks.add(key);
            proposed.push({
              type: "blocks",
              from_task_id: fromTask,
              to_task_id: toTask,
              reason: "file overlap",
            });
          }
        }
      }

      if (dryRun) {
        return ok({ proposed, added: [] });
      }

      const added: {
        from_task_id: string;
        to_task_id: string;
        type: string;
      }[] = [];
      const existingEdgesRes = await q.select<Edge>("edge", {
        where: { type: "blocks" },
      });
      if (existingEdgesRes.isErr()) return err(existingEdgesRes.error);
      const existingBlocks = [...existingEdgesRes.value];

      for (const edge of proposed) {
        if (edge.type === "blocks") {
          const cycleResult = checkNoBlockerCycle(
            edge.from_task_id,
            edge.to_task_id,
            existingBlocks,
          );
          if (cycleResult.isErr()) continue;
          const insertRes = await q.insert("edge", {
            from_task_id: edge.from_task_id,
            to_task_id: edge.to_task_id,
            type: edge.type,
            reason: edge.reason ?? null,
          });
          if (insertRes.isErr()) continue;
          const commitRes = await doltCommit(
            `crossplan: add blocks ${edge.from_task_id} -> ${edge.to_task_id}`,
            config.doltRepoPath,
            cmd.parent?.opts?.()?.noCommit ?? false,
          );
          if (commitRes.isOk()) {
            existingBlocks.push({
              from_task_id: edge.from_task_id,
              to_task_id: edge.to_task_id,
              type: "blocks",
              reason: edge.reason ?? null,
            });
            added.push({
              from_task_id: edge.from_task_id,
              to_task_id: edge.to_task_id,
              type: edge.type,
            });
            await syncBlockedStatusForTask(
              config.doltRepoPath,
              edge.to_task_id,
            ).match(
              () => {},
              (err) =>
                console.error(
                  `syncBlockedStatusForTask(${edge.to_task_id}):`,
                  err.message,
                ),
            );
          }
        } else {
          const insertRes = await q.insert("edge", {
            from_task_id: edge.from_task_id,
            to_task_id: edge.to_task_id,
            type: edge.type,
            reason: edge.reason ?? null,
          });
          if (insertRes.isErr()) continue;
          const commitRes = await doltCommit(
            `crossplan: add relates ${edge.from_task_id} -> ${edge.to_task_id}`,
            config.doltRepoPath,
            cmd.parent?.opts?.()?.noCommit ?? false,
          );
          if (commitRes.isOk()) {
            added.push({
              from_task_id: edge.from_task_id,
              to_task_id: edge.to_task_id,
              type: edge.type,
            });
          }
        }
      }

      return ok({ proposed, added });
    })(),
    (e) => e as AppError,
  ).andThen((res) => (res.isOk() ? okAsync(res.value) : errAsync(res.error)));
}

function runSummary(
  config: Config,
  _json: boolean,
  cmd: Command,
  initiativeId?: string,
): ResultAsync<unknown, AppError> {
  const q = query(config.doltRepoPath);
  const projectWhereInitiative = initiativeId
    ? ` AND initiative_id = '${sqlEscape(initiativeId)}' `
    : "";
  return ResultAsync.fromPromise(
    (async (): Promise<Result<unknown, AppError>> => {
      const [domainsRes, skillsRes, plansRes] = await Promise.all([
        runDomains(config, true, initiativeId),
        runSkills(config, true, initiativeId),
        q.raw<{ plan_id: string; title: string; file_tree: string | null }>(
          `SELECT plan_id, title, file_tree FROM \`project\` WHERE status != 'abandoned' ${projectWhereInitiative}`,
        ),
      ]);
      const domains = domainsRes.isOk() ? domainsRes.value : [];
      const skills = skillsRes.isOk() ? skillsRes.value : [];
      const plans = plansRes.isOk() ? plansRes.value : [];
      const fileToPlans = new Map<string, string[]>();
      for (const plan of plans) {
        for (const f of parseFileTree(plan.file_tree)) {
          const list = fileToPlans.get(f) ?? [];
          if (!list.includes(plan.title)) list.push(plan.title);
          fileToPlans.set(f, list);
        }
      }
      const files = Array.from(fileToPlans.entries())
        .filter(([, titles]) => titles.length > 1)
        .map(([file, plan_titles]) => ({
          file,
          plan_count: plan_titles.length,
          plan_titles,
        }));

      const edgesRes = await runEdges(config, true, true, cmd, initiativeId);
      const edges = edgesRes.isOk()
        ? (edgesRes.value as { proposed: ProposedEdge[] }).proposed
        : [];

      return ok({
        domains,
        skills,
        files,
        proposed_edges: edges,
      });
    })(),
    (e) => e as AppError,
  ).andThen((res) => (res.isOk() ? okAsync(res.value) : errAsync(res.error)));
}
