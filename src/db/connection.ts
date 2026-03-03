import execa from "execa";
import { createPool, type Pool, type PoolConnection } from "mysql2/promise";
import { err, errAsync, ok, ResultAsync } from "neverthrow";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { env, getServerConnectionEnv } from "../env";
import { checkoutBranch } from "./branch";

const PROTECTED_TABLES = ["plan", "project", "task", "edge", "event"];
const destructivePattern =
  /\b(DELETE\s+FROM|DROP\s+TABLE|TRUNCATE\s+TABLE?)\s+[`]?(\w+)[`]?/i;

const doltPath = () => env.DOLT_PATH;

const DOLT_EXECA_TIMEOUT_MS = env.DOLT_EXECA_TIMEOUT_MS;

/**
 * Per-repo semaphore state for the execa path.
 * Dolt's noms file storage doesn't support concurrent process access — parallel
 * dolt processes fall back to attempting a TCP server connection (port 3306),
 * which fails when no server is running. Serializing execa calls per-repo
 * prevents the contention without touching the SQL server path (mysql2 handles
 * concurrency natively).
 */
interface ExecaSemaphore {
  running: number;
  queue: Array<() => void>;
}
const execaSemaphores = new Map<string, ExecaSemaphore>();

/** Max wait (ms) to acquire the execa slot before failing. Prevents indefinite hang when another Dolt operation is stuck. */
const EXECA_SLOT_WAIT_TIMEOUT_MS = 60_000;

/** True when Dolt failed because the default/main branch is missing or unresolved (active_branch() nil). */
function isUnresolvedBranchError(e: unknown): boolean {
  const cause =
    e &&
    typeof e === "object" &&
    "cause" in e &&
    (e as { cause: unknown }).cause;
  const raw = cause ?? e;
  const msg =
    typeof (raw as { message?: string })?.message === "string"
      ? (raw as { message: string }).message
      : "";
  const stderr =
    typeof (raw as { stderr?: string })?.stderr === "string"
      ? (raw as { stderr: string }).stderr
      : "";
  const combined = `${msg} ${stderr}`;
  return (
    /cannot resolve default branch/i.test(combined) ||
    /active_branch.*nil|non-string column.*active_branch/i.test(combined)
  );
}

/** Ensure main branch exists so Dolt can resolve the default branch. Idempotent if main already exists. */
async function repairMainBranch(repoPath: string): Promise<void> {
  await execa(doltPath(), ["--data-dir", repoPath, "checkout", "-b", "main"], {
    cwd: repoPath,
    env: {
      ...process.env,
      DOLT_READ_ONLY: "false",
      DOLT_DISABLE_UPDATE_CHECK: "1",
    },
  });
}

function acquireExecaSlot(repoPath: string): Promise<() => void> {
  let sem = execaSemaphores.get(repoPath);
  if (!sem) {
    sem = { running: 0, queue: [] };
    execaSemaphores.set(repoPath, sem);
  }
  const s = sem;
  let tryAcquire!: () => void;
  const acquirePromise = new Promise<() => void>((resolve) => {
    tryAcquire = () => {
      if (s.running === 0) {
        s.running++;
        resolve(() => {
          s.running--;
          const next = s.queue.shift();
          if (next) next();
        });
      } else {
        s.queue.push(tryAcquire);
      }
    };
    tryAcquire();
  });
  const timeoutPromise = new Promise<() => void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      s.queue = s.queue.filter((cb) => cb !== tryAcquire);
      reject(
        buildError(
          ErrorCode.DB_QUERY_FAILED,
          "Dolt operation timed out: another operation may be stuck or the repo is busy. Wait and retry, or check for stuck processes.",
        ),
      );
    }, EXECA_SLOT_WAIT_TIMEOUT_MS);
    void acquirePromise.then((release) => {
      clearTimeout(timeoutId);
      resolve(release);
    });
  });
  return Promise.race([acquirePromise, timeoutPromise]);
}

