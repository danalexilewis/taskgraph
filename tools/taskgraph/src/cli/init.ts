import { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { execa } from "execa";
import { applyMigrations } from "../db/migrate";
import * as path from "path";
import { readConfig, writeConfig } from "./utils";
import { ResultAsync } from "neverthrow";
import { AppError, buildError, ErrorCode } from "../domain/errors";

const TASKGRAPH_DIR = ".taskgraph";
const CONFIG_FILE = path.join(TASKGRAPH_DIR, "config.json");

export function initCommand(program: Command) {
  program
    .command("init")
    .description("Initializes the Dolt repository and applies migrations")
    .option("--no-commit", "Do not commit changes to Dolt", false)
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
            await execa("dolt", ["init"], { cwd: doltRepoPath }); // Changed cwd to doltRepoPath
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
        .andThen(() => {
          const config = {
            doltRepoPath: doltRepoPath,
          };
          // Use a valid ErrorCode, e.g., UNKNOWN_ERROR
          return writeConfig(config, repoPath).mapErr((e) => // Pass repoPath as basePath
            buildError(ErrorCode.UNKNOWN_ERROR, "Failed to write config", e),
          );
        });

      initResult.match(
        () => {
          if (!cmd.parent?.opts().json) {
            console.log(`Configuration written to ${CONFIG_FILE}`);
            console.log("Task Graph initialized successfully.");
          }
          // ... rest of the match block remains the same
        },
        (error: unknown) => {
          const appError = error as AppError;
          console.error(`Error initializing Task Graph: ${appError.message}`); // Used appError.message
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
