import { Command } from "commander";
import { generateMermaidGraph } from "../export/mermaid";
import { generateDotGraph } from "../export/dot";
import { readConfig } from "./utils";
import { ResultAsync } from "neverthrow";
import { AppError } from "../domain/errors";
import { Config } from "./utils";

export function exportCommand(program: Command) {
  program
    .command("export")
    .description("Export graph visualizations")
    .addCommand(exportMermaidCommand())
    .addCommand(exportDotCommand());
}

function exportMermaidCommand(): Command {
  return new Command("mermaid")
    .description("Output Mermaid graph TD text to stdout")
    .option("--plan <planId>", "Filter by plan ID")
    .option("--feature <featureKey>", "Filter by feature key")
    .action(async (options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        // Removed config.doltRepoPath from generateMermaidGraph call
        return generateMermaidGraph(options.plan, options.feature);
      });

      result.match(
        (mermaidGraph: string) => {
          console.log(mermaidGraph);
        },
        (error: AppError) => {
          console.error(`Error generating Mermaid graph: ${error.message}`);
          if (cmd.parent?.opts().json) {
            console.log(
              JSON.stringify({
                status: "error",
                code: error.code,
                message: error.message,
                cause: error.cause,
              }),
            );
          }
          process.exit(1);
        },
      );
    });
}

function exportDotCommand(): Command {
  return new Command("dot")
    .description("Output Graphviz DOT text to stdout")
    .option("--plan <planId>", "Filter by plan ID")
    .option("--feature <featureKey>", "Filter by feature key")
    .action(async (options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        // Removed config.doltRepoPath from generateDotGraph call
        return generateDotGraph(options.plan, options.feature);
      });

      result.match(
        (dotGraph: string) => {
          console.log(dotGraph);
        },
        (error: AppError) => {
          console.error(`Error generating DOT graph: ${error.message}`);
          if (cmd.parent?.opts().json) {
            console.log(
              JSON.stringify({
                status: "error",
                code: error.code,
                message: error.message,
                cause: error.cause,
              }),
            );
          }
          process.exit(1);
        },
      );
    });
}
