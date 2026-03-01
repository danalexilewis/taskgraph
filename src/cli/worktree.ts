/**
 * Git worktree management for task isolation.
 *
 * Expected repo layout:
 * - repoPath: directory containing .git (and usually .taskgraph). Defaults to process.cwd().
 * - Worktrees are created at .taskgraph/worktrees/<taskId>/ with branch tg/<taskId>.
 */

import * as path from "node:path";
import type { Command } from "commander";
import { execa, execaSync } from "execa";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import type { Config } from "./utils";
import { readConfig, rootOpts } from "./utils";

let _wtAvailable: boolean | null = null;

/**
 * Checks if Worktrunk (wt) is on PATH. Caches result for process lifetime.
 */
export function isWorktrunkAvailable(): boolean {
  if (_wtAvailable !== null) {
    return _wtAvailable;
  }
  try {
    execaSync("wt", ["--version"]);
    _wtAvailable = true;
  } catch {
    _wtAvailable = false;
  }
  return _wtAvailable;
}

/**
 * Resolves which worktree backend to use based on config.
 * - useWorktrunk true: use wt (errors if not found)
 * - useWorktrunk false: use raw git
 * - useWorktrunk undefined: auto-detect (wt if available, else git)
 */
export function resolveWorktreeBackend(config: Config): "worktrunk" | "git" {
  if (config.useWorktrunk === true) {
    if (!isWorktrunkAvailable()) {
      throw new Error(
        "Worktrunk (wt) requested but not found on PATH. Install Worktrunk or set useWorktrunk to false.",
      );
    }
    return "worktrunk";
  }
  if (config.useWorktrunk === false) {
    return "git";
  }
  return isWorktrunkAvailable() ? "worktrunk" : "git";
}

const WORKTREES_DIR = ".taskgraph/worktrees";
const BRANCH_PREFIX = "tg/";

function worktreePath(repoPath: string, taskId: string): string {
  return path.join(repoPath, WORKTREES_DIR, taskId);
}

/**
 * Returns the worktree branch name for a task.
 * - When hashId is provided: returns `tg-<hashId>` (or hashId as-is if it already has the tg- prefix).
 * - When hashId is null/undefined: returns `tg/<taskId>` (backward compat for raw git).
 */
export function worktreeBranchForTask(
  taskId: string,
  hashId?: string | null,
): string {
  if (hashId != null) {
    return hashId.startsWith("tg-") ? hashId : `tg-${hashId}`;
  }
  return `${BRANCH_PREFIX}${taskId}`;
}

/**
 * @deprecated Use worktreeBranchForTask(taskId, hashId) instead.
 * Returns tg/<taskId> for backward compatibility.
 */
export function worktreeBranchName(taskId: string): string {
  return worktreeBranchForTask(taskId);
}

function branchName(taskId: string): string {
  return worktreeBranchName(taskId);
}

/**
 * Resolves backend from config. Defaults to 'git' if readConfig fails.
 */
function resolveBackendFromConfig(repoPath: string): "worktrunk" | "git" {
  const configResult = readConfig(repoPath);
  if (configResult.isErr()) {
    return "git";
  }
  return resolveWorktreeBackend(configResult.value);
}

/**
 * Creates a worktree for the task. Backend is determined by config (worktrunk or git).
 *
 * **Worktrunk path**: Runs `wt switch --create <branch> --no-cd --no-verify -y -C <repoPath>`,
 * then discovers the worktree path via `wt list --format json`.
 *
 * **Git path**: Creates worktree at .taskgraph/worktrees/<taskId>/ with `git worktree add -b`.
 *
 * @param taskId - Task identifier
 * @param repoPath - Git repo root. Defaults to process.cwd()
 * @param baseBranch - Optional branch to create from (git backend only)
 * @param hashId - Optional hash_id for branch name (tg-<hashId> vs tg/<taskId>)
 */
export function createWorktree(
  taskId: string,
  repoPath: string = process.cwd(),
  baseBranch?: string,
  hashId?: string | null,
): ResultAsync<
  { worktree_path: string; worktree_branch: string },
  AppError
