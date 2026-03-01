import { execa } from "execa";
import { createPool, type Pool } from "mysql2/promise";
import { err, errAsync, ok, ResultAsync } from "neverthrow";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { checkoutBranch } from "./branch";

const PROTECTED_TABLES = ["plan", "project", "task", "edge", "event"];
const destructivePattern =
  /\b(DELETE\s+FROM|DROP\s+TABLE|TRUNCATE\s+TABLE?)\s+[`]?(\w+)[`]?/i;

const doltPath = () => process.env.DOLT_PATH || "dolt";

const SERVER_PORT_ENV = "TG_DOLT_SERVER_PORT";
const SERVER_HOST_ENV = "TG_DOLT_SERVER_HOST";

const poolCache = new Map<string, Pool>();

function getPoolKey(host: string, port: string): string {
  return `${host}:${port}`;
}

/**
 * Returns a mysql2 pool for the Dolt SQL server when TG_DOLT_SERVER_PORT is set.
 * Pool is created once per (host, port) and cached. Returns null when server mode is not enabled.
 */
export function getServerPool(): Pool | null {
  const port = process.env[SERVER_PORT_ENV];
  if (!port) return null;
  const host = process.env[SERVER_HOST_ENV] ?? "127.0.0.1";
  const key = getPoolKey(host, port);
  let pool = poolCache.get(key);
  if (!pool) {
    pool = createPool({
      host,
      port: Number.parseInt(port, 10),
      user: process.env.TG_DOLT_SERVER_USER ?? "root",
      password: process.env.TG_DOLT_SERVER_PASSWORD ?? undefined,
      database: process.env.TG_DOLT_SERVER_DATABASE ?? "",
      waitForConnections: true,
      connectionLimit: 10,
    });
    poolCache.set(key, pool);
  }
  return pool;
}

/**
 * Close the server pool for the given host/port and remove from cache.
 * Used by integration test teardown to release connections before killing the dolt sql-server process.
 */
export async function closeServerPool(
  port: string,
  host: string = "127.0.0.1",
): Promise<void> {
  const key = getPoolKey(host, port);
  const pool = poolCache.get(key);
  if (pool) {
    poolCache.delete(key);
    await pool.end();
  }
}

/**
 * Run a SQL query against the Dolt SQL server via a mysql2 pool.
 * Applies the same protected-tables check as doltSql. Returns rows in the same shape as doltSql (array of row objects).
 */
export function doltSqlServer(
  query: string,
  pool: Pool,
  params?: unknown[],
  // biome-ignore lint/suspicious/noExplicitAny: dolt rows same as doltSql
): ResultAsync<any[], AppError> {
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
    params !== undefined ? pool.query(query, params) : pool.query(query),
    (e) =>
      buildError(
        ErrorCode.DB_QUERY_FAILED,
        `Dolt SQL server query failed: ${query}`,
        e,
      ),
  ).andThen(([rawRows]) => {
    const rows = Array.isArray(rawRows) ? rawRows : [];
    const normalized = rows.map((r) =>
      r && typeof r === "object" && !Array.isArray(r) ? { ...r } : r,
    );
    return ok(normalized);
  });
}

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
  const port = process.env[SERVER_PORT_ENV];
  if (port) {
    const pool = getServerPool();
    if (!pool)
      return errAsync(
        buildError(
          ErrorCode.DB_QUERY_FAILED,
          "Dolt server pool not available",
          undefined,
        ),
      );
    const runServer = (): ResultAsync<any[], AppError> => {
      if (options?.branch) {
        return doltSqlServer("CALL DOLT_CHECKOUT(?)", pool, [
          options.branch,
        ]).andThen(() => doltSqlServer(query, pool));
      }
      return doltSqlServer(query, pool);
    };
    return runServer();
  }

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
