import { execa } from "execa";
import { ResultAsync } from "neverthrow";
import { type AppError, buildError, ErrorCode } from "../domain/errors";

const doltPath = () => process.env.DOLT_PATH || "dolt";

const doltEnv = () => ({ ...process.env, DOLT_READ_ONLY: "false" });

/**
 * Create a new branch in the Dolt repo. Branch is created from current HEAD.
 */
export function createBranch(
  repoPath: string,
  branchName: string,
): ResultAsync<void, AppError> {
  return ResultAsync.fromPromise(
    execa(doltPath(), ["--data-dir", repoPath, "branch", branchName], {
      cwd: repoPath,
      env: doltEnv(),
    }),
    (e) =>
      buildError(
        ErrorCode.DB_QUERY_FAILED,
        `Dolt branch create failed: ${branchName}`,
        e,
      ),
  ).map(() => undefined);
}

/**
 * Check out an existing branch in the Dolt repo.
 */
export function checkoutBranch(
  repoPath: string,
  branchName: string,
): ResultAsync<void, AppError> {
  return ResultAsync.fromPromise(
    execa(doltPath(), ["--data-dir", repoPath, "checkout", branchName], {
      cwd: repoPath,
      env: doltEnv(),
    }),
    (e) =>
      buildError(
        ErrorCode.DB_QUERY_FAILED,
        `Dolt checkout failed: ${branchName}`,
        e,
      ),
  ).map(() => undefined);
}

/**
 * Merge a branch into the current branch. Caller should checkout main (or target) first.
 * On merge conflict, returns an error and leaves the repo in conflicted state; do not delete the branch.
 */
export function mergeBranch(
  repoPath: string,
  branchName: string,
): ResultAsync<void, AppError> {
  return ResultAsync.fromPromise(
    execa(doltPath(), ["--data-dir", repoPath, "merge", branchName], {
      cwd: repoPath,
      env: doltEnv(),
    }),
    (e) =>
      buildError(
        ErrorCode.DB_QUERY_FAILED,
        `Dolt merge failed (conflicts or other error). Resolve manually and merge branch '${branchName}' into main, then delete the branch.`,
        e,
      ),
  ).map(() => undefined);
}

/**
 * Delete a branch. Fails if branch is current or has unmerged changes (caller should merge first).
 */
export function deleteBranch(
  repoPath: string,
  branchName: string,
): ResultAsync<void, AppError> {
  return ResultAsync.fromPromise(
    execa(doltPath(), ["--data-dir", repoPath, "branch", "-d", branchName], {
      cwd: repoPath,
      env: doltEnv(),
    }),
    (e) =>
      buildError(
        ErrorCode.DB_QUERY_FAILED,
        `Dolt branch delete failed: ${branchName}`,
        e,
      ),
  ).map(() => undefined);
}

const DEFAULT_MAIN_BRANCH = "main";

/**
 * Merge an agent branch into main and delete the branch. Call when completing a task that was started with --branch.
 * If merge has conflicts, returns an error and does not delete the branch (leave for manual resolution).
 */
export function mergeAgentBranchIntoMain(
  repoPath: string,
  agentBranchName: string,
  mainBranch: string = DEFAULT_MAIN_BRANCH,
): ResultAsync<void, AppError> {
  return checkoutBranch(repoPath, mainBranch)
    .andThen(() => mergeBranch(repoPath, agentBranchName))
    .andThen(() => deleteBranch(repoPath, agentBranchName));
}