> {
  const branch = worktreeBranchForTask(taskId, hashId);
  let backend: "worktrunk" | "git";
  try {
    backend = resolveBackendFromConfig(repoPath);
  } catch (e) {
    return errAsync(
      buildError(
        ErrorCode.UNKNOWN_ERROR,
        "Worktrunk requested but not available",
        e,
      ),
    );
  }

  if (backend === "worktrunk") {
    return ResultAsync.fromPromise(
      execa("wt", ["switch", "--create", branch, "--no-cd", "--no-verify", "-y", "-C", repoPath], {
        cwd: repoPath,
      }),
      (e) =>
        buildError(
          ErrorCode.UNKNOWN_ERROR,
          `Worktrunk worktree create failed for ${taskId}`,
          e,
        ),
    ).andThen(() =>
      ResultAsync.fromPromise(
        execa("wt", ["list", "--format", "json", "-C", repoPath], {
          cwd: repoPath,
        }),
        (e) =>
          buildError(
            ErrorCode.UNKNOWN_ERROR,
            "Worktrunk worktree list failed",
            e,
          ),
      ).andThen((result) => {
        const raw = JSON.parse(result.stdout) as Array<{
          path: string;
          branch?: string;
        }>;
        const entry = raw.find((e) => e.branch === branch);
        if (!entry?.path) {
          return errAsync(
            buildError(
              ErrorCode.UNKNOWN_ERROR,
              `Could not find worktree path for branch ${branch} after creation`,
            ),
          );
        }
        return okAsync({ worktree_path: entry.path, worktree_branch: branch });
      }),
    );
  }

  const wtPath = worktreePath(repoPath, taskId);
  const args = ["worktree", "add", "-b", branch, wtPath];
  if (baseBranch) {
    args.push(baseBranch);
  }

  return ResultAsync.fromPromise(execa("git", args, { cwd: repoPath }), (e) =>
    buildError(
      ErrorCode.UNKNOWN_ERROR,
      `Git worktree create failed for ${taskId}`,
      e,
    ),
  ).map(() => ({ worktree_path: wtPath, worktree_branch: branch }));
}

/**
 * Removes the worktree and optionally deletes the branch.
 * - Worktrunk: `wt remove <branchName> --force --force-delete --no-verify -y --foreground -C <repoPath>`
 * - Git: `git worktree remove --force` + optional `git branch -d`
 *
 * @param taskId - Task identifier (used for branch/path when branchOverride not provided)
 * @param repoPath - Git repo root. Defaults to process.cwd()
 * @param deleteBranch - If true (git backend), delete the branch after removing the worktree
 * @param branchOverride - When provided (worktrunk), use this branch name for wt remove
 */
export function removeWorktree(
  taskId: string,
  repoPath: string = process.cwd(),
  deleteBranch: boolean = false,
  branchOverride?: string,
): ResultAsync<void, AppError> {
  const backend = resolveBackendFromConfig(repoPath);
  const branch = branchOverride ?? branchName(taskId);

  if (backend === "worktrunk") {
    return ResultAsync.fromPromise(
      execa("wt", [
        "remove",
        branch,
        "--force",
        "--force-delete",
        "--no-verify",
        "-y",
        "--foreground",
        "-C",
        repoPath,
      ], { cwd: repoPath }),
      (e) =>
        buildError(
          ErrorCode.UNKNOWN_ERROR,
          `Worktrunk worktree remove failed for ${branch}`,
          e,
        ),
    ).map(() => undefined);
  }

  const relativePath = path.join(WORKTREES_DIR, taskId);
  return ResultAsync.fromPromise(
    execa("git", ["worktree", "remove", "--force", relativePath], {
      cwd: repoPath,
    }),
    (e) =>
      buildError(
        ErrorCode.UNKNOWN_ERROR,
        `Git worktree remove failed for ${taskId}`,
        e,
      ),
  ).andThen(() => {
    if (!deleteBranch) {
      return ResultAsync.fromSafePromise(Promise.resolve());
    }
    return ResultAsync.fromPromise(
      execa("git", ["branch", "-d", branch], { cwd: repoPath }),
      (e) =>
        buildError(
          ErrorCode.UNKNOWN_ERROR,
          `Git branch delete failed: ${branch}`,
          e,
        ),
    ).map(() => undefined);
  });
}

/**
 * Merge a worktree branch into the base branch (e.g. main) in the git repo.
 * - Worktrunk: `wt merge <mainBranch> -C <worktreePath>` does squash + rebase + merge + worktree removal + branch deletion in one step. Caller must NOT call removeWorktree afterward.
 * - Git: `git checkout main && git merge <branch>`. Caller must call removeWorktree separately.
 *
 * @param worktreePath - Required when backend is worktrunk. Path to the worktree directory (for -C).
 */
