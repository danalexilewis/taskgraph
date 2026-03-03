import { errAsync, ok, okAsync, ResultAsync } from "neverthrow";
import { recoverStaleTasks } from "../cli/recover";
import type { StatusOptions } from "../cli/status";
import { fetchStatusData } from "../cli/status";
import { getStatusCache, statusCacheTtlMs } from "../cli/status-cache";
import { resolveTaskId, resolveTaskIdsBatch } from "../cli/utils";
import type { Config } from "../config";
import { readConfig } from "../config";
import { sqlEscape } from "../db/escape";
import { cachedQuery, query } from "../db/query";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import {
  type ContextOutput,
  compactContext,
  estimateJsonTokens,
} from "../domain/token-estimate";
import type { ContextResult, NextTaskRow, StatusResult } from "./types";

export type ContextBatchResult = Record<
  string,
  ContextResult | { error: string }
>;

async function runContextChainBatch(
  config: Config,
  taskIds: string[],
): Promise<ContextBatchResult> {
  const result: ContextBatchResult = {};
  if (taskIds.length === 0) return result;

  const resolveResult = await resolveTaskIdsBatch(taskIds, config.doltRepoPath);
  if (resolveResult.isErr()) {
    for (const id of taskIds) {
      result[id] = { error: resolveResult.error.message };
    }
    return result;
  }

  const { resolved, errors } = resolveResult.value;
  for (const [inputId, msg] of errors) {
    result[inputId] = { error: msg };
  }
  if (resolved.length === 0) return result;

  const q = query(config.doltRepoPath);
  const resolvedTaskIds = [...new Set(resolved.map((r) => r.taskId))];
  const taskIdList = resolvedTaskIds.map((id) => `'${sqlEscape(id)}'`).join(",");

  type TaskRow = {
    task_id: string;
    title: string;
    change_type: string | null;
    plan_id: string;
    suggested_changes: string | null;
    agent: string | null;
  };
  const taskRowsResult = await q.raw<TaskRow>(
    `SELECT task_id, title, \`change_type\`, plan_id, suggested_changes, agent FROM \`task\` WHERE task_id IN (${taskIdList})`,
  );
  if (taskRowsResult.isErr()) {
    for (const id of taskIds) {
      if (result[id] == null) result[id] = { error: taskRowsResult.error.message };
    }
    return result;
  }

  const taskRows = taskRowsResult.value;
  const taskIdToTask = new Map(taskRows.map((t) => [t.task_id, t]));
  for (const { inputId, taskId } of resolved) {
    if (!taskIdToTask.has(taskId)) {
      result[inputId] = { error: "Task not found" };
    }
  }

  const validResolved = resolved.filter((r) => taskIdToTask.has(r.taskId));
  if (validResolved.length === 0) return result;

  const planIds = [...new Set(taskRows.map((t) => t.plan_id))];
  const planIdList = planIds.map((id) => `'${sqlEscape(id)}'`).join(",");

  type PlanRow = {
    plan_id: string;
    title: string | null;
    overview: string | null;
    file_tree: string | null;
    risks: string | null;
  };
  const planRowsResult = await q.raw<PlanRow>(
    `SELECT plan_id, title, overview, file_tree, risks FROM \`project\` WHERE plan_id IN (${planIdList})`,
  );
  if (planRowsResult.isErr()) {
    for (const id of taskIds) {
      if (result[id] == null) result[id] = { error: planRowsResult.error.message };
    }
    return result;
  }
  const planIdToPlan = new Map(planRowsResult.value.map((p) => [p.plan_id, p]));

  const docRowsResult = await q.raw<{ task_id: string; doc: string }>(
    `SELECT task_id, doc FROM \`task_doc\` WHERE task_id IN (${taskIdList})`,
  );
  const docRows = docRowsResult.isErr() ? [] : docRowsResult.value;
  const taskIdToDocs = new Map<string, string[]>();
  for (const r of docRows) {
    const arr = taskIdToDocs.get(r.task_id) ?? [];
    arr.push(r.doc);
    taskIdToDocs.set(r.task_id, arr);
  }

  const skillRowsResult = await q.raw<{ task_id: string; skill: string }>(
    `SELECT task_id, skill FROM \`task_skill\` WHERE task_id IN (${taskIdList})`,
  );
  const skillRows = skillRowsResult.isErr() ? [] : skillRowsResult.value;
  const taskIdToSkills = new Map<string, string[]>();
  for (const r of skillRows) {
    const arr = taskIdToSkills.get(r.task_id) ?? [];
    arr.push(r.skill);
    taskIdToSkills.set(r.task_id, arr);
  }

  type BlockerRow = {
    to_task_id: string;
    from_task_id: string;
    title: string;
    status: string;
  };
  const blockerRowsResult = await q.raw<BlockerRow>(
    `SELECT e.to_task_id, e.from_task_id, t.title, t.status FROM \`edge\` e JOIN \`task\` t ON e.from_task_id = t.task_id WHERE e.to_task_id IN (${taskIdList}) AND e.type = 'blocks'`,
  );
  const blockerRows = blockerRowsResult.isErr() ? [] : blockerRowsResult.value;
  const taskIdToBlockers = new Map<string, BlockerRow[]>();
  for (const b of blockerRows) {
    const arr = taskIdToBlockers.get(b.to_task_id) ?? [];
    arr.push(b);
    taskIdToBlockers.set(b.to_task_id, arr);
  }

  const doneBlockerIds = [
    ...new Set(
      blockerRows.filter((b) => b.status === "done").map((b) => b.from_task_id)),
  ];
  let evidenceByTaskId = new Map<string, string>();
  if (doneBlockerIds.length > 0) {
    const evidenceIdList = doneBlockerIds
      .map((id) => `'${sqlEscape(id)}'`)
      .join(",");
    const evidenceRowsResult = await q.raw<{
      task_id: string;
      body: string | object;
    }>(
      `SELECT task_id, body FROM \`event\` WHERE kind = 'done' AND task_id IN (${evidenceIdList}) ORDER BY created_at DESC`,
    );
    if (evidenceRowsResult.isOk()) {
      for (const ev of evidenceRowsResult.value) {
        if (!evidenceByTaskId.has(ev.task_id)) {
          try {
            const raw = ev.body;
            const parsed = (
              typeof raw === "string" ? JSON.parse(raw) : raw
            ) as { evidence?: string };
            evidenceByTaskId.set(ev.task_id, parsed.evidence ?? "");
          } catch {
            evidenceByTaskId.set(ev.task_id, "");
          }
        }
      }
    }
  }

  const budget = config.context_token_budget ?? null;

  for (const { inputId, taskId } of validResolved) {
    const task = taskIdToTask.get(taskId)!;
    const plan = planIdToPlan.get(task.plan_id);
    const plan_name = plan?.title ?? null;
    const plan_overview = plan?.overview ?? null;
    const file_tree = plan?.file_tree ?? null;
    let risks: unknown = null;
    if (plan?.risks != null && typeof plan.risks === "string") {
      try {
        risks = JSON.parse(plan.risks);
      } catch {
        risks = null;
      }
    }
    const docs = taskIdToDocs.get(taskId) ?? [];
    const skills = taskIdToSkills.get(taskId) ?? [];
    const doc_paths = docs.map((d) => `docs/${d}.md`);
    const skill_docs = skills.map((s) => `docs/skills/${s}.md`);
    const blockers = taskIdToBlockers.get(taskId) ?? [];
    const immediate_blockers = blockers.map((b) => ({
      task_id: b.from_task_id,
      title: b.title,
      status: b.status,
      evidence: evidenceByTaskId.get(b.from_task_id) ?? null,
    }));
    const data: ContextOutput = {
      task_id: task.task_id,
      title: task.title,
      agent: task.agent ?? null,
      plan_name,
      plan_overview,
      docs,
      skills,
      change_type: task.change_type ?? null,
      suggested_changes: task.suggested_changes ?? null,
      file_tree,
      risks,
      doc_paths,
      skill_docs,
      immediate_blockers,
    };
    const finalData =
      budget != null &&
      budget > 0 &&
      estimateJsonTokens(data) > budget
        ? compactContext(data, budget)
        : data;
    const contextResult: ContextResult = {
      ...finalData,
      token_estimate: estimateJsonTokens(finalData),
    };
    result[inputId] = contextResult;
  }

  return result;
}

