import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { Command } from "commander";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { generateDotGraph } from "../export/dot";
import { generateMarkdown } from "../export/markdown";
import { generateMermaidGraph } from "../export/mermaid";
import { type Config, readConfig } from "./utils";

export function exportCommand(program: Command) {
  program
    .command("export")
    .description("Export graph visualizations and markdown")
    .addCommand(exportMermaidCommand())
    .addCommand(exportDotCommand())
    .addCommand(exportMarkdownCommand());
}

function exportMermaidCommand(): Command {
  return new Command("mermaid")
    .description("Output Mermaid graph TD text to stdout")
    .option("--plan <planId>", "Filter by plan ID")
    .option("--feature <featureKey>", "Filter by feature key")
    .action(async (options, cmd) => {
      const result = await readConfig().asyncAndThen((_config: Config) => {
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
      const result = await readConfig().asyncAndThen((_config: Config) => {
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

function exportMarkdownCommand(): Command {
  return new Command("markdown")
    .description(
      "Export plan and tasks in Cursor format to exports/ (never overwrites plans/)",
    )
    .requiredOption("--plan <planId>", "Plan ID to export")
    .option(
      "--out <path>",
      "Write to this path (default: exports/<planId>.md). Cannot write into plans/.",
    )
    .action(async (options, cmd) => {
      const outPath = options.out
        ? resolve(process.cwd(), options.out)
        : resolve(process.cwd(), "exports", `${options.plan}.md`);
      const plansDir = resolve(process.cwd(), "plans");
      if (outPath.startsWith(plansDir + sep)) {
        const err = buildError(
          ErrorCode.VALIDATION_FAILED,
          "Export cannot write to plans/; use exports/ or another directory to avoid overwriting plan files.",
        );
        console.error(`Error: ${err.message}`);
        if (cmd.parent?.opts().json) {
          console.log(
            JSON.stringify({
              status: "error",
              code: err.code,
              message: err.message,
            }),
          );
          process.exit(1);
          return;
        }
      }

      const result = await generateMarkdown(options.plan);

      result.match(
        (markdown: string) => {
          mkdirSync(dirname(outPath), { recursive: true });
          writeFileSync(outPath, markdown);
          if (!cmd.parent?.opts().json) {
            console.log(`Exported to ${outPath}`);
          }
        },
        (error: AppError) => {
          console.error(`Error exporting markdown: ${error.message}`);
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
