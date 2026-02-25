import { execa } from "execa";
import { ResultAsync, err, ok } from "neverthrow";
import { AppError, ErrorCode, buildError } from "../domain/errors";

export function doltSql(
  query: string,
  repoPath: string,
): ResultAsync<any[], AppError> {
  return ResultAsync.fromPromise(
    execa("dolt", ["sql", "-q", query, "-r", "json"], { cwd: repoPath }),
    (e) =>
      buildError(
        ErrorCode.DB_QUERY_FAILED,
        `Dolt SQL query failed: ${query}`,
        e,
      ),
  ).andThen((result) => {
    try {
      return ok(JSON.parse(result.stdout)?.rows ?? []);
    } catch (e) {
      return err(
        buildError(
          ErrorCode.DB_PARSE_FAILED,
          `Failed to parse Dolt SQL output: ${result.stdout}`,
          e,
        ),
      );
    }
  });
}
