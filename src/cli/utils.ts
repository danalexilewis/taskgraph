import type { Command } from "commander";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { doltSql } from "../db/connection";
import { sqlEscape } from "../db/escape";
import { query } from "../db/query";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { isHashId } from "../domain/hash-id";

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i;

/**
 * Resolves a task identifier to a full UUID. Accepts either a UUID or a short hash_id (tg-XXXXXX).
 * If input is a UUID, returns it. If it's a hash_id, looks up task_id in the task table.
 * Errors if 0 or >1 tasks match the hash_id.
 */
export function resolveTaskId(
  input: string,
  repoPath: string,
): ResultAsync<string, AppError> {
  if (UUID_REGEX.test(input)) {
    return okAsync(input);
  }
  if (isHashId(input)) {
    const sql = `SELECT \`task_id\` FROM \`task\` WHERE \`hash_id\` = '${sqlEscape(input)}'`;
    return doltSql(sql, repoPath).andThen((rows: { task_id: string }[]) => {
      if (rows.length === 0) {
        return errAsync(
          buildError(
            ErrorCode.TASK_NOT_FOUND,
            `No task found with hash_id '${input}'`,
          ),
        );
      }
      if (rows.length > 1) {
        return errAsync(
          buildError(
            ErrorCode.VALIDATION_FAILED,
            `Multiple tasks matched hash_id '${input}'`,
          ),
        );
      }
      return okAsync(rows[0].task_id);
    });
  }
  return errAsync(
    buildError(
      ErrorCode.VALIDATION_FAILED,
      "Task ID must be a UUID or a hash id (tg-XXXXXX)",
    ),
  );
}

export type ResolveTaskIdsBatchResult = {
  resolved: { inputId: string; taskId: string }[];
  errors: Map<string, string>;
};

/**
 * Resolve multiple task identifiers to full UUIDs. Runs resolveTaskId for each;
 * returns resolved list and per-input errors (no batch-level failure).
 */
export function resolveTaskIdsBatch(
  ids: string[],
  repoPath: string,
): ResultAsync<ResolveTaskIdsBatchResult, AppError> {
  if (ids.length === 0) {
    return okAsync({ resolved: [], errors: new Map() });
  }
  type SettledItem =
    | { inputId: string; taskId: string; error: null }
    | { inputId: string; taskId: null; error: string };
  const run = async (): Promise<ResolveTaskIdsBatchResult> => {
    const settled: SettledItem[] = await Promise.all(
      ids.map(async (inputId): Promise<SettledItem> => {
        const r = await resolveTaskId(inputId, repoPath);
        return r.match(
          (taskId) => ({ inputId, taskId, error: null } as SettledItem),
          (e) => ({ inputId, taskId: null, error: e.message } as SettledItem),
        );
      }),
    );
    const resolved = settled
      .filter((x): x is { inputId: string; taskId: string; error: null } => x.error === null)
      .map((x) => ({ inputId: x.inputId, taskId: x.taskId }));
    const errors = new Map<string, string>();
    for (const x of settled) {
      if (x.error != null) errors.set(x.inputId, x.error);
    }
    return { resolved, errors };
  };
  return ResultAsync.fromPromise(
    run(),
    (e) => buildError(ErrorCode.UNKNOWN_ERROR, (e as Error).message),
  );
}

/**
 * Returns the agent branch name for a task if it was started with --branch (from the latest started event body).
 */
export function getStartedEventBranch(
  taskId: string,
  repoPath: string,
): ResultAsync<string | null, AppError> {
  const sql = `SELECT body FROM \`event\` WHERE task_id = '${sqlEscape(taskId)}' AND kind = 'started' ORDER BY created_at DESC LIMIT 1`;
  return doltSql(sql, repoPath).map((rows: { body: string | object }[]) => {
    const row = rows[0];
    if (!row?.body) return null;
    const raw = row.body;
    let parsed: { branch?: string };
    try {
      parsed =
        typeof raw === "string"
          ? (JSON.parse(raw) as { branch?: string })
          : (raw as { branch?: string });
    } catch {
      return null;
    }
    let branch = parsed?.branch ?? null;
    if (
      typeof branch === "string" &&
      branch.startsWith('"') &&
      branch.endsWith('"')
    ) {
      try {
        branch = JSON.parse(branch) as string;
      } catch {
        /* leave as-is */
      }
    }
    return branch ?? null;
  });
}

