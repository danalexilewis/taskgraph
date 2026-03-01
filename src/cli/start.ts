import * as fs from "node:fs";
import type { Command } from "commander";
import { err, errAsync, okAsync, type ResultAsync } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import { checkoutBranch, createBranch } from "../db/branch";
import { doltCommit } from "../db/commit";
import { doltSql } from "../db/connection";
import { sqlEscape } from "../db/escape";
import { jsonObj, now, query } from "../db/query";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { checkRunnable, checkValidTransition } from "../domain/invariants";
import type { TaskStatus } from "../domain/types";
import { type Config, parseIdList, readConfig, resolveTaskId } from "./utils";
import {
  createPlanBranchAndWorktree,
  createWorktree,
  listWorktrees,
  resolveWorktreeBackend,
} from "./worktree";

const PLAN_BRANCH_PREFIX = "plan-";

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
): ResultAsync<{ task_id: string; status: TaskStatus }, AppError> {
  const currentTimestamp = now();
  const q = query(config.doltRepoPath);
  const branchName = useBranch ? agentBranchName(taskId) : undefined;

  const ensureBranch =
    useBranch && branchName
      ? createBranch(config.doltRepoPath, branchName).andThen(() =>
          checkoutBranch(config.doltRepoPath, branchName),
        )
      : okAsync(undefined);

  return ensureBranch
    .andThen(() =>
      q.select<{
        status: TaskStatus;
        hash_id?: string | null;
        plan_id: string;
      }>("task", {
        columns: ["status", "hash_id", "plan_id"],
        where: { task_id: taskId },
      }),
    )
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
    .andThen(
      ({ worktreeInfo, plan_id: planId, plan_branch, plan_worktree_path }) =>
        q
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
          .map(() => ({ task_id: taskId, status: "doing" as TaskStatus })),
    );
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
        | { id: string; status: TaskStatus }
        | { id: string; error: string };
      const results: ResultItem[] = [];

      for (const taskId of ids) {
        const resolvedResult = await resolveTaskId(taskId, config.doltRepoPath);
        if (resolvedResult.isErr()) {
          results.push({ id: taskId, error: resolvedResult.error.message });
          continue;
        }
        const resolved = resolvedResult.value;
        const result = await startOne(
          config,
          resolved,
          agentName,
          force,
          noCommit,
          useBranch,
          useWorktree,
          worktreeRepoPath,
        );
        result.match(
          (data) => results.push({ id: data.task_id, status: data.status }),
          (error: AppError) =>
            results.push({ id: taskId, error: error.message }),
        );
      }

      const hasFailure = results.some((r) => "error" in r);
      if (hasFailure) {
        if (!cmd.parent?.opts().json) {
          for (const r of results) {
            if ("error" in r) {
              console.error(`Error starting task ${r.id}: ${r.error}`);
            } else {
              console.log(`Task ${r.id} started.`);
            }
          }
        } else {
          console.log(
            JSON.stringify(
              results.map((r) =>
                "error" in r
                  ? { id: r.id, error: r.error }
                  : { id: r.id, status: r.status },
              ),
            ),
          );
        }
        process.exit(1);
      }

      if (!cmd.parent?.opts().json) {
        for (const r of results) {
          console.log(`Task ${r.id} started.`);
        }
      } else {
        console.log(
          JSON.stringify(
            results.map((r) =>
              "error" in r
                ? { id: r.id, error: r.error }
                : { id: r.id, status: r.status },
            ),
          ),
        );
      }
    });
}
