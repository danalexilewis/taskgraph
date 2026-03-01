import { err, ok, ResultAsync } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { startOne } from "../cli/start.js";
import { fetchStatusData } from "../cli/status.js";
import type { Config } from "../cli/utils.js";
import { getStartedEventBranch, resolveTaskId } from "../cli/utils.js";
import { mergeAgentBranchIntoMain } from "../db/branch.js";
import { doltCommit } from "../db/commit.js";
import { sqlEscape } from "../db/escape.js";
import { type JsonValue, jsonObj, now, query } from "../db/query.js";
import { syncBlockedStatusForTask } from "../domain/blocked-status.js";
import { type AppError, buildError, ErrorCode } from "../domain/errors.js";
import {
  checkNoBlockerCycle,
  checkValidTransition,
} from "../domain/invariants.js";
import { autoCompletePlanIfDone } from "../domain/plan-completion.js";
import {
  type ContextOutput,
  compactContext,
  estimateJsonTokens,
} from "../domain/token-estimate.js";
import type { Edge, Event, Task } from "../domain/types.js";
import type { McpServer } from "./sdk-loader.js";

function toToolResult(data: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function toToolError(err: AppError): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          status: "error",
          code: err.code,
          message: err.message,
        }),
      },
    ],
    isError: true,
  };
}

async function runStatus(
  doltRepoPath: string,
  plan?: string,
): Promise<ReturnType<typeof toToolResult> | ReturnType<typeof toToolError>> {
  const config = { doltRepoPath } as Config;
  const result = await fetchStatusData(config, { plan });
  if (result.isErr()) return toToolError(result.error);
  const d = result.value;
  const summary = {
    completedPlans: d.completedPlans,
    completedTasks: d.completedTasks,
    canceledTasks: d.canceledTasks,
    activePlans: d.activePlans,
    staleTasks: d.staleTasks,
    plansCount: d.plansCount,
    statusCounts: d.statusCounts,
    actionableCount: d.actionableCount,
    nextTasks: d.nextTasks,
    next7RunnableTasks: d.next7RunnableTasks,
    last7CompletedTasks: d.last7CompletedTasks,
    next7UpcomingPlans: d.next7UpcomingPlans,
    last7CompletedPlans: d.last7CompletedPlans,
    activeWork: d.activeWork,
    summary: {
      not_done:
        (d.statusCounts.todo ?? 0) +
        (d.statusCounts.doing ?? 0) +
        (d.statusCounts.blocked ?? 0),
      in_progress: d.statusCounts.doing ?? 0,
      blocked: d.statusCounts.blocked ?? 0,
      actionable: d.actionableCount,
    },
  };
  return toToolResult(summary);
}

