import * as fs from "node:fs";
import type { Command } from "commander";
import { err, errAsync, okAsync, ResultAsync } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import { checkoutBranch, createBranch } from "../db/branch";
import { doltCommit } from "../db/commit";
import { doltSql } from "../db/connection";
import { sqlEscape } from "../db/escape";
import { jsonObj, now, query } from "../db/query";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { checkRunnable, checkValidTransition } from "../domain/invariants";
import type { TaskStatus } from "../domain/types";
import { getStatusCache } from "./status-cache";
import {
  type Config,
  formatCauseForCLI,
  parseIdList,
  readConfig,
  resolveTaskId,
  resolveTaskIdsBatch,
} from "./utils";
import {
  createPlanBranchAndWorktree,
  createWorktree,
  listWorktrees,
  resolveWorktreeBackend,
} from "./worktree";

const PLAN_BRANCH_PREFIX = "plan-";

type TaskRowForStart = {
  task_id: string;
  status: TaskStatus;
  hash_id: string | null;
  plan_id: string;
};

/**
 * Load task rows (task_id, status, hash_id, plan_id) for the given task IDs in one query.
 * Returns a Map from task_id to row for use in batch start.
 */
function loadTasksByIds(
  doltRepoPath: string,
  taskIds: string[],
): ResultAsync<Map<string, TaskRowForStart>, AppError> {
  if (taskIds.length === 0) return okAsync(new Map());
  const idList = taskIds.map((id) => `'${sqlEscape(id)}'`).join(",");
  const sql = `SELECT task_id, status, hash_id, plan_id FROM \`task\` WHERE task_id IN (${idList})`;
  return doltSql(sql, doltRepoPath).map((rows: TaskRowForStart[]) => {
    const map = new Map<string, TaskRowForStart>();
    for (const row of rows) map.set(row.task_id, row);
    return map;
  });
}

/**
 * Batch fetch unmet blocker count per task_id (one raw query).
 * Used to validate runnable for multiple todo tasks without N queries.
 */
function batchBlockerCount(
  repoPath: string,
  taskIds: string[],
): ResultAsync<Map<string, number>, AppError> {
  if (taskIds.length === 0) return okAsync(new Map());
  const idList = taskIds.map((id) => `'${sqlEscape(id)}'`).join(",");
  const sql = `
    SELECT e.to_task_id AS task_id, COUNT(*) AS unmet_count
    FROM \`edge\` e
    JOIN \`task\` bt ON e.from_task_id = bt.task_id
    WHERE e.to_task_id IN (${idList})
      AND e.type = 'blocks'
      AND bt.status NOT IN ('done','canceled')
    GROUP BY e.to_task_id
  `;
  return query(repoPath)
    .raw<{ task_id: string; unmet_count: number }>(sql)
    .map((rows) => {
      const map = new Map<string, number>();
      for (const r of rows) map.set(r.task_id, Number(r.unmet_count ?? 0));
      return map;
    });
}

type StartedBody = { agent?: string };

/**
 * Batch fetch latest started event body per task_id (one raw query).
 * Used when status=doing and !force to determine claimant without N queries.
 */
function batchClaimCheck(
  repoPath: string,
  taskIds: string[],
): ResultAsync<Map<string, StartedBody | null>, AppError> {
  if (taskIds.length === 0) return okAsync(new Map());
  const idList = taskIds.map((id) => `'${sqlEscape(id)}'`).join(",");
  const sql = `
    SELECT e.task_id, e.body
    FROM \`event\` e
    INNER JOIN (
      SELECT task_id, MAX(created_at) AS max_created
      FROM \`event\`
      WHERE kind = 'started' AND task_id IN (${idList})
      GROUP BY task_id
    ) m ON e.task_id = m.task_id AND e.kind = 'started' AND e.created_at = m.max_created
    WHERE e.task_id IN (${idList})
  `;
  return query(repoPath)
    .raw<{ task_id: string; body: string | object }>(sql)
    .map((rows) => {
      const map = new Map<string, StartedBody | null>();
      for (const r of rows) {
        const raw = r.body;
        const parsed: StartedBody | null =
          raw != null
            ? typeof raw === "string"
              ? (JSON.parse(raw) as StartedBody)
              : (raw as StartedBody)
            : null;
        if (!map.has(r.task_id)) map.set(r.task_id, parsed);
      }
      for (const id of taskIds) if (!map.has(id)) map.set(id, null);
      return map;
    });
}