function runContextChain(
  config: Config,
  taskId: string,
): ResultAsync<ContextResult, AppError> {
  const q = cachedQuery(
    config.doltRepoPath,
    getStatusCache(),
    statusCacheTtlMs,
  );

  return resolveTaskId(taskId, config.doltRepoPath)
    .andThen((taskIdResolved) =>
      q
        .select<{
          task_id: string;
          title: string;
          change_type: string | null;
          plan_id: string;
          suggested_changes: string | null;
          agent: string | null;
        }>("task", {
          columns: [
            "task_id",
            "title",
            "change_type",
            "plan_id",
            "suggested_changes",
            "agent",
          ],
          where: { task_id: taskIdResolved },
        })
        .andThen((taskRows) => {
          if (taskRows.length === 0) {
            return errAsync(
              buildError(ErrorCode.TASK_NOT_FOUND, `Task ${taskId} not found`),
            );
          }
          const task = taskRows[0];
          return q
            .select<{
              title: string | null;
              overview: string | null;
              file_tree: string | null;
              risks: string | null;
            }>("project", {
              columns: ["title", "overview", "file_tree", "risks"],
              where: { plan_id: task.plan_id },
            })
            .andThen((planRows) => {
              const plan = planRows[0];
              const plan_name = plan?.title ?? null;
              const plan_overview = plan?.overview ?? null;
              const file_tree = plan?.file_tree ?? null;
              let risks: unknown = null;
              if (plan?.risks != null && typeof plan.risks === "string") {
                try {
                  risks = JSON.parse(plan.risks);
                } catch {
                  risks = null;
                }
              }

              return q
                .select<{ doc: string }>("task_doc", {
                  columns: ["doc"],
                  where: { task_id: taskIdResolved },
                })
                .andThen((docRows) =>
                  q
                    .select<{ skill: string }>("task_skill", {
                      columns: ["skill"],
                      where: { task_id: taskIdResolved },
                    })
                    .andThen((skillRows) => {
                      const docs = docRows.map((r) => r.doc);
                      const skills = skillRows.map((r) => r.skill);
                      const doc_paths = docs.map((d) => `docs/${d}.md`);
                      const skill_docs = skills.map((s) => `docs/skills/${s}.md`);

                      return q
                        .raw<{
                          task_id: string;
                          title: string;
                          status: string;
                        }>(
                          `SELECT e.from_task_id AS task_id, t.title, t.status FROM \`edge\` e JOIN \`task\` t ON e.from_task_id = t.task_id WHERE e.to_task_id = '${sqlEscape(taskIdResolved)}' AND e.type = 'blocks'`,
                        )
                        .andThen((blockerRows) => {
                          const doneBlockerIds = blockerRows
                            .filter((b) => b.status === "done")
                            .map((b) => b.task_id);

                          if (doneBlockerIds.length === 0) {
                            const evidenceByTaskId = new Map<string, string>();
                            const immediate_blockers = blockerRows.map((b) => ({
                              task_id: b.task_id,
                              title: b.title,
                              status: b.status,
                              evidence: evidenceByTaskId.get(b.task_id) ?? null,
                            }));
                            const data: ContextOutput = {
                              task_id: task.task_id,
                              title: task.title,
                              agent: task.agent ?? null,
                              plan_name,
                              plan_overview,
                              docs,
                              skills,
                              change_type: task.change_type ?? null,
                              suggested_changes: task.suggested_changes ?? null,
                              file_tree,
                              risks,
                              doc_paths,
                              skill_docs,
                              immediate_blockers,
                            };
                            const budget = config.context_token_budget;
                            const finalData =
                              budget != null &&
                              budget > 0 &&
                              estimateJsonTokens(data) > budget
                                ? compactContext(data, budget)
                                : data;
                            return okAsync({
                              ...finalData,
                              token_estimate: estimateJsonTokens(finalData),
                            });
                          }

                          return q
                            .raw<{ task_id: string; body: string }>(
                              `SELECT task_id, body FROM \`event\` WHERE kind = 'done' AND task_id IN (${doneBlockerIds.map((id) => `'${sqlEscape(id)}'`).join(",")}) ORDER BY created_at DESC`,
                            )
                            .map((evidenceRows) => {
                              const evidenceByTaskId = new Map<string, string>();
                              for (const ev of evidenceRows) {
                                if (!evidenceByTaskId.has(ev.task_id)) {
                                  try {
                                    const parsed = JSON.parse(ev.body) as {
                                      evidence?: string;
                                    };
                                    evidenceByTaskId.set(
                                      ev.task_id,
                                      parsed.evidence ?? "",
                                    );
                                  } catch {
                                    evidenceByTaskId.set(ev.task_id, "");
                                  }
                                }
                              }
                              const immediate_blockers = blockerRows.map((b) => ({
                                task_id: b.task_id,
                                title: b.title,
                                status: b.status,
                                evidence:
                                  evidenceByTaskId.get(b.task_id) ?? null,
                              }));
                              const data: ContextOutput = {
                                task_id: task.task_id,
                                title: task.title,
                                agent: task.agent ?? null,
                                plan_name,
                                plan_overview,
                                docs,
                                skills,
                                change_type: task.change_type ?? null,
                                suggested_changes: task.suggested_changes ?? null,
                                file_tree,
                                risks,
                                doc_paths,
                                skill_docs,
                                immediate_blockers,
                              };
                              const budget = config.context_token_budget;
                              const finalData =
                                budget != null &&
                                budget > 0 &&
                                estimateJsonTokens(data) > budget
                                  ? compactContext(data, budget)
                                  : data;
                              return {
                                ...finalData,
                                token_estimate: estimateJsonTokens(finalData),
                              };
                            });
                        });
                    }),
                );
            });
        }),
    );
}

