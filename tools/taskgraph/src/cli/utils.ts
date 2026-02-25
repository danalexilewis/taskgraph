import { readFileSync, writeFileSync, existsSync } from "fs";
import * as path from "path";
import { Result, ok, err } from "neverthrow";
import { AppError, ErrorCode, buildError } from "../domain/errors";

const TASKGRAPH_DIR = ".taskgraph";
const CONFIG_FILE = path.join(TASKGRAPH_DIR, "config.json");

export interface Config {
  doltRepoPath: string;
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

export function writeConfig(config: Config, basePath?: string): Result<void, AppError> {
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