export type BatchValidateResult = {
  validIds: string[];
  errors: Map<string, string>;
};

/**
 * Given batch-loaded task rows, determine which task_ids are valid to start:
 * runnable (todo with zero unmet blockers), or doing+force. For doing+!force,
 * treat as invalid if already claimed (batch claim check). Returns validIds and
 * per-task errors map for the batch path.
 */
export function validateBatchStart(
  repoPath: string,
  taskRowMap: Map<string, TaskRowForStart>,
  force: boolean,
): ResultAsync<BatchValidateResult, AppError> {
  const taskIds = Array.from(taskRowMap.keys());
  if (taskIds.length === 0) {
    return okAsync({ validIds: [], errors: new Map() });
  }

  const doingIds: string[] = [];
  const todoIds: string[] = [];
  const errors = new Map<string, string>();

  for (const taskId of taskIds) {
    const row = taskRowMap.get(taskId);
    if (!row) continue;
    const status = row.status;
    if (status === "doing") {
      if (force) continue;
      doingIds.push(taskId);
    } else if (status === "todo") {
      todoIds.push(taskId);
    } else {
      const tr = checkValidTransition(status, "doing");
      errors.set(
        taskId,
        tr.isErr() ? tr.error.message : `Invalid status: ${status}`,
      );
    }
  }

  return ResultAsync.combine([
    doingIds.length > 0 ? batchClaimCheck(repoPath, doingIds) : okAsync(new Map<string, StartedBody | null>()),
    todoIds.length > 0 ? batchBlockerCount(repoPath, todoIds) : okAsync(new Map<string, number>()),
  ] as const).map(([claimMap, blockerCountMap]) => {
    for (const taskId of doingIds) {
      const body = claimMap.get(taskId) ?? null;
      const claimant = body?.agent ?? "unknown";
      errors.set(
        taskId,
        `Task is being worked by ${claimant}. Use --force to override.`,
      );
    }
    for (const taskId of todoIds) {
      const count = blockerCountMap.get(taskId) ?? 0;
      if (count > 0) {
        errors.set(
          taskId,
          `Task ${taskId} has ${count} unmet blockers and is not runnable.`,
        );
      }
    }
    const validIds = taskIds.filter((id) => !errors.has(id));
    return { validIds, errors };
  });
}

/**
 * Batch DB path: bulk UPDATE task, one INSERT per event, project update, one commit.
 * For a set of valid task_ids (no worktree, no branch). Caller must have already
 * validated taskIds (runnable todo or doing+force). On failure no partial commit.
 */
export function startMany(
  config: Config,
  taskIds: string[],
  agentName: string,
  timestamp?: string,
  noCommit?: boolean,
): ResultAsync<{ started: string[] }, AppError> {
  if (taskIds.length === 0) return okAsync({ started: [] });

  const repoPath = config.doltRepoPath;
  const q = query(repoPath);
  const currentTimestamp = timestamp ?? now();
  const idList = taskIds.map((id) => `'${sqlEscape(id)}'`).join(",");

  const planIdsSql = `SELECT DISTINCT plan_id FROM \`task\` WHERE task_id IN (${idList})`;

  return q
    .raw<{ plan_id: string }>(planIdsSql)
    .andThen((planRows) => {
      const planIds = planRows.map((r) => r.plan_id);
      const planIdList = planIds.map((id) => `'${sqlEscape(id)}'`).join(",");

      return q
        .raw(
          `UPDATE \`task\` SET status = 'doing', updated_at = '${sqlEscape(currentTimestamp)}' WHERE task_id IN (${idList})`,
        )
        .andThen(() => {
          const eventInserts = taskIds.map((taskId) =>
            q.insert("event", {
              event_id: uuidv4(),
              task_id: taskId,
              kind: "started",
              body: jsonObj({ agent: agentName, timestamp: currentTimestamp }),
              created_at: currentTimestamp,
            }),
          );
          return ResultAsync.combine(eventInserts);
        })
        .andThen(() => {
          if (planIds.length === 0) return okAsync(undefined as void);
          return q
            .raw(
              `UPDATE \`project\` SET status = 'active', updated_at = '${sqlEscape(currentTimestamp)}' WHERE plan_id IN (${planIdList}) AND status = 'draft'`,
            )
            .map(() => undefined);
        })
        .andThen(() =>
          doltCommit(
            `task: start ${taskIds.length} tasks`,
            repoPath,
            noCommit ?? false,
          ),
        )
        .map(() => ({ started: taskIds }));
    });
}