export interface NextOptions {
  plan?: string;
  limit?: number;
  domain?: string;
  skill?: string;
  changeType?: string;
  all?: boolean;
}

export interface TgClientOptions {
  /** Working directory for resolving .taskgraph/config.json. Defaults to process.cwd(). */
  cwd?: string;
  /** When set (e.g. from MCP), config is not read; cwd is ignored. */
  doltRepoPath?: string;
}

/**
 * Programmatic client for task graph operations. Use this instead of spawning
 * the CLI when you need next, context, or status from scripts or agents.
 * Optional cwd: repository root for config and Dolt (defaults to process.cwd()).
 * Optional doltRepoPath: use when you already have a repo path (e.g. MCP server).
 */
export class TgClient {
  private readonly cwd: string;
  private readonly doltRepoPath: string | undefined;

  constructor(options?: TgClientOptions | string) {
    if (typeof options === "string") {
      this.cwd = options;
      this.doltRepoPath = undefined;
    } else if (options?.doltRepoPath != null) {
      this.cwd = options.cwd ?? process.cwd();
      this.doltRepoPath = options.doltRepoPath;
    } else {
      this.cwd = options?.cwd ?? process.cwd();
      this.doltRepoPath = undefined;
    }
  }

  /**
   * Read config from repo (same as CLI). Uses this client's cwd when set.
   * When doltRepoPath was passed to the constructor, returns a minimal config with that path.
   */
  readConfig(): ReturnType<typeof readConfig> {
    if (this.doltRepoPath != null) {
      return ok({ doltRepoPath: this.doltRepoPath } as Config);
    }
    return readConfig(this.cwd);
  }

