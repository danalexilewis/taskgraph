import { Command } from "commander";
import { initCommand } from "./init";
import { planCommand } from "./plan";
import { taskCommand } from "./task";
import { edgeCommand } from "./edge";
import { nextCommand } from "./next";
import { showCommand } from "./show";
import { startCommand } from "./start";
import { doneCommand } from "./done";
import { blockCommand } from "./block";
import { splitCommand } from "./split";
import { exportCommand } from "./export";
import { portfolioCommand } from "./portfolio";
import { importCommand } from "./import";

const program = new Command();

program
  .name("tg")
  .description("Task Graph CLI for Centaur Development")
  .version("0.1.0")
  .option("--json", "Output machine-readable JSON", false)
  .option("--no-commit", "Do not commit changes to Dolt", false)
  .option("--commit-msg <msg>", "Override default commit message");

initCommand(program);
planCommand(program);
taskCommand(program);
edgeCommand(program);
nextCommand(program);
showCommand(program);
startCommand(program);
doneCommand(program);
blockCommand(program);
splitCommand(program);
exportCommand(program);
portfolioCommand(program);
importCommand(program);

program.parse(process.argv);
