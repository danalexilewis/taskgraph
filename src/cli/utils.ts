import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import {
  err,
  errAsync,
  ok,
  okAsync,
  type Result,
  type ResultAsync,
} from "neverthrow";
import { doltSql } from "../db/connection";
import { sqlEscape } from "../db/escape";
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

const TASKGRAPH_DIR = ".taskgraph";

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

/** Walk to root command to access global options like --json */
export function rootOpts(cmd: Command): { json?: boolean; noCommit?: boolean } {
  let c: Command | undefined = cmd;
  while (c?.parent) c = c.parent;
  return (c?.opts?.() ?? {}) as { json?: boolean; noCommit?: boolean };
}
const CONFIG_FILE = path.join(TASKGRAPH_DIR, "config.json");

export interface Config {
  doltRepoPath: string;
  learningMode?: boolean;
  /** Optional token budget for `tg context` output. Number or null = unlimited. Typical: 4000–8000. */
  context_token_budget?: number | null;
}

export function readConfig(basePath?: string): Result<Config, AppError> {
  const configPath = path.join(basePath ?? process.cwd(), CONFIG_FILE);
  if (!existsSync(configPath)) {
    return err(
      buildError(
        ErrorCode.CONFIG_NOT_FOUND,
        `Config file not found at ${configPath}. Please run 'tg init' first.`,
      ),
    );
  }
  try {
    const configContents = readFileSync(configPath, "utf-8");
    return ok(JSON.parse(configContents));
  } catch (e) {
    return err(
      buildError(
        ErrorCode.CONFIG_PARSE_FAILED,
        `Failed to parse config file at ${configPath}`,
        e,
      ),
    );
  }
}

export function writeConfig(
  config: Config,
  basePath?: string,
): Result<void, AppError> {
  const configPath = path.join(basePath ?? process.cwd(), CONFIG_FILE);
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    return ok(undefined);
  } catch (e) {
    return err(
      buildError(
        ErrorCode.CONFIG_PARSE_FAILED,
        `Failed to write config file to ${configPath}`,
        e,
      ),
    );
  }
}