async function runContext(
  doltRepoPath: string,
  taskId: string,
): Promise<ReturnType<typeof toToolResult> | ReturnType<typeof toToolError>> {
  const resolved = await resolveTaskId(taskId, doltRepoPath);
  if (resolved.isErr()) return toToolError(resolved.error);
  const taskIdResolved = resolved.value;
  const q = query(doltRepoPath);

  type TaskRow = {
    task_id: string;
    title: string;
    change_type: string | null;
    plan_id: string;
    suggested_changes: string | null;
    agent: string | null;
  };
  const taskRows = await q.select<TaskRow>("task", {
    columns: [
      "task_id",
      "title",
      "change_type",
      "plan_id",
      "suggested_changes",
      "agent",
    ],
    where: { task_id: taskIdResolved },
  });
  if (taskRows.isErr()) return toToolError(taskRows.error);
  if (taskRows.value.length === 0)
    return toToolError(
      buildError(ErrorCode.TASK_NOT_FOUND, `Task ${taskId} not found`),
    );
  const task = taskRows.value[0];

  const planRows = await q.select<{
    file_tree: string | null;
    risks: string | null;
  }>("project", {
    columns: ["file_tree", "risks"],
    where: { plan_id: task.plan_id },
  });
  if (planRows.isErr()) return toToolError(planRows.error);
  const plan = planRows.value[0];
  const file_tree = plan?.file_tree ?? null;
  let risks: unknown = null;
  if (plan?.risks != null && typeof plan.risks === "string") {
    try {
      risks = JSON.parse(plan.risks);
    } catch {
      risks = null;
    }
  }

  const docRows = await q.select<{ doc: string }>("task_doc", {
    columns: ["doc"],
    where: { task_id: taskIdResolved },
  });
  if (docRows.isErr()) return toToolError(docRows.error);
  const docs = docRows.value.map((r: { doc: string }) => r.doc);

  const skillRows = await q.select<{ skill: string }>("task_skill", {
    columns: ["skill"],
    where: { task_id: taskIdResolved },
  });
  if (skillRows.isErr()) return toToolError(skillRows.error);
  const skills = skillRows.value.map((r: { skill: string }) => r.skill);

  const doc_paths = docs.map((d: string) => `docs/${d}.md`);
  const skill_docs = skills.map((s: string) => `docs/skills/${s}.md`);

  const relatedByDocSql =
    docs.length > 0
      ? `SELECT DISTINCT t.task_id, t.title, t.plan_id FROM \`task\` t JOIN \`task_doc\` td ON t.task_id = td.task_id WHERE t.status = 'done' AND t.task_id != '${sqlEscape(taskIdResolved)}' AND td.doc IN (${docs.map((d: string) => `'${sqlEscape(d)}'`).join(",")}) ORDER BY t.updated_at DESC LIMIT 5`
      : null;
  const relatedBySkillSql =
    skills.length > 0
      ? `SELECT DISTINCT t.task_id, t.title, t.plan_id FROM \`task\` t JOIN \`task_skill\` ts ON t.task_id = ts.task_id WHERE t.status = 'done' AND t.task_id != '${sqlEscape(taskIdResolved)}' AND ts.skill IN (${skills.map((s: string) => `'${sqlEscape(s)}'`).join(",")}) ORDER BY t.updated_at DESC LIMIT 5`
      : null;

  const runDoc = relatedByDocSql
    ? q.raw<{ task_id: string; title: string; plan_id: string }>(
        relatedByDocSql,
      )
    : ResultAsync.fromSafePromise(Promise.resolve([]));
  const runSkill = relatedBySkillSql
    ? q.raw<{ task_id: string; title: string; plan_id: string }>(
        relatedBySkillSql,
      )
    : ResultAsync.fromSafePromise(Promise.resolve([]));

  const relatedResult = await runDoc.andThen((relatedByDoc) =>
    runSkill.map((relatedBySkill) => ({ relatedByDoc, relatedBySkill })),
  );
  if (relatedResult.isErr()) return toToolError(relatedResult.error);
  const { relatedByDoc, relatedBySkill } = relatedResult.value;

  const data: ContextOutput = {
    task_id: task.task_id,
    title: task.title,
    agent: task.agent ?? null,
    docs,
    skills,
    change_type: task.change_type ?? null,
    suggested_changes: task.suggested_changes ?? null,
    file_tree,
    risks,
    doc_paths,
    skill_docs,
    related_done_by_doc: relatedByDoc,
    related_done_by_skill: relatedBySkill,
  };
  const budget = undefined;
  const out =
    budget != null && budget > 0 && estimateJsonTokens(data) > budget
      ? compactContext(data, budget)
      : data;
  const token_estimate = estimateJsonTokens(out);
  return toToolResult({ ...out, token_estimate });
}