const SERVER_PORT_ENV = "TG_DOLT_SERVER_PORT";
const SERVER_HOST_ENV = "TG_DOLT_SERVER_HOST";

const poolCache = new Map<string, Pool>();

function getPoolKey(host: string, port: string, database: string): string {
  return `${host}:${port}:${database}`;
}

/**
 * Returns a mysql2 pool for the Dolt SQL server when TG_DOLT_SERVER_PORT is set.
 * Pool is created once per (host, port, database) and cached. Returns null when server mode is not enabled
 * or when TG_DOLT_SERVER_DATABASE is missing/empty (so caller falls back to execa path).
 */
export function getServerPool(): Pool | null {
  const port = process.env[SERVER_PORT_ENV];
  if (!port) return null;
  const database = process.env.TG_DOLT_SERVER_DATABASE ?? "";
  if (database === "") return null;
  const host = process.env[SERVER_HOST_ENV] ?? "127.0.0.1";
  const key = getPoolKey(host, port, database);
  let pool = poolCache.get(key);
  if (!pool) {
    pool = createPool({
      host,
      port: Number.parseInt(port, 10),
      user: process.env.TG_DOLT_SERVER_USER ?? "root",
      password: process.env.TG_DOLT_SERVER_PASSWORD ?? undefined,
      database,
      waitForConnections: true,
      connectionLimit: 10,
      connectTimeout: 5000,
    });
    poolCache.set(key, pool);
  }
  return pool;
}

/**
 * Run a callback with a single server connection, then release it.
 * Use when multiple operations (e.g. write + DOLT_COMMIT) must run on the same
 * connection so Dolt's working set is committed by the session that wrote it.
 * Returns null if server pool is not available.
 */
export async function runWithServerConnection<T>(
  fn: (conn: PoolConnection) => Promise<T>,
): Promise<T | null> {
  const pool = getServerPool();
  if (!pool) return null;
  const conn = await pool.getConnection();
  try {
    return await fn(conn);
  } finally {
    conn.release();
  }
}

/**
 * Close the server pool for the given host/port/database and remove from cache.
 * Used by integration test teardown to release connections before killing the dolt sql-server process.
 */
export async function closeServerPool(
  port: string,
  host: string = "127.0.0.1",
  database: string = "",
): Promise<void> {
  const key = getPoolKey(host, port, database);
  const pool = poolCache.get(key);
  if (pool) {
    poolCache.delete(key);
    await pool.end();
  }
}

/**
 * Close all cached server pools. Called by the CLI after a command completes so
 * the process can exit cleanly instead of hanging on open mysql2 connections.
 */
