import { execa } from "execa";
import { err, errAsync, ok, ResultAsync } from "neverthrow";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { checkoutBranch } from "./branch";

const PROTECTED_TABLES = ["plan", "task", "edge", "event"];
const destructivePattern =
  /\b(DELETE\s+FROM|DROP\s+TABLE|TRUNCATE\s+TABLE?)\s+[`]?(\w+)[`]?/i;

const doltPath = () => process.env.DOLT_PATH || "dolt";

export interface DoltSqlOptions {
  /** When set, checkout this branch before running the query (connection context). */
  branch?: string;
}

/**
 * Run SQL against the Dolt repo. Uses --data-dir so the repo is explicit
 * (avoids connecting to a running server or wrong cwd). Passes DOLT_READ_ONLY=false
 * so Dolt treats the session as writable when the repo allows it.
 * Optional `options.branch`: checkout that branch before the query so SQL runs on that branch.
 */
export function doltSql(
  query: string,
  repoPath: string,
  options?: DoltSqlOptions,
  // biome-ignore lint/suspicious/noExplicitAny: dolt JSON rows untyped; callers cast
): ResultAsync<any[], AppError> {
  // biome-ignore lint/suspicious/noExplicitAny: dolt rows same
  const runQuery = (): ResultAsync<any[], AppError> => {
    const match = query.match(destructivePattern);
    if (match && PROTECTED_TABLES.includes(match[2].toLowerCase())) {
      return errAsync(
        buildError(
          ErrorCode.VALIDATION_FAILED,
          `Hard deletes are forbidden on table '${match[2]}'. Use tg cancel for soft-delete.`,
        ),
      );
    }
    return ResultAsync.fromPromise(
      execa(
        doltPath(),
        ["--data-dir", repoPath, "sql", "-q", query, "-r", "json"],
        {
          cwd: repoPath,
          env: {
            ...process.env,
            DOLT_READ_ONLY: "false",
          },
        },
      ),
      (e) =>
        buildError(
          ErrorCode.DB_QUERY_FAILED,
          `Dolt SQL query failed: ${query}`,
          e,
        ),
    ).andThen((result) => {
      const out = (result.stdout || "").trim();
      if (!out) return ok([]); // DML (INSERT/UPDATE/DELETE) returns no JSON
      try {
        const parsed = JSON.parse(out);
        return ok(parsed?.rows ?? []);
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
  };

  if (options?.branch) {
    return checkoutBranch(repoPath, options.branch).andThen(runQuery);
  }
  return runQuery();
}