async function runNext(
  doltRepoPath: string,
  planId?: string,
  limit = 10,
): Promise<ReturnType<typeof toToolResult> | ReturnType<typeof toToolError>> {
  const q = query(doltRepoPath);
  let planFilter = "";
  if (planId) {
    const isUUID =
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
        planId,
      );
    planFilter = isUUID
      ? `AND p.plan_id = '${sqlEscape(planId)}'`
      : `AND p.title = '${sqlEscape(planId)}'`;
  }
  const excludeCanceledAbandoned =
    " AND t.status != 'canceled' AND p.status != 'abandoned' ";
  const nextTasksQuery = `
    SELECT t.task_id, t.hash_id, t.title, p.title as plan_title, t.risk, t.estimate_mins,
      (SELECT COUNT(*) FROM \`edge\` e 
       JOIN \`task\` bt ON e.from_task_id = bt.task_id 
       WHERE e.to_task_id = t.task_id AND e.type = 'blocks' 
       AND bt.status NOT IN ('done','canceled')) as unmet_blockers
    FROM \`task\` t
    JOIN \`project\` p ON t.plan_id = p.plan_id
    WHERE t.status = 'todo'
    ${planFilter}
    ${excludeCanceledAbandoned}
    HAVING unmet_blockers = 0
    ORDER BY p.priority DESC, t.risk ASC, 
      CASE WHEN t.estimate_mins IS NULL THEN 1 ELSE 0 END,
      t.estimate_mins ASC, t.created_at ASC
    LIMIT ${limit}
  `;
  const result = await q.raw(nextTasksQuery);
  if (result.isErr()) return toToolError(result.error);
  return toToolResult(result.value);
}

interface BlockerDetails extends Edge {
  title: string;
  status: Task["status"];
}
interface DependentDetails extends Edge {
  title: string;
  status: Task["status"];
}

async function runShow(
  doltRepoPath: string,
  taskId: string,
): Promise<ReturnType<typeof toToolResult> | ReturnType<typeof toToolError>> {
  const resolved = await resolveTaskId(taskId, doltRepoPath);
  if (resolved.isErr()) return toToolError(resolved.error);
  const taskIdResolved = resolved.value;
  const q = query(doltRepoPath);
  const escaped = sqlEscape(taskIdResolved);

  const taskDetailResult = await q.raw<Task & { plan_title: string }>(
    `SELECT t.*, p.title as plan_title FROM \`task\` t JOIN \`project\` p ON t.plan_id = p.plan_id WHERE t.task_id = '${escaped}';`,
  );
  if (taskDetailResult.isErr()) return toToolError(taskDetailResult.error);
  const taskDetailsArray = taskDetailResult.value;
  if (taskDetailsArray.length === 0)
    return toToolError(
      buildError(ErrorCode.TASK_NOT_FOUND, `Task with ID ${taskId} not found.`),
    );
  const taskDetails = taskDetailsArray[0];

  const blockersResult = await q.raw<BlockerDetails>(
    `SELECT e.from_task_id, t.title, t.status, e.reason FROM \`edge\` e JOIN \`task\` t ON e.from_task_id = t.task_id WHERE e.to_task_id = '${escaped}' AND e.type = 'blocks';`,
  );
  const blockers = blockersResult.isErr() ? [] : blockersResult.value;

  const dependentsResult = await q.raw<DependentDetails & { type: string }>(
    `SELECT e.to_task_id, e.type, t.title, t.status, e.reason FROM \`edge\` e JOIN \`task\` t ON e.to_task_id = t.task_id WHERE e.from_task_id = '${escaped}';`,
  );
  const dependents = dependentsResult.isErr() ? [] : dependentsResult.value;

  const eventsResult = await q.raw<Event>(
    `SELECT kind, body, created_at, actor FROM \`event\` WHERE task_id = '${escaped}' ORDER BY created_at DESC LIMIT 10;`,
  );
  const events = eventsResult.isErr() ? [] : eventsResult.value;
  const noteEvents = events.filter((e: Event) => e.kind === "note");

  const domainsResult = await q.select<{ doc: string }>("task_doc", {
    columns: ["doc"],
    where: { task_id: taskIdResolved },
  });
  const skillsResult = await q.select<{ skill: string }>("task_skill", {
    columns: ["skill"],
    where: { task_id: taskIdResolved },
  });
  const domains = domainsResult.isErr()
    ? []
    : domainsResult.value.map((r: { doc: string }) => r.doc);
  const skills = skillsResult.isErr()
    ? []
    : skillsResult.value.map((r: { skill: string }) => r.skill);

  const resultData = {
    taskDetails,
    blockers,
    dependents,
    events,
    noteEvents,
    domains,
    skills,
  };
  return toToolResult(resultData);
}