/**
 * Returns worktree path and branch for a task if it was started with --worktree (from the latest started event body).
 */
export function getStartedEventWorktree(
  taskId: string,
  doltRepoPath: string,
): ResultAsync<
  {
    worktree_path: string;
    worktree_branch: string;
    worktree_repo_root?: string;
  } | null,
  AppError
> {
  const sql = `SELECT body FROM \`event\` WHERE task_id = '${sqlEscape(taskId)}' AND kind = 'started' ORDER BY created_at DESC LIMIT 1`;
  return doltSql(sql, doltRepoPath).map((rows: { body: string | object }[]) => {
    const row = rows[0];
    if (!row?.body) return null;
    const raw = row.body;
    let parsed: {
      worktree_path?: string;
      worktree_branch?: string;
      worktree_repo_root?: string;
    };
    try {
      parsed =
        typeof raw === "string"
          ? (JSON.parse(raw) as {
              worktree_path?: string;
              worktree_branch?: string;
              worktree_repo_root?: string;
            })
          : (raw as {
              worktree_path?: string;
              worktree_branch?: string;
              worktree_repo_root?: string;
            });
    } catch {
      return null;
    }
    if (
      typeof parsed?.worktree_path === "string" &&
      typeof parsed?.worktree_branch === "string"
    ) {
      // Dolt sometimes double-encodes JSON string values; unwrap if needed
      const unwrap = (v: string): string =>
        v.startsWith('"') ? (JSON.parse(v) as string) : v;
      return {
        worktree_path: unwrap(parsed.worktree_path),
        worktree_branch: unwrap(parsed.worktree_branch),
        worktree_repo_root:
          parsed.worktree_repo_root != null
            ? unwrap(parsed.worktree_repo_root)
            : undefined,
      };
    }
    return null;
  });
}

/** Row shape for batch task load (task_id, status, hash_id, plan_id). */
export interface TaskRowForBatch {
  task_id: string;
  status: string;
  hash_id: string | null;
  plan_id: string;
}

/**
 * Loads task rows for a set of task_ids in one query. Returns rows keyed by task_id.
 * Used by the batch start path to avoid N single-row selects. Read-only.
 */
export function loadTasksByIds(
  repoPath: string,
  taskIds: string[],
): ResultAsync<Map<string, TaskRowForBatch>, AppError> {
  if (taskIds.length === 0) {
    return okAsync(new Map());
  }
  const q = query(repoPath);
  const idList = taskIds.map((id) => `'${sqlEscape(id)}'`).join(",");
  const sql = `SELECT task_id, status, hash_id, plan_id FROM \`task\` WHERE task_id IN (${idList})`;
  return q.raw<TaskRowForBatch>(sql).map((rows) => {
    const map = new Map<string, TaskRowForBatch>();
    for (const r of rows) {
      map.set(r.task_id, r);
    }
    return map;
  });
}

export type { Config } from "../config";
export { readConfig, writeConfig } from "../config";

/**
 * Normalize raw string[] from Commander (variadic args) into a flat list of IDs.
 * Splits each element on comma, trims, drops empty strings.
 * Callers should exit with a clear error if the result is empty.
 */
export function parseIdList(raw: string[]): string[] {
  return raw.flatMap((s) =>
    s
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  );
}

/**
 * Format an error cause for CLI stderr: one short line, no stack.
 * Use when surfacing AppError.cause so implementers see the underlying failure.
 */
export function formatCauseForCLI(cause: unknown): string {
  if (cause instanceof Error) {
    return ` Cause: ${cause.message ?? String(cause)}`;
  }
  return ` Cause: ${String(cause)}`;
}

/** Walk to root command to access global options like --json */
export function rootOpts(cmd: Command): { json?: boolean; noCommit?: boolean } {
  let c: Command | undefined = cmd;
  while (c?.parent) c = c.parent;
  return (c?.opts?.() ?? {}) as { json?: boolean; noCommit?: boolean };
}

/**
 * Returns true if JSON output should be used for a command.
 * When stdout is not a TTY (piped output or agent environment), defaults to JSON
 * so callers do not need to pass --json explicitly in automation.
 * Explicit --json flag always takes precedence when present.
 */
export function shouldUseJson(cmd: Command): boolean {
  return rootOpts(cmd).json === true || !process.stdout.isTTY;
}
