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
import { createWorktree, worktreeBranchName } from "./worktree";

function agentBranchName(taskId: string): string {
  return `agent-${taskId.slice(0, 8)}`;
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

  const ensureWorktree =
    useWorktree && worktreeRepoPath
      ? createWorktree(taskId, worktreeRepoPath).map((wtPath) => ({
          worktree_path: wtPath,
          worktree_branch: worktreeBranchName(taskId),
        }))
      : okAsync(
          undefined as
            | { worktree_path: string; worktree_branch: string }
            | undefined,
        );

  return ensureBranch
    .andThen(() => ensureWorktree)
    .andThen((worktreeInfo) =>
      q
        .select<{ status: TaskStatus }>("task", {
          columns: ["status"],
          where: { task_id: taskId },
        })
        .andThen((currentStatusResult) => {
          if (currentStatusResult.length === 0) {
            return err(
              buildError(
                ErrorCode.TASK_NOT_FOUND,
                `Task with ID ${taskId} not found.`,
              ),
            );
          }
          const currentStatus = currentStatusResult[0].status;

          if (currentStatus === "doing" && !force) {
            const sql = `SELECT body FROM \`event\` WHERE task_id = '${sqlEscape(taskId)}' AND kind = 'started' ORDER BY created_at DESC LIMIT 1`;
            return doltSql(sql, config.doltRepoPath).andThen((rows) => {
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
          }

          if (currentStatus === "todo") {
            return checkRunnable(taskId, config.doltRepoPath);
          }

          if (currentStatus === "doing" && force) {
            return okAsync(undefined);
          }

          const tr = checkValidTransition(currentStatus, "doing");
          return tr.isOk() ? okAsync(undefined) : errAsync(tr.error);
        })
        .andThen(() =>
          q.update(
            "task",
            { status: "doing", updated_at: currentTimestamp },
            { task_id: taskId },
          ),
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
              ...(worktreeInfo
                ? {
                    worktree_path: worktreeInfo.worktree_path,
                    worktree_branch: worktreeInfo.worktree_branch,
                  }
                : {}),
            }),
            created_at: currentTimestamp,
          }),
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
