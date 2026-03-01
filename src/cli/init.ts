import { existsSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import { execa } from "execa";
import { ResultAsync } from "neverthrow";
import {
  applyMigrations,
  applyNoDeleteTriggersMigration,
  applyPlanRichFieldsMigration,
  applyTaskDimensionsMigration,
  applyTaskDomainSkillJunctionMigration,
  applyTaskSuggestedChangesMigration,
} from "../db/migrate";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { writeConfig } from "./utils";
import { isWorktrunkAvailable } from "./worktree";

const TASKGRAPH_DIR = ".taskgraph";
const CONFIG_FILE = path.join(TASKGRAPH_DIR, "config.json");

/** Build a user-friendly hint when init fails (e.g. dolt not found). */
function initFailureHint(cause: unknown): string {
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    const msg = cause.message ?? String(cause);
    if (code === "ENOENT" || /not found|command not found/i.test(msg)) {
      return " Dolt may not be installed or not on PATH. Install it (e.g. brew install dolt) and ensure you run tg from your repo (e.g. npx tg init or pnpm exec tg init).";
    }
    return ` Cause: ${msg}`;
  }
  return ` Cause: ${String(cause)}`;
}

export function initCommand(program: Command) {
  program
    .command("init")
    .description("Initializes the Dolt repository and applies migrations")
    .option("--no-commit", "Do not commit changes to Dolt", false)
    .option(
      "--remote-url <url>",
      "Dolt remote URL (stored in config for future tg sync)",
    )
    .option("--remote <url>", "Alias for --remote-url")
    .action(async (options, cmd) => {
      const repoPath = process.cwd();
      const taskGraphPath = path.join(repoPath, TASKGRAPH_DIR);
      const doltRepoPath = path.join(taskGraphPath, "dolt");

      const initResult = await ResultAsync.fromPromise(
        (async (): Promise<void> => {
          if (!existsSync(taskGraphPath)) {
            mkdirSync(taskGraphPath);
          }

          if (!existsSync(doltRepoPath)) {
            // Create the doltRepoPath directory before initializing Dolt
            mkdirSync(doltRepoPath, { recursive: true });
            console.log(`Creating Dolt repository at ${doltRepoPath}...`);
            await execa(process.env.DOLT_PATH || "dolt", ["init"], {
              cwd: doltRepoPath,
            }); // Changed cwd to doltRepoPath
            console.log("Dolt repository created.");
          } else {
            console.log(`Dolt repository already exists at ${doltRepoPath}.`);
          }
          return Promise.resolve(); // Explicitly return a Promise<void>
        })(), // Invoked the async IIFE
        (e) =>
          buildError(
            ErrorCode.DB_QUERY_FAILED,
            "Failed to initialize Dolt repository",
            e,
          ),
      )
        .andThen(() => applyMigrations(doltRepoPath, options.noCommit))
        .andThen(() =>
          applyTaskDimensionsMigration(doltRepoPath, options.noCommit),
        )
        .andThen(() =>
          applyPlanRichFieldsMigration(doltRepoPath, options.noCommit),
        )
        .andThen(() =>
          applyTaskSuggestedChangesMigration(doltRepoPath, options.noCommit),
        )
        .andThen(() =>
          applyTaskDomainSkillJunctionMigration(doltRepoPath, options.noCommit),
        )
        .andThen(() =>
          applyNoDeleteTriggersMigration(doltRepoPath, options.noCommit),
        )
        .andThen(() => {
          const remoteUrl = options.remoteUrl ?? options.remote;
          const config = {
            doltRepoPath: doltRepoPath,
            learningMode: false,
            ...(remoteUrl != null && remoteUrl !== "" ? { remoteUrl } : {}),
            ...(isWorktrunkAvailable() ? { useWorktrunk: true } : {}),
          };
          // Use a valid ErrorCode, e.g., UNKNOWN_ERROR
          return writeConfig(config, repoPath).mapErr(
            (
              e, // Pass repoPath as basePath
            ) =>
              buildError(ErrorCode.UNKNOWN_ERROR, "Failed to write config", e),
          );
        });

      initResult.match(
        () => {
          if (!cmd.parent?.opts().json) {
            console.log(`Configuration written to ${CONFIG_FILE}`);
            console.log("Task Graph initialized successfully.");
            console.log("");
            console.log("Next steps:");
            console.log(
              "  1. Install Bun for test running: npm i -g bun (or brew install oven-sh/bun/bun)",
            );
            console.log(
              "  2. Run: pnpm tg setup   — scaffold docs and (optionally) Cursor rules/agents with --cursor",
            );
          }
          // ... rest of the match block remains the same
        },
        (error: unknown) => {
          const appError = error as AppError;
          console.error(`Error initializing Task Graph: ${appError.message}`);
          if (!cmd.parent?.opts().json && appError.cause != null) {
            console.error(initFailureHint(appError.cause));
          }
          if (cmd.parent?.opts().json) {
            console.log(
              JSON.stringify({
                status: "error",
                code: appError.code,
                message: appError.message,
                cause: appError.cause,
              }),
            );
          }
          process.exit(1);
        },
      );
    });
}