  /**
   * Return runnable tasks (same as tg next --json).
   * Runs stale-task recovery before fetching.
   */
  next(options: NextOptions = {}): ResultAsync<NextTaskRow[], AppError> {
    const configResult = this.readConfig();
    if (configResult.isErr()) return errAsync(configResult.error);

    const config = configResult.value;
    const q = cachedQuery(
      config.doltRepoPath,
      getStatusCache(),
      statusCacheTtlMs,
    );

    return recoverStaleTasks(config.doltRepoPath, 2).andThen(() => {
      const limit = Math.max(1, options.limit ?? 10);
      let planFilter = "";
      if (options.plan) {
        const isUUID =
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
            options.plan,
          );
        planFilter = isUUID
          ? `AND p.plan_id = '${sqlEscape(options.plan)}'`
          : `AND p.title = '${sqlEscape(options.plan)}'`;
      }
      let domainFilter = "";
      if (options.domain) {
        domainFilter = `AND EXISTS (SELECT 1 FROM \`task_doc\` td WHERE td.task_id = t.task_id AND td.doc = '${sqlEscape(options.domain)}')`;
      }
      let skillFilter = "";
      if (options.skill) {
        skillFilter = `AND EXISTS (SELECT 1 FROM \`task_skill\` ts WHERE ts.task_id = t.task_id AND ts.skill = '${sqlEscape(options.skill)}')`;
      }
      let changeTypeFilter = "";
      if (options.changeType) {
        changeTypeFilter = `AND t.\`change_type\` = '${sqlEscape(options.changeType)}'`;
      }
      const excludeCanceledAbandoned = options.all
        ? ""
        : " AND t.status != 'canceled' AND p.status != 'abandoned' ";

      const sql = `
      SELECT t.task_id, t.hash_id, t.title, p.title as plan_title, t.risk, t.estimate_mins,
        (SELECT COUNT(*) FROM \`edge\` e
         JOIN \`task\` bt ON e.from_task_id = bt.task_id
         WHERE e.to_task_id = t.task_id AND e.type = 'blocks'
         AND bt.status NOT IN ('done','canceled')) as unmet_blockers
      FROM \`task\` t
      JOIN \`project\` p ON t.plan_id = p.plan_id
      WHERE t.status = 'todo'
      ${planFilter}
      ${domainFilter}
      ${skillFilter}
      ${changeTypeFilter}
      ${excludeCanceledAbandoned}
      HAVING unmet_blockers = 0
      ORDER BY p.priority ASC, t.risk ASC,
        CASE WHEN t.estimate_mins IS NULL THEN 1 ELSE 0 END,
        t.estimate_mins ASC, t.created_at ASC
      LIMIT ${limit}
      `;
      return q.raw<NextTaskRow>(sql);
    });
  }

  /**
   * Return context for a task (same as tg context <taskId> --json).
   * Applies token budget compaction when config.context_token_budget is set.
   */
  context(taskId: string): ResultAsync<ContextResult, AppError> {
    const configResult = this.readConfig();
    if (configResult.isErr()) return errAsync(configResult.error);
    const config = configResult.value;
    return runContextChain(config, taskId);
  }

  /**
   * Return context for multiple tasks in one call (batched SQL).
   * Keys are input task IDs (UUID or hash_id); values are ContextResult or { error: string }.
   * Applies token budget compaction per task when config.context_token_budget is set.
   */
  contextBatch(taskIds: string[]): ResultAsync<ContextBatchResult, AppError> {
    const configResult = this.readConfig();
    if (configResult.isErr()) return errAsync(configResult.error);
    const config = configResult.value;
    return ResultAsync.fromPromise(
      runContextChainBatch(config, taskIds),
      (e) =>
        buildError(
          ErrorCode.UNKNOWN_ERROR,
          e instanceof Error ? e.message : String(e),
          e instanceof Error ? e : undefined,
        ),
    );
  }

  /**
   * Return status overview (same as tg status --json).
   */
  status(options: StatusOptions = {}): ResultAsync<StatusResult, AppError> {
    const configResult = this.readConfig();
    if (configResult.isErr()) return errAsync(configResult.error);
    const config = configResult.value;

    return fetchStatusData(config, options).map((d) => {
      const todo = d.statusCounts.todo ?? 0;
      const doing = d.statusCounts.doing ?? 0;
      const blocked = d.statusCounts.blocked ?? 0;
      return {
        completedPlans: d.completedPlans,
        completedTasks: d.completedTasks,
        canceledTasks: d.canceledTasks,
        activePlans: d.activePlans,
        staleTasks: d.staleTasks,
        stale_tasks: d.staleDoingTasks,
        plansCount: d.plansCount,
        statusCounts: d.statusCounts,
        actionableCount: d.actionableCount,
        nextTasks: d.nextTasks,
        next7RunnableTasks: d.next7RunnableTasks,
        last7CompletedTasks: d.last7CompletedTasks,
        next7UpcomingPlans: d.next7UpcomingPlans,
        last7CompletedPlans: d.last7CompletedPlans,
        activeWork: d.activeWork,
        agentCount: d.agentCount,
        subAgentRuns: d.subAgentRuns,
        totalAgentHours: d.totalAgentHours,
        investigatorRuns: d.investigatorRuns,
        investigatorFixRate: d.investigatorFixRate,
        subAgentTypesDefined: d.subAgentTypesDefined,
        summary: {
          not_done: todo + doing + blocked,
          in_progress: doing,
          blocked,
          actionable: d.actionableCount,
        },
      } satisfies StatusResult;
    });
  }
}
