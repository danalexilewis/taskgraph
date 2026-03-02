import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { err, ok, type Result } from "neverthrow";
import { type AppError, buildError, ErrorCode } from "./domain/errors";

const TASKGRAPH_DIR = ".taskgraph";
const CONFIG_FILE = path.join(TASKGRAPH_DIR, "config.json");

export interface Config {
  doltRepoPath: string;
  learningMode?: boolean;
  /** Optional token budget for `tg context` output. Number or null = unlimited. Typical: 4000–8000. */
  context_token_budget?: number | null;
  /** Branch to merge agent branches into (default: main). Used when tg done runs after tg start --branch. */
  mainBranch?: string;
  /** When true, tg start auto-creates agent branches (same as --branch). Default false. */
  useDoltBranches?: boolean;
  /** Use Worktrunk (wt) for worktree ops when true; raw git when false; auto-detect when undefined. */
  useWorktrunk?: boolean;
  /** Optional Dolt remote URL for push/pull (used by tg sync when implemented). */
  remoteUrl?: string;
  /** Strategic cycle length (e.g. { weeks: 16 }). Used for initiative planning. */
  strategicCycle?: { weeks: number };
  /** Query result cache TTL in milliseconds. 0 = disabled (default). Dashboard mode uses 1500ms floor regardless. */
  queryCacheTtlMs?: number;
  /** Path to agent-context SQLite DB (default: .taskgraph/agent_context.db). */
  agentContextDbPath?: string;
  breadcrumbPolicy?: {
    /**
     * "all"     = check .breadcrumbs.json for every file touched
     * "touched" = check only for files the agent explicitly edits (default when omitted)
     * "none"    = skip breadcrumb checks entirely
     */
    readScope?: "all" | "touched" | "none";
    /**
     * "all"         = always drop a breadcrumb after any fix
     * "non_obvious" = only after non-obvious fixes (default when omitted)
     * "none"        = never drop breadcrumbs
     */
    dropScope?: "all" | "non_obvious" | "none";
  };
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
