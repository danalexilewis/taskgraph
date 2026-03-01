import { existsSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import { execa } from "execa";
import { ResultAsync } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { doltSql } from "../db/connection";
import { sqlEscape } from "../db/escape";
import {
  applyCycleMigration,
  applyDefaultInitiativeMigration,
  applyInitiativeCycleIdMigration,
  applyInitiativeMigration,
  applyMigrations,
  applyNoDeleteTriggersMigration,
  applyPlanRichFieldsMigration,
  applyPlanToProjectRenameMigration,
  applyPlanViewMigration,
  applyTaskDimensionsMigration,
  applyTaskDomainSkillJunctionMigration,
  applyTaskSuggestedChangesMigration,
} from "../db/migrate";
import { now, query } from "../db/query";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { writeConfig } from "./utils";
import { isWorktrunkAvailable } from "./worktree";

const TASKGRAPH_DIR = ".taskgraph";
const CONFIG_FILE = path.join(TASKGRAPH_DIR, "config.json");

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Interactive first-time setup: cycle name, dates, initiative names. Skips when !isTTY or cycle already exists. */
async function runInteractiveSetupIfNeeded(
  doltRepoPath: string,
  noCommit: boolean,
): Promise<void> {
  if (!process.stdout.isTTY) return;
  const countResult = await doltSql(
    "SELECT COUNT(*) AS c FROM `cycle`",
    doltRepoPath,
  );
  if (countResult.isErr() || (countResult.value as { c: number }[])[0]?.c > 0)
    return;

  const clack = await import("@clack/prompts");
  const { intro, outro, text } = clack;
  intro("Task Graph setup");

  const cycleName = (await text({
    message: "Name your first cycle",
    placeholder: "Sprint 1",
    defaultValue: "Sprint 1",
  })) as string | symbol;
  if (clack.isCancel(cycleName)) {
    console.log(
      "Setup skipped. Run `tg cycle new` and `tg initiative new` to set up manually.",
    );
    process.exit(0);
  }

  const startDate = (await text({
    message: "Cycle start date (YYYY-MM-DD)",
    placeholder: todayISO(),
    defaultValue: todayISO(),
    validate: (v) =>
      /^\d{4}-\d{2}-\d{2}$/.test(String(v))
        ? undefined
        : "Use YYYY-MM-DD format",
  })) as string | symbol;
  if (clack.isCancel(startDate)) {
    console.log(
      "Setup skipped. Run `tg cycle new` and `tg initiative new` to set up manually.",
    );
    process.exit(0);
  }

  const weeksText = (await text({
    message: "Cycle length in weeks",
    placeholder: "2",
    defaultValue: "2",
    validate: (v) => (Number(v) > 0 ? undefined : "Must be a positive number"),
  })) as string | symbol;
  if (clack.isCancel(weeksText)) {
    console.log(
      "Setup skipped. Run `tg cycle new` and `tg initiative new` to set up manually.",
    );
    process.exit(0);
  }

  const weeks = Number(weeksText);
  const start = new Date(String(startDate));
  const end = new Date(start);
  end.setDate(end.getDate() + weeks * 7);
  const endDate = end.toISOString().slice(0, 10);

  const initiativeNamesRaw = (await text({
    message: "Name your initiatives (comma-separated)",
    placeholder: "Core Foundation, Agent Workflow, Platform",
  })) as string | symbol;
  if (clack.isCancel(initiativeNamesRaw)) {
    console.log(
      "Setup skipped. Run `tg cycle new` and `tg initiative new` to set up manually.",
    );
    process.exit(0);
  }

  const cycleId = uuidv4();
  const q = query(doltRepoPath);
  const ts = now();
  const insertCycle = `INSERT INTO \`cycle\` (cycle_id, name, start_date, end_date, created_at, updated_at) VALUES ('${cycleId}', '${sqlEscape(String(cycleName))}', '${sqlEscape(String(startDate))}', '${sqlEscape(endDate)}', '${sqlEscape(ts)}', '${sqlEscape(ts)}')`;
  const insertRes = await doltSql(insertCycle, doltRepoPath);
  if (insertRes.isErr()) return;
  const names = String(initiativeNamesRaw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const title of names) {
    const initId = uuidv4();
    const ir = await q.insert("initiative", {
      initiative_id: initId,
      title,
      description: "",
      status: "active",
      cycle_start: String(startDate),
      cycle_end: endDate,
      cycle_id: cycleId,
      created_at: now(),
      updated_at: now(),
    });
    if (ir.isErr()) return;
  }
  const commitRes = await doltCommit(
    "init: interactive setup — cycle and initiatives",
    doltRepoPath,
    noCommit,
  );
  if (commitRes.isErr()) return;
  outro("Done! Run `tg status` to see your cycle.");
}

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
        .andThen(() => applyInitiativeMigration(doltRepoPath, options.noCommit))
        .andThen(() =>
          applyPlanToProjectRenameMigration(doltRepoPath, options.noCommit),
        )
        .andThen(() => applyPlanViewMigration(doltRepoPath, options.noCommit))
        .andThen(() =>
          applyDefaultInitiativeMigration(doltRepoPath, options.noCommit),
        )
        .andThen(() => applyCycleMigration(doltRepoPath, options.noCommit))
        .andThen(() =>
          applyInitiativeCycleIdMigration(doltRepoPath, options.noCommit),
        )
        .andThen(() => {
          const remoteUrl = options.remoteUrl ?? options.remote;
          const config = {
            doltRepoPath: doltRepoPath,
            learningMode: true,
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

      if (initResult.isOk()) {
        await runInteractiveSetupIfNeeded(doltRepoPath, options.noCommit);
      }
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