async function runStart(
  config: Config,
  taskId: string,
  agentName: string,
): Promise<ReturnType<typeof toToolResult> | ReturnType<typeof toToolError>> {
  const resolved = await resolveTaskId(taskId, config.doltRepoPath);
  if (resolved.isErr()) return toToolError(resolved.error);
  const result = await startOne(
    config,
    resolved.value,
    agentName,
    false,
    undefined,
    false,
  );
  if (result.isErr()) return toToolError(result.error);
  return toToolResult({
    task_id: result.value.task_id,
    status: result.value.status,
  });
}

async function runDone(
  config: Config,
  taskId: string,
  evidence: string,
  force?: boolean,
): Promise<ReturnType<typeof toToolResult> | ReturnType<typeof toToolError>> {
  const resolved = await resolveTaskId(taskId, config.doltRepoPath);
  if (resolved.isErr()) return toToolError(resolved.error);
  const taskIdResolved = resolved.value;
  const currentTimestamp = now();
  const q = query(config.doltRepoPath);

  let planId: string | null = null;
  const singleResult = await q
    .select<{ status: Task["status"]; plan_id: string }>("task", {
      columns: ["status", "plan_id"],
      where: { task_id: taskIdResolved },
    })
    .andThen((rows) => {
      if (rows.length === 0) {
        return err(
          buildError(
            ErrorCode.TASK_NOT_FOUND,
            `Task with ID ${taskId} not found.`,
          ),
        );
      }
      const currentStatus = rows[0].status;
      planId = rows[0].plan_id;
      if (!force) {
        const tr = checkValidTransition(currentStatus, "done");
        if (tr.isErr()) return err(tr.error);
      }
      return ok(currentStatus);
    })
    .andThen(() =>
      q.update(
        "task",
        { status: "done", updated_at: currentTimestamp },
        { task_id: taskIdResolved },
      ),
    )
    .andThen(() =>
      q.insert("event", {
        event_id: uuidv4(),
        task_id: taskIdResolved,
        kind: "done",
        body: jsonObj({
          evidence,
          checks: null as JsonValue | null,
          timestamp: currentTimestamp,
        }),
        created_at: currentTimestamp,
      }),
    )
    .andThen(() =>
      doltCommit(`task: done ${taskIdResolved}`, config.doltRepoPath, false),
    )
    .andThen(() =>
      q
        .select<{ to_task_id: string }>("edge", {
          columns: ["to_task_id"],
          where: { from_task_id: taskIdResolved, type: "blocks" },
        })
        .andThen((dependentRows) => {
          const syncs = dependentRows.map((r) =>
            syncBlockedStatusForTask(config.doltRepoPath, r.to_task_id),
          );
          return ResultAsync.combine(syncs).map(() => undefined);
        }),
    )
    .andThen(() => {
      if (!planId) {
        return ok({
          task_id: taskIdResolved,
          status: "done" as const,
          plan_completed: false,
        });
      }
      return autoCompletePlanIfDone(planId, config.doltRepoPath).andThen(
        (planCompleted) => {
          if (planCompleted) {
            return doltCommit(
              `plan: auto-complete ${planId}`,
              config.doltRepoPath,
              false,
            ).map(() => ({
              task_id: taskIdResolved,
              status: "done" as const,
              plan_completed: true,
            }));
          }
          return ok({
            task_id: taskIdResolved,
            status: "done" as const,
            plan_completed: false,
          });
        },
      );
    });

  if (singleResult.isErr()) return toToolError(singleResult.error);
  const value = singleResult.value;

  const branchResult = await getStartedEventBranch(
    taskIdResolved,
    config.doltRepoPath,
  );
  const branch = branchResult.isOk() ? branchResult.value : null;
  if (branch) {
    const mergeResult = await mergeAgentBranchIntoMain(
      config.doltRepoPath,
      branch,
      config.mainBranch ?? "main",
    );
    if (mergeResult.isErr()) return toToolError(mergeResult.error);
  }

  return toToolResult({
    task_id: value.task_id,
    status: value.status,
    plan_completed: value.plan_completed,
  });
}

