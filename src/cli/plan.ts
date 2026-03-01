import { Command } from "commander";
import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { now, query } from "../db/query";
import type { AppError } from "../domain/errors";
import { type Config, readConfig, rootOpts } from "./utils";

export function planCommand(program: Command) {
  program
    .command("plan")
    .description("Manage plans")
    .addCommand(planNewCommand())
    .addCommand(planListCommand());
}

function planListCommand(): Command {
  return new Command("list")
    .alias("ls")
    .description(
      "List plans (excludes abandoned by default; use --cancelled to show only abandoned)",
    )
    .option(
      "--cancelled",
      "Show only cancelled/abandoned plans instead of active ones",
      false,
    )
    .action(async (options, cmd) => {
      const showCancelled = options.cancelled === true;
      const result = await readConfig().asyncAndThen((config: Config) => {
        const q = query(config.doltRepoPath);
        const statusFilter = showCancelled
          ? "WHERE status = 'abandoned'"
          : "WHERE status != 'abandoned'";
        return q.raw<{
          plan_id: string;
          title: string;
          status: string;
          created_at: string;
        }>(
          `SELECT plan_id, title, status, created_at FROM \`project\` ${statusFilter} ORDER BY \`created_at\` DESC`,
        );
      });

      result.match(
        (plansArray) => {
          if (!rootOpts(cmd).json) {
            if (plansArray.length > 0) {
              const label = showCancelled
                ? "Cancelled/Abandoned Plans:"
                : "Plans:";
              console.log(label);
              plansArray.forEach((p) => {
                console.log(`  ${p.plan_id}  ${p.title}  (${p.status})`);
              });
            } else {
              console.log(
                showCancelled ? "No cancelled plans." : "No plans found.",
              );
            }
          } else {
            console.log(JSON.stringify(plansArray, null, 2));
          }
        },
        (error: AppError) => {
          console.error(`Error listing plans: ${error.message}`);
          if (rootOpts(cmd).json) {
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

function planNewCommand(): Command {
  return new Command("new")
    .description("Create a new plan")
    .argument("<title>", "Title of the plan")
    .option("--intent <intent>", "Intent of the plan", "")
    .option("--source <path>", "Source path (e.g., plans/feature-x.md)")
    .action(async (title, options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        // Removed async, added type
        const plan_id = uuidv4();
        const currentTimestamp = now();

        const q = query(config.doltRepoPath);

        return q
          .insert("project", {
            plan_id,
            title,
            intent: options.intent,
            source_path: options.source ?? null,
            created_at: currentTimestamp,
            updated_at: currentTimestamp,
          })
          .andThen(() =>
            doltCommit(
              `plan: create ${title}`,
              config.doltRepoPath,
              rootOpts(cmd).noCommit,
            ),
          )
          .map(() => ({
            plan_id,
            title,
            intent: options.intent,
            source_path: options.source,
          }));
      });

      result.match(
        (data: unknown) => {
          const resultData = data as {
            plan_id: string;
            title: string;
            intent: string;
            source_path: string | undefined;
          };
          if (!rootOpts(cmd).json) {
            console.log(`Plan created with ID: ${resultData.plan_id}`);
          } else {
            console.log(JSON.stringify(resultData, null, 2));
          }
        },
        (error: AppError) => {
          console.error(`Error creating plan: ${error.message}`);
          if (rootOpts(cmd).json) {
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