export async function closeAllServerPools(): Promise<void> {
  const pools = [...poolCache.values()];
  poolCache.clear();
  await Promise.all(pools.map((p) => p.end().catch(() => {})));
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

/**
 * Run a SQL query against the Dolt SQL server with a pinned connection,
 * issuing DOLT_CHECKOUT and the query on the same connection so branch state
 * is guaranteed to be consistent. Using pool.getConnection() + release()
 * rather than two independent pool.query() calls prevents the checkout from
 * landing on connection A while the query runs on connection B.
 */
function doltSqlServerBranch(
  query: string,
  pool: Pool,
  branch: string,
  // biome-ignore lint/suspicious/noExplicitAny: dolt rows same as doltSqlServer
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
    (async () => {
      const conn = await pool.getConnection();
      try {
        await conn.query("CALL DOLT_CHECKOUT(?)", [branch]);
        const [rawRows] = await conn.query(query);
        return rawRows;
      } finally {
        conn.release();
      }
    })(),
    (e) =>
      buildError(
        ErrorCode.DB_QUERY_FAILED,
        `Dolt SQL server query failed (branch ${branch}): ${query}`,
        e,
      ),
  ).andThen((rawRows) => {
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
  const serverEnv = getServerConnectionEnv();
  const port = serverEnv.TG_DOLT_SERVER_PORT;
  if (port) {
    const pool = getServerPool();
    if (pool) {
      const runServer = (): ResultAsync<unknown[], AppError> => {
        if (options?.branch) {
          return doltSqlServerBranch(query, pool, options.branch);
        }
        return doltSqlServer(query, pool);
      };
      return runServer().orElse((e) => {
        const cause =
          e && typeof e === "object" && "cause" in e
            ? (e as AppError).cause
            : e;
        const code =
          cause && typeof cause === "object" && "code" in cause
            ? (cause as NodeJS.ErrnoException).code
            : undefined;
        if (code === "ECONNREFUSED" || code === "ETIMEDOUT") {
          const host = serverEnv.TG_DOLT_SERVER_HOST;
          const database = serverEnv.TG_DOLT_SERVER_DATABASE ?? "";
          console.error(
            `[tg] Dolt SQL server unreachable at ${host}:${port}; falling back to execa.`,
          );
          delete process.env.TG_DOLT_SERVER_PORT;
          delete process.env.TG_DOLT_SERVER_DATABASE;
          return ResultAsync.fromPromise(
            closeServerPool(port, host, database),
            () => e,
          ).andThen(() =>
            options?.branch
              ? checkoutBranch(repoPath, options.branch).andThen(runQuery)
              : runQuery(),
          );
        }
        return errAsync(e);
      });
    }
    // Port set but pool null (e.g. TG_DOLT_SERVER_DATABASE empty) -> fall back to execa path
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
      acquireExecaSlot(repoPath).then((release) =>
        execa(
          doltPath(),
          ["--data-dir", repoPath, "sql", "-q", query, "-r", "json"],
          {
            cwd: repoPath,
            timeout: DOLT_EXECA_TIMEOUT_MS,
            env: {
              ...process.env,
              DOLT_READ_ONLY: "false",
              DOLT_DISABLE_UPDATE_CHECK: "1",
            },
          },
        ).finally(release),
      ),
      (e) => {
        if (
          e &&
          typeof e === "object" &&
          "code" in e &&
          "message" in e &&
          Object.values(ErrorCode).includes((e as AppError).code)
        ) {
          return e as AppError;
        }
        const err = e as NodeJS.ErrnoException & { timedOut?: boolean };
        if (err?.timedOut) {
          return buildError(
            ErrorCode.DB_QUERY_FAILED,
            `Dolt operation timed out after ${DOLT_EXECA_TIMEOUT_MS / 1000} s`,
            e,
          );
        }
        const code = err?.code;
        if (code === "ENOENT") {
          return buildError(
            ErrorCode.DB_QUERY_FAILED,
            `dolt binary not found at "${doltPath()}". ` +
              `Install dolt: https://docs.dolthub.com/getting-started/installation ` +
              `or set the DOLT_PATH environment variable to the dolt binary path.`,
            e,
          );
        }
        const isEperm =
          code === "EPERM" ||
          (e instanceof Error &&
            e.message.toLowerCase().includes("operation not permitted"));
        if (isEperm) {
          return buildError(
            ErrorCode.DB_QUERY_FAILED,
            "Dolt could not run: operation not permitted. Run tg from an environment that allows reading .taskgraph/ and spawning the dolt binary, or fix permissions.",
            e,
          );
        }
        return buildError(
          ErrorCode.DB_QUERY_FAILED,
          `Dolt SQL query failed: ${query}${e instanceof Error ? ` — ${e.message}` : ""}`,
          e,
        );
      },
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

  const runOnce = (): ResultAsync<unknown[], AppError> =>
    options?.branch
      ? checkoutBranch(repoPath, options.branch).andThen(runQuery)
      : runQuery();

  return runOnce().orElse((e) => {
    if (!isUnresolvedBranchError(e)) return errAsync(e);
    return ResultAsync.fromPromise(
      repairMainBranch(repoPath),
      (repairErr) =>
        buildError(
          ErrorCode.DB_QUERY_FAILED,
          "Could not repair Dolt main branch. Try: cd .taskgraph/dolt && dolt checkout -b main",
          repairErr,
        ),
    ).andThen(() => runOnce());
  });
}
