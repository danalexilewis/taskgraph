import { Command } from "commander";
import { ensureMigrations } from "../db/migrate";
import { ErrorCode } from "../domain/errors";
import { blockCommand } from "./block";
import { cancelCommand } from "./cancel";
import { contextCommand } from "./context";
import { crossplanCommand } from "./crossplan";
import { dashboardCommand } from "./dashboard";
import { doneCommand } from "./done";
import { edgeCommand } from "./edge";
import { exportCommand } from "./export";
import { gateCommand } from "./gate";
import { importCommand } from "./import";
import { initCommand } from "./init";
import { nextCommand } from "./next";
import { noteCommand } from "./note";
import { planCommand } from "./plan";
import { portfolioCommand } from "./portfolio";
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

const program = new Command();

/** Commands that create or scaffold; skip auto-migrate (no config or own migration path). */
const SKIP_MIGRATE_COMMANDS = new Set(["init", "setup"]);

function topLevelCommand(cmd: Command): Command {
  let c: Command = cmd;
  while (c.parent?.parent) {
    c = c.parent;
  }
  return c;
}

program.hook("preAction", async (_thisCommand, actionCommand) => {
  const top = topLevelCommand(actionCommand);
  if (SKIP_MIGRATE_COMMANDS.has(top.name())) {
    return;
  }
  const configResult = readConfig();
  if (configResult.isErr()) {
    if (configResult.error.code === ErrorCode.CONFIG_NOT_FOUND) {
      return;
    }
    return;
  }
  const opts = rootOpts(actionCommand);
  const noCommit = opts.noCommit ?? false;
  const runResult = await ensureMigrations(
    configResult.value.doltRepoPath,
    noCommit,
  );
  runResult.match(
    () => {},
    (e) => {
      console.error(`Migration failed: ${e.message}`);
      process.exit(1);
    },
  );
});

program
  .name("tg")
  .description("Task Graph CLI for Centaur Development")
  .version("0.1.0")
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
importCommand(program);
statusCommand(program);
dashboardCommand(program);
noteCommand(program);
contextCommand(program);
crossplanCommand(program);
templateCommand(program);
worktreeCommand(program);
syncCommand(program);

program.parse(process.argv);