function agentBranchName(taskId: string): string {
  return `agent-${taskId.slice(0, 8)}`;
}

/**
 * Ensures the plan has a branch and worktree (plan-<hash_id>). If plan_worktree row exists
 * and path is live, returns it. Otherwise creates via createPlanBranchAndWorktree and
 * records in plan_worktree. Handles "branch already exists" by resolving path from wt list.
 * Returns null when the plan has no hash_id (branch from main).
 */
function ensurePlanBranch(
  planId: string,
  repoPath: string,
  config: Config,
): ResultAsync<
  { branch: string; plan_worktree_path: string } | null,
  AppError
> {
  const q = query(config.doltRepoPath);

  return q
    .select<{ hash_id: string | null }>("project", {
      columns: ["hash_id"],
      where: { plan_id: planId },
    })
    .andThen((planRows) => {
      if (planRows.length === 0) return okAsync(null);
      const planHashId = planRows[0].hash_id;
      if (planHashId == null || planHashId === "") return okAsync(null);
      const branchName = `${PLAN_BRANCH_PREFIX}${planHashId}`;

      return q
        .select<{ worktree_path: string; worktree_branch: string }>(
          "plan_worktree",
          {
            columns: ["worktree_path", "worktree_branch"],
            where: { plan_id: planId },
          },
        )
        .andThen((pwRows) => {
          if (pwRows.length > 0 && fs.existsSync(pwRows[0].worktree_path)) {
            return okAsync({
              branch: pwRows[0].worktree_branch,
              plan_worktree_path: pwRows[0].worktree_path,
            });
          }

          return createPlanBranchAndWorktree(planHashId, repoPath, "main")
            .andThen((worktreePath) => {
              const created_at = now();
              return doltSql(
                `INSERT INTO \`plan_worktree\` (plan_id, worktree_path, worktree_branch, created_at) VALUES ('${sqlEscape(planId)}', '${sqlEscape(worktreePath)}', '${sqlEscape(branchName)}', '${sqlEscape(created_at)}') ON DUPLICATE KEY UPDATE worktree_path = VALUES(worktree_path), worktree_branch = VALUES(worktree_branch), created_at = VALUES(created_at)`,
                config.doltRepoPath,
              ).map(() => ({
                branch: branchName,
                plan_worktree_path: worktreePath,
              }));
            })
            .orElse((e) => {
              const msg = e.message.toLowerCase();
              if (
                msg.includes("already exists") ||
                msg.includes("branch already exists")
              ) {
                const backend = resolveWorktreeBackend(config);
                return listWorktrees(repoPath, backend).andThen((entries) => {
                  const entry = entries.find((x) => x.branch === branchName);
                  if (!entry?.path) {
                    return errAsync(
                      buildError(
                        ErrorCode.UNKNOWN_ERROR,
                        `Plan branch ${branchName} exists but could not find worktree path`,
                      ),
                    );
                  }
                  const created_at = now();
                  return doltSql(
                    `INSERT INTO \`plan_worktree\` (plan_id, worktree_path, worktree_branch, created_at) VALUES ('${sqlEscape(planId)}', '${sqlEscape(entry.path)}', '${sqlEscape(branchName)}', '${sqlEscape(created_at)}') ON DUPLICATE KEY UPDATE worktree_path = VALUES(worktree_path), worktree_branch = VALUES(worktree_branch), created_at = VALUES(created_at)`,
                    config.doltRepoPath,
                  ).map(() => ({
                    branch: branchName,
                    plan_worktree_path: entry.path,
                  }));
                });
              }
              return errAsync(e);
            });
        });
    });
}

