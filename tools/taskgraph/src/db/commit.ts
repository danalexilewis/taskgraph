import { execa } from "execa";
import { ResultAsync } from "neverthrow";
import { AppError, ErrorCode, buildError } from "../domain/errors";

export function doltCommit(
  msg: string,
  repoPath: string,
  noCommit: boolean = false,
): ResultAsync<void, AppError> {
  if (noCommit) {
    return ResultAsync.fromPromise(Promise.resolve(), () =>
      buildError(ErrorCode.DB_COMMIT_FAILED, "Dry run commit failed"),
    );
  }
  return ResultAsync.fromPromise(
    execa("dolt", ["add", "-A"], { cwd: repoPath }),
    (e) =>
      buildError(
        ErrorCode.DB_COMMIT_FAILED,
        `Dolt add failed before commit: ${msg}`,
        e,
      ),
  )
    .andThen(() => {
      return ResultAsync.fromPromise(
        execa("dolt", ["commit", "-m", msg, "--allow-empty"], {
          cwd: repoPath,
        }),
        (e) =>
          buildError(
            ErrorCode.DB_COMMIT_FAILED,
            `Dolt commit failed: ${msg}`,
            e,
          ),
      );
    })
    .map(() => undefined);
}
