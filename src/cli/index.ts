import { Command } from "commander";
import { closeAllServerPools } from "../db/connection";
import { ensureMigrations } from "../db/migrate";
import { ErrorCode } from "../domain/errors";
import { agentsCommand } from "./agents";
import { blockCommand } from "./block";
import { cancelCommand } from "./cancel";
import { contextCommand } from "./context";
import { crossplanCommand } from "./crossplan";
import { cycleCommand } from "./cycle";
import { dashboardCommand } from "./dashboard";
import { doneCommand } from "./done";
import { edgeCommand } from "./edge";
import { evolveCommand } from "./evolve-health";
import { exportCommand } from "./export";
import { gateCommand } from "./gate";
import { importCommand } from "./import";
import { initCommand } from "./init";
import { initiativeCommand } from "./initiative";
import { nextCommand } from "./next";
import { noteCommand } from "./note";
import { planCommand } from "./plan";
import { portfolioCommand } from "./portfolio";
import { recoverCommand } from "./recover";
import { detectAndApplyServerPort, probePort, serverCommand } from "./server";
import { setupCommand } from "./setup";
import { showCommand } from "./show";
import { splitCommand } from "./split";
import { startCommand } from "./start";
import { statsCommand } from "./stats";
import { statusCommand } from "./status";
import { syncCommand } from "./sync";
import { taskCommand } from "./task";
import { templateCommand } from "./template";
import { readConfig, rootOpts } from "./utils";
import { worktreeCommand } from "./worktree";

/** Commands that create or scaffold; skip auto-migrate (no config or own migration path). */
const SKIP_MIGRATE_COMMANDS = new Set(["init", "setup", "server"]);

const MIGRATION_CHECK_TIMEOUT_MS = 60_000;

function topLevelCommand(cmd: Command): Command {
  let c: Command = cmd;
  while (c.parent?.parent) {
    c = c.parent;
  }
  return c;
}

export function createProgram(): Command {
  const program = new Command();

  program.hook("preAction", async (_thisCommand, actionCommand) => {
    const top = topLevelCommand(actionCommand);
    if (SKIP_MIGRATE_COMMANDS.has(top.name())) {
      return;
    }
    // Skip migrations when TG_SKIP_MIGRATE is set (used in tests)
    if (process.env.TG_SKIP_MIGRATE) {
      console.warn("[tg] Skipping migrations (TG_SKIP_MIGRATE set)");
      return;
    }
    const configResult = readConfig();
    if (configResult.isErr()) {
      if (configResult.error.code === ErrorCode.CONFIG_NOT_FOUND) {
        return;
      }
      return;
    }
    await detectAndApplyServerPort(configResult.value);
    if (process.env.TG_DOLT_SERVER_PORT) {
      try {
        await probePort(Number(process.env.TG_DOLT_SERVER_PORT), 500);
      } catch {
        const host = process.env.TG_DOLT_SERVER_HOST ?? "127.0.0.1";
        const port = process.env.TG_DOLT_SERVER_PORT;
        console.error(
          `[tg] Dolt SQL server unreachable at ${host}:${port}; falling back to execa.`,
        );
        delete process.env.TG_DOLT_SERVER_PORT;
        delete process.env.TG_DOLT_SERVER_DATABASE;
      }
    }
    const opts = rootOpts(actionCommand);
    const noCommit = opts.noCommit ?? false;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error("Migration check timed out after 60 s")),
        MIGRATION_CHECK_TIMEOUT_MS,
      );
    });
    try {
      const runResult = await Promise.race([
        ensureMigrations(configResult.value.doltRepoPath, noCommit),
        timeoutPromise,
      ]);
      runResult.match(
        () => {},
        (e) => {
          console.error(`Migration failed: ${e.message}`);
          process.exit(1);
        },
      );
    } catch (e) {
      console.error(
        e instanceof Error ? e.message : "Migration check timed out after 60 s",
      );
      process.exit(1);
    }
  });

  program
    .name("tg")
    .description("Task Graph CLI for Centaur Development")
    .version("3.0.0")
    .option("--json", "Output machine-readable JSON", false)
    .option("--no-commit", "Do not commit changes to Dolt", false)
    .option("--commit-msg <msg>", "Override default commit message");

  initCommand(program);
  setupCommand(program);
  planCommand(program);
  taskCommand(program);
  edgeCommand(program);
  nextCommand(program);
  showCommand(program);
  startCommand(program);
  doneCommand(program);
  blockCommand(program);
  cancelCommand(program);
  splitCommand(program);
  statsCommand(program);
  exportCommand(program);
  gateCommand(program);
  portfolioCommand(program);
  recoverCommand(program);
  importCommand(program);
  statusCommand(program);
  dashboardCommand(program);
  evolveCommand(program);
  noteCommand(program);
  agentsCommand(program);
  contextCommand(program);
  crossplanCommand(program);
  cycleCommand(program);
  initiativeCommand(program);
  templateCommand(program);
  worktreeCommand(program);
  syncCommand(program);
  serverCommand(program);

  return program;
}

const isMainEntrypoint =
  process.argv[1]?.endsWith("cli/index.js") ||
  process.argv[1]?.endsWith("cli/index.ts");

if (isMainEntrypoint) {
  createProgram()
    .parseAsync(process.argv)
    .then(() => closeAllServerPools())
    .then(() => {
      process.exitCode = 0;
    })
    .catch(() => process.exit(1));
}
