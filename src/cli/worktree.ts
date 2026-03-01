/**
 * Git worktree management for task isolation.
 *
 * Expected repo layout:
 * - repoPath: directory containing .git (and usually .taskgraph). Defaults to process.cwd().
 * - Worktrees are created at .taskgraph/worktrees/<taskId>/ with branch tg/<taskId>.
 */

import * as path from "node:path";
import type { Command } from "commander";
import { execa } from "execa";
import { ResultAsync } from "neverthrow";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { rootOpts } from "./utils";

const WORKTREES_DIR = ".taskgraph/worktrees";
const BRANCH_PREFIX = "tg/";

function worktreePath(repoPath: string, taskId: string): string {
  return path.join(repoPath, WORKTREES_DIR, taskId);
}

export function worktreeBranchName(taskId: string): string {
  return `${BRANCH_PREFIX}${taskId}`;
}

function branchName(taskId: string): string {
  return worktreeBranchName(taskId);
}

/**
 * Creates branch tg/<taskId> and a worktree at .taskgraph/worktrees/<taskId>/.
 * If baseBranch is provided, the new branch is created from it; otherwise from current HEAD.
 *
 * @param taskId - Task identifier (used for branch name and worktree path)
 * @param repoPath - Git repo root (directory containing .git). Defaults to process.cwd()
 * @param baseBranch - Optional branch to create from (e.g. "main")
 */
export function createWorktree(
  taskId: string,
  repoPath: string = process.cwd(),
  baseBranch?: string,
): ResultAsync<string, AppError> {
  const wtPath = worktreePath(repoPath, taskId);
  const branch = branchName(taskId);
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
  ).map(() => wtPath);
}

/**
 * Removes the worktree at .taskgraph/worktrees/<taskId>/ and optionally deletes the branch tg/<taskId>.
 *
 * @param taskId - Task identifier
 * @param repoPath - Git repo root. Defaults to process.cwd()
 * @param deleteBranch - If true, delete the branch tg/<taskId> after removing the worktree
 */
export function removeWorktree(
  taskId: string,
  repoPath: string = process.cwd(),
  deleteBranch: boolean = false,
): ResultAsync<void, AppError> {
  const branch = branchName(taskId);
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
 * Call before removeWorktree when user requests --merge on tg done.
 */
export function mergeWorktreeBranchIntoMain(
  repoPath: string,
  branchName: string,
  mainBranch: string = "main",
): ResultAsync<void, AppError> {
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
 * Returns active git worktrees (main + linked worktrees). Parses `git worktree list`.
 *
 * @param repoPath - Git repo root. Defaults to process.cwd()
 */
export function listWorktrees(
  repoPath: string = process.cwd(),
): ResultAsync<WorktreeEntry[], AppError> {
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
      const result = await listWorktrees(repoPath);
      result.match(
        (entries) => {
          const json = rootOpts(cmd).json ?? false;
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