async function runNote(
  config: Config,
  taskId: string,
  message: string,
  agentName = "default",
): Promise<ReturnType<typeof toToolResult> | ReturnType<typeof toToolError>> {
  const resolved = await resolveTaskId(taskId, config.doltRepoPath);
  if (resolved.isErr()) return toToolError(resolved.error);
  const taskIdResolved = resolved.value;
  const currentTimestamp = now();
  const q = query(config.doltRepoPath);

  const result = await q
    .select<{ task_id: string }>("task", {
      columns: ["task_id"],
      where: { task_id: taskIdResolved },
    })
    .andThen((rows) => {
      if (rows.length === 0) {
        return err(
          buildError(
            ErrorCode.TASK_NOT_FOUND,
            `Task with ID ${taskId} not found.`,
          ),
        );
      }
      return q
        .insert("event", {
          event_id: uuidv4(),
          task_id: taskIdResolved,
          kind: "note",
          body: jsonObj({
            message,
            agent: agentName,
            timestamp: currentTimestamp,
          }),
          created_at: currentTimestamp,
        })
        .andThen(() =>
          doltCommit(
            `task: note ${taskIdResolved}`,
            config.doltRepoPath,
            false,
          ),
        )
        .map(() => ({ task_id: taskIdResolved }));
    });

  if (result.isErr()) return toToolError(result.error);
  return toToolResult({ task_id: result.value.task_id, status: "ok" });
}

async function runBlock(
  config: Config,
  taskId: string,
  blockerTaskId: string,
  reason?: string,
): Promise<ReturnType<typeof toToolResult> | ReturnType<typeof toToolError>> {
  const resolvedTask = await resolveTaskId(taskId, config.doltRepoPath);
  if (resolvedTask.isErr()) return toToolError(resolvedTask.error);
  const resolvedBlocker = await resolveTaskId(
    blockerTaskId,
    config.doltRepoPath,
  );
  if (resolvedBlocker.isErr()) return toToolError(resolvedBlocker.error);

  const q = query(config.doltRepoPath);
  const existingEdgesResult = await q.select<Edge>("edge", {
    where: { type: "blocks" },
  });
  if (existingEdgesResult.isErr())
    return toToolError(existingEdgesResult.error);

  const cycleResult = checkNoBlockerCycle(
    resolvedBlocker.value,
    resolvedTask.value,
    existingEdgesResult.value,
  );
  if (cycleResult.isErr()) return toToolError(cycleResult.error);

  const edgeExistsResult = await q.count("edge", {
    from_task_id: resolvedBlocker.value,
    to_task_id: resolvedTask.value,
    type: "blocks",
  });
  if (edgeExistsResult.isErr()) return toToolError(edgeExistsResult.error);
  if (edgeExistsResult.value === 0) {
    const insertResult = await q.insert("edge", {
      from_task_id: resolvedBlocker.value,
      to_task_id: resolvedTask.value,
      type: "blocks",
      reason: reason ?? null,
    });
    if (insertResult.isErr()) return toToolError(insertResult.error);
  }

  const syncResult = await syncBlockedStatusForTask(
    config.doltRepoPath,
    resolvedTask.value,
  );
  if (syncResult.isErr()) return toToolError(syncResult.error);

  const commitResult = await doltCommit(
    `task: block ${resolvedTask.value} on ${resolvedBlocker.value}`,
    config.doltRepoPath,
    false,
  );
  if (commitResult.isErr()) return toToolError(commitResult.error);

  return toToolResult({
    task_id: resolvedTask.value,
    blocker_task_id: resolvedBlocker.value,
    reason: reason ?? null,
    status: "blocked",
  });
}