export function startOne(
  config: Config,
  taskId: string,
  agentName: string,
  force: boolean,
  noCommit?: boolean,
  useBranch?: boolean,
  useWorktree?: boolean,
  worktreeRepoPath?: string,
  preloaded?: TaskRowForStart,
): ResultAsync<
  { task_id: string; status: TaskStatus; worktree_path?: string },
  AppError
> {
  const currentTimestamp = now();
  const q = query(config.doltRepoPath);
  const branchName = useBranch ? agentBranchName(taskId) : undefined;

  const ensureBranch =
    useBranch && branchName
      ? createBranch(config.doltRepoPath, branchName).andThen(() =>
          checkoutBranch(config.doltRepoPath, branchName),
        )
      : okAsync(undefined);

  const loadTaskRow = preloaded
    ? okAsync([preloaded])
    : q.select<{
        status: TaskStatus;
        hash_id?: string | null;
        plan_id: string;
      }>("task", {
        columns: ["status", "hash_id", "plan_id"],
        where: { task_id: taskId },
      });

  return ensureBranch
    .andThen(() => loadTaskRow)
    .andThen((currentStatusResult) => {
      if (currentStatusResult.length === 0) {
        return err(
          buildError(
            ErrorCode.TASK_NOT_FOUND,
            `Task with ID ${taskId} not found.`,
          ),
        );
      }
      const {
        status: currentStatus,
        hash_id,
        plan_id,
      } = currentStatusResult[0];

      // biome-ignore lint/suspicious/noConfusingVoidType: checkRunnable returns void on success
      let statusCheck: ResultAsync<void | undefined, AppError>;
      if (currentStatus === "doing" && !force) {
        const sql = `SELECT body FROM \`event\` WHERE task_id = '${sqlEscape(taskId)}' AND kind = 'started' ORDER BY created_at DESC LIMIT 1`;
        statusCheck = doltSql(sql, config.doltRepoPath).andThen((rows) => {
          const row = (rows as { body: string | object }[])[0];
          const raw = row?.body;
          const parsed =
            raw != null
              ? typeof raw === "string"
                ? (JSON.parse(raw) as { agent?: string })
                : (raw as { agent?: string })
              : null;
          const claimant = parsed?.agent ?? "unknown";
          return err(
            buildError(
              ErrorCode.TASK_ALREADY_CLAIMED,
              `Task is being worked by ${claimant}. Use --force to override.`,
            ),
          );
        });
      } else if (currentStatus === "todo") {
        statusCheck = checkRunnable(taskId, config.doltRepoPath, currentStatus);
      } else if (currentStatus === "doing" && force) {
        statusCheck = okAsync(undefined);
      } else {
        const tr = checkValidTransition(currentStatus, "doing");
        statusCheck = tr.isOk() ? okAsync(undefined) : errAsync(tr.error);
      }

      const ensureWorktree =
        useWorktree && worktreeRepoPath
          ? plan_id
            ? ensurePlanBranch(plan_id, worktreeRepoPath, config).andThen(
                (planInfo) =>
                  createWorktree(
                    taskId,
                    worktreeRepoPath,
                    planInfo?.branch,
                    hash_id ?? undefined,
                  ).map((worktreeInfo) => ({
                    worktreeInfo,
                    plan_branch: planInfo?.branch,
                    plan_worktree_path: planInfo?.plan_worktree_path,
                  })),
              )
            : createWorktree(
                taskId,
                worktreeRepoPath,
                undefined,
                hash_id ?? undefined,
              ).map((worktreeInfo) => ({
                worktreeInfo,
                plan_branch: undefined,
                plan_worktree_path: undefined,
              }))
          : okAsync(
              undefined as
                | {
                    worktreeInfo: {
                      worktree_path: string;
                      worktree_branch: string;
                    };
                    plan_branch?: string;
                    plan_worktree_path?: string;
                  }
                | undefined,
            );

      return statusCheck
        .andThen(() => ensureWorktree)
        .map((w) => ({
          worktreeInfo: w?.worktreeInfo,
          plan_id,
          plan_branch: w?.plan_branch,
          plan_worktree_path: w?.plan_worktree_path,
        }));
    })
    .andThen((payload) => {
      const {
        worktreeInfo,
        plan_id: planId,
        plan_branch,
        plan_worktree_path,
      } = payload;
      return q
          .update(
            "task",
            { status: "doing", updated_at: currentTimestamp },
            { task_id: taskId },
          )
          .andThen(() =>
            q.insert("event", {
              event_id: uuidv4(),
              task_id: taskId,
              kind: "started",
              body: jsonObj({
                agent: agentName,
                timestamp: currentTimestamp,
                ...(branchName ? { branch: branchName } : {}),
                ...(worktreeInfo && worktreeRepoPath
                  ? {
                      worktree_path: worktreeInfo.worktree_path,
                      worktree_branch: worktreeInfo.worktree_branch,
                      worktree_repo_root: fs.realpathSync(worktreeRepoPath),
                      ...(plan_branch != null ? { plan_branch } : {}),
                      ...(plan_worktree_path != null
                        ? { plan_worktree_path }
                        : {}),
                    }
                  : {}),
              }),
              created_at: currentTimestamp,
            }),
          )
          .andThen(() =>
            q.update(
              "project",
              { status: "active", updated_at: currentTimestamp },
              { plan_id: planId, status: "draft" },
            ),
          )
          .andThen(() =>
            doltCommit(`task: start ${taskId}`, config.doltRepoPath, noCommit),
          )
          .map(() => ({
            task_id: taskId,
            status: "doing" as TaskStatus,
            worktree_path: worktreeInfo?.worktree_path,
          }));
    });
}