export function mergeWorktreeBranchIntoMain(
  repoPath: string,
  branchName: string,
  mainBranch: string = "main",
  worktreePath?: string,
): ResultAsync<void, AppError> {
  const backend = resolveBackendFromConfig(repoPath);
  if (backend === "worktrunk") {
    if (!worktreePath) {
      return errAsync(
        buildError(
          ErrorCode.UNKNOWN_ERROR,
          "mergeWorktreeBranchIntoMain: worktreePath required for worktrunk backend",
        ),
      );
    }
    return ResultAsync.fromPromise(
      execa("wt", [
        "merge",
        mainBranch,
        "-C",
        worktreePath,
        "--no-verify",
        "-y",
      ], { cwd: repoPath }),
      (e) =>
        buildError(
          ErrorCode.UNKNOWN_ERROR,
          `Worktrunk merge ${branchName} into ${mainBranch} failed`,
          e,
        ),
    ).map(() => undefined);
  }
  return ResultAsync.fromPromise(
    execa("git", ["checkout", mainBranch], { cwd: repoPath }),
    (e) =>
      buildError(
        ErrorCode.UNKNOWN_ERROR,
        `Git checkout ${mainBranch} failed`,
        e,
      ),
  )
    .andThen(() =>
      ResultAsync.fromPromise(
        execa("git", ["merge", branchName], { cwd: repoPath }),
        (e) =>
          buildError(
            ErrorCode.UNKNOWN_ERROR,
            `Git merge ${branchName} failed`,
            e,
          ),
      ),
    )
    .map(() => undefined);
}

export interface WorktreeEntry {
  path: string;
  commit: string;
  branch?: string;
}

/**
 * Returns active git worktrees (main + linked worktrees).
 * - backend 'worktrunk': runs `wt list --format json`, maps to WorktreeEntry[]
 * - backend 'git' or undefined: parses `git worktree list --porcelain`
 *
 * @param repoPath - Git repo root. Defaults to process.cwd()
 * @param backend - 'worktrunk' or 'git'. When undefined, uses git.
 */
export function listWorktrees(
  repoPath: string = process.cwd(),
  backend?: "worktrunk" | "git",
): ResultAsync<WorktreeEntry[], AppError> {
  if (backend === "worktrunk") {
    return ResultAsync.fromPromise(
      execa("wt", ["list", "--format", "json", "-C", repoPath], {
        cwd: repoPath,
      }),
      (e) =>
        buildError(ErrorCode.UNKNOWN_ERROR, "Worktrunk worktree list failed", e),
    ).map((result) => {
      const raw = JSON.parse(result.stdout) as Array<{
        path: string;
        branch?: string;
        commit?: { sha?: string };
      }>;
      return raw.map((entry) => ({
        path: entry.path,
        commit: entry.commit?.sha ?? "",
        branch: entry.branch,
      }));
    });
  }

  return ResultAsync.fromPromise(
    execa("git", ["worktree", "list", "--porcelain"], { cwd: repoPath }),
    (e) => buildError(ErrorCode.UNKNOWN_ERROR, "Git worktree list failed", e),
  ).map((result) => {
    const lines = result.stdout.split("\n").filter(Boolean);
    const entries: WorktreeEntry[] = [];
    let current: Partial<WorktreeEntry> = {};
    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        if (current.path) {
          entries.push(current as WorktreeEntry);
        }
        current = { path: line.slice(9).trim() };
      } else if (line.startsWith("HEAD ")) {
        current.commit = line.slice(5).trim();
      } else if (line.startsWith("branch ")) {
        const ref = line.slice(7).trim();
        current.branch = ref.replace(/^refs\/heads\//, "");
      }
    }
    if (current.path) {
      entries.push(current as WorktreeEntry);
    }
    return entries;
  });
}

/**
 * Registers the `worktree` subcommand with a minimal `list` action.
 */
export function worktreeCommand(program: Command) {
  const worktree = program
    .command("worktree")
    .description("Manage git worktrees for task isolation");

  worktree
    .command("list")
    .description("List active git worktrees")
    .action(async (_options, cmd) => {
      const repoPath = process.cwd();
      const json = rootOpts(cmd).json ?? false;

      const configResult = readConfig(repoPath);
      const backend =
        configResult.isOk() ? resolveWorktreeBackend(configResult.value) : "git";

      if (!json && backend === "worktrunk") {
        try {
          await execa("wt", ["list", "-C", repoPath], {
            cwd: repoPath,
            stdio: "inherit",
          });
        } catch (e) {
          console.error(
            e instanceof Error ? e.message : "Worktrunk list failed",
          );
          process.exit(1);
        }
        return;
      }

      const result = await listWorktrees(repoPath, backend);
      result.match(
        (entries) => {
          if (json) {
            console.log(JSON.stringify(entries));
          } else {
            for (const e of entries) {
              const branchPart = e.branch ? ` [${e.branch}]` : "";
              console.log(`${e.path}  ${e.commit}${branchPart}`);
            }
          }
        },
        (e) => {
          console.error(e.message);
          process.exit(1);
        },
      );
    });
}