/**
 * Register MCP tools that wrap tg status, context, next, show (read-only) and start, done, note, block (write).
 * Server must be started with config so tools can run queries (doltRepoPath).
 */
export function registerTools(
  server: InstanceType<typeof McpServer>,
  config: Config,
): void {
  const repo = config.doltRepoPath;

  server.registerTool(
    "tg_status",
    {
      title: "Task Graph Status",
      description:
        "Return status overview: plans count, tasks by status, next runnable tasks (same as tg status --json). Optional plan filter.",
      inputSchema: z.object({ plan: z.string().optional() }),
    },
    async (args: { plan?: string }) => runStatus(repo, args.plan),
  );

  server.registerTool(
    "tg_context",
    {
      title: "Task Context",
      description:
        "Return context for a task: doc paths, skills, file tree, risks, related done tasks (same as tg context <taskId> --json).",
      inputSchema: z.object({ taskId: z.string() }),
    },
    async (args: { taskId: string }) => runContext(repo, args.taskId),
  );

  server.registerTool(
    "tg_next",
    {
      title: "Next Runnable Tasks",
      description:
        "Return runnable tasks, optionally filtered by plan and limited.",
      inputSchema: z.object({
        planId: z.string().optional(),
        limit: z.number().optional(),
      }),
    },
    async (args: { planId?: string; limit?: number }) =>
      runNext(repo, args.planId, args.limit ?? 10),
  );

  server.registerTool(
    "tg_show",
    {
      title: "Task Details",
      description:
        "Return task details, blockers, dependents, events (same as tg show <taskId> --json).",
      inputSchema: z.object({ taskId: z.string() }),
    },
    async (args: { taskId: string }) => runShow(repo, args.taskId),
  );

  server.registerTool(
    "tg_start",
    {
      title: "Start Task",
      description:
        "Start a task (state transition to doing). Same as tg start <taskId> --agent <name>.",
      inputSchema: z.object({
        taskId: z.string(),
        agent: z.string().optional(),
      }),
    },
    async (args: { taskId: string; agent?: string }) =>
      runStart(config, args.taskId, args.agent ?? "default"),
  );

  server.registerTool(
    "tg_done",
    {
      title: "Mark Task Done",
      description:
        "Mark a task as done with evidence. Same as tg done <taskId> --evidence <text>.",
      inputSchema: z.object({
        taskId: z.string(),
        evidence: z.string(),
        force: z.boolean().optional(),
      }),
    },
    async (args: { taskId: string; evidence: string; force?: boolean }) =>
      runDone(config, args.taskId, args.evidence, args.force),
  );

  server.registerTool(
    "tg_note",
    {
      title: "Add Note to Task",
      description:
        "Append a note event to a task. Same as tg note <taskId> --msg <text>.",
      inputSchema: z.object({
        taskId: z.string(),
        message: z.string(),
        agent: z.string().optional(),
      }),
    },
    async (args: { taskId: string; message: string; agent?: string }) =>
      runNote(config, args.taskId, args.message, args.agent),
  );

  server.registerTool(
    "tg_block",
    {
      title: "Block Task",
      description:
        "Block a task on another task. Same as tg block <taskId> --on <blockerId> [--reason <reason>].",
      inputSchema: z.object({
        taskId: z.string(),
        blockerTaskId: z.string(),
        reason: z.string().optional(),
      }),
    },
    async (args: { taskId: string; blockerTaskId: string; reason?: string }) =>
      runBlock(config, args.taskId, args.blockerTaskId, args.reason),
  );
}