export function startCommand(program: Command) {
  program
    .command("start")
    .description("Start a task")
    .argument(
      "<taskIds...>",
      "One or more task IDs (space- or comma-separated)",
    )
    .option("--agent <name>", "Agent identifier for multi-agent visibility")
    .option("--force", "Override claim when task is already being worked")
    .option(
      "--branch",
      "Create and checkout an agent branch for this task; tg done will merge it into main",
    )
    .option(
      "--worktree",
      "Create a git worktree for the task; worktree path is stored in the started event body",
    )
    .action(async (taskIds: string[], options, cmd) => {
      const ids = parseIdList(taskIds);
      if (ids.length === 0) {
        console.error("At least one task ID required.");
        process.exit(1);
      }

      const agentName = options.agent ?? "default";
      const force = options.force ?? false;
      const useWorktree = options.worktree === true;
      const worktreeRepoPath = useWorktree ? process.cwd() : undefined;
      const noCommit = cmd.parent?.opts().noCommit;

      const configResult = await readConfig();
      if (configResult.isErr()) {
        console.error(configResult.error.message);
        process.exit(1);
      }
      const config = configResult.value;
      const useBranch =
        options.branch === true || config.useDoltBranches === true;

      type ResultItem =
        | { id: string; status: TaskStatus; worktree_path?: string }
        | { id: string; error: string; cause?: unknown };
      const results: ResultItem[] = [];

      if (ids.length > 1 && !useWorktree && !useBranch) {
        const resolveBatchResult = await resolveTaskIdsBatch(
          ids,
          config.doltRepoPath,
        );
        if (resolveBatchResult.isErr()) {
          const e = resolveBatchResult.error;
          for (const id of ids) {
            results.push({
              id,
              error: e.message,
              ...(e.cause != null ? { cause: e.cause } : {}),
            });
          }
        } else {
          for (const [inputId, msg] of resolveBatchResult.value.errors) {
            results.push({ id: inputId, error: msg });
          }
          const resolved = resolveBatchResult.value.resolved;
          if (resolved.length > 0) {
            const loadResult = await loadTasksByIds(
              config.doltRepoPath,
              resolved.map((r) => r.taskId),
            );
            if (loadResult.isErr()) {
              const e = loadResult.error;
              for (const r of resolved) {
                results.push({
                  id: r.inputId,
                  error: e.message,
                  ...(e.cause != null ? { cause: e.cause } : {}),
                });
              }
            } else {
              const taskRowMap = loadResult.value;
              const validateResult = await validateBatchStart(
                config.doltRepoPath,
                taskRowMap,
                force,
              );
              if (validateResult.isErr()) {
                const e = validateResult.error;
                for (const r of resolved) {
                  results.push({
                    id: r.inputId,
                    error: e.message,
                    ...(e.cause != null ? { cause: e.cause } : {}),
                  });
                }
              } else {
                const { validIds, errors: validateErrors } =
                  validateResult.value;
                const inputIdByTaskId = new Map(
                  resolved.map((r) => [r.taskId, r.inputId]),
                );
                for (const r of resolved) {
                  const errMsg = validateErrors.get(r.taskId);
                  if (errMsg != null) {
                    results.push({ id: r.inputId, error: errMsg });
                  }
                }
                const startManyResult = await startMany(
                  config,
                  validIds,
                  agentName,
                  undefined,
                  noCommit,
                );
                if (startManyResult.isErr()) {
                  const e = startManyResult.error;
                  for (const taskId of validIds) {
                    results.push({
                      id: inputIdByTaskId.get(taskId) ?? taskId,
                      error: e.message,
                      ...(e.cause != null ? { cause: e.cause } : {}),
                    });
                  }
                } else {
                  for (const taskId of startManyResult.value.started) {
                    results.push({
                      id: inputIdByTaskId.get(taskId) ?? taskId,
                      status: "doing",
                    });
                  }
                }
              }
            }
          }
        }
      } else {
        const resolvedList: { inputId: string; taskId: string }[] = [];
        for (const taskId of ids) {
          const resolvedResult = await resolveTaskId(
            taskId,
            config.doltRepoPath,
          );
          if (resolvedResult.isErr()) {
            const e = resolvedResult.error;
            results.push({
              id: taskId,
              error: e.message,
              ...(e.cause != null ? { cause: e.cause } : {}),
            });
            continue;
          }
          resolvedList.push({ inputId: taskId, taskId: resolvedResult.value });
        }
        for (const { inputId, taskId } of resolvedList) {
          const result = await startOne(
            config,
            taskId,
            agentName,
            force,
            noCommit,
            useBranch,
            useWorktree,
            worktreeRepoPath,
          );
          result.match(
            (data) =>
              results.push({
                id: data.task_id,
                status: data.status,
                ...(data.worktree_path != null && {
                  worktree_path: data.worktree_path,
                }),
              }),
            (error: AppError) =>
              results.push({
                id: inputId,
                error: error.message,
                ...(error.cause != null ? { cause: error.cause } : {}),
              }),
          );
        }
      }

      const hasFailure = results.some((r) => "error" in r);
      if (!hasFailure) getStatusCache().clear();
      if (hasFailure) {
        if (!cmd.parent?.opts().json) {
          for (const r of results) {
            if ("error" in r) {
              console.error(`Error starting task ${r.id}: ${r.error}`);
              if (r.cause != null) {
                console.error(formatCauseForCLI(r.cause));
              }
            } else {
              console.log(`Task ${r.id} started.`);
              if (r.worktree_path) {
                console.log(`worktree_path: ${r.worktree_path}`);
              }
            }
          }
        } else {
          console.log(
            JSON.stringify(
              results.map((r) =>
                "error" in r
                  ? {
                      id: r.id,
                      error: r.error,
                      ...(r.cause != null
                        ? {
                            cause:
                              r.cause instanceof Error
                                ? r.cause.message
                                : String(r.cause),
                          }
                        : {}),
                    }
                  : { id: r.id, status: r.status, ...("worktree_path" in r && r.worktree_path != null && { worktree_path: r.worktree_path }) },
              ),
            ),
          );
        }
        process.exit(1);
      }

      if (!cmd.parent?.opts().json) {
        for (const r of results) {
          console.log(`Task ${r.id} started.`);
          if ("worktree_path" in r && r.worktree_path) {
            console.log(`worktree_path: ${r.worktree_path}`);
          }
        }
      } else {
        console.log(
          JSON.stringify(
            results.map((r) =>
              "error" in r
                ? {
                    id: r.id,
                    error: r.error,
                    ...(r.cause != null
                      ? {
                          cause:
                            r.cause instanceof Error
                              ? r.cause.message
                              : String(r.cause),
                        }
                      : {}),
                  }
                : { id: r.id, status: r.status, ...("worktree_path" in r && r.worktree_path != null && { worktree_path: r.worktree_path }) },
            ),
          ),
        );
      }
    });
}
