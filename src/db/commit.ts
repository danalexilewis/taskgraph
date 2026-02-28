import { execa } from "execa";
import { ResultAsync } from "neverthrow";
import { type AppError, buildError, ErrorCode } from "../domain/errors";

const doltPath = () => process.env.DOLT_PATH || "dolt";

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
  const dolt = doltPath();
  const doltEnv = { ...process.env, DOLT_READ_ONLY: "false" };
  return ResultAsync.fromPromise(
    execa(dolt, ["--data-dir", repoPath, "add", "-A"], {
      cwd: repoPath,
      env: doltEnv,
    }),
    (e) =>
      buildError(
        ErrorCode.DB_COMMIT_FAILED,
        `Dolt add failed before commit: ${msg}`,
        e,
      ),
  )
    .andThen(() => {
      return ResultAsync.fromPromise(
        execa(
          dolt,
          ["--data-dir", repoPath, "commit", "-m", msg, "--allow-empty"],
          {
            cwd: repoPath,
            env: doltEnv,
          },
        ),
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
