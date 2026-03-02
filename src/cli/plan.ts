import { Command } from "commander";
import { errAsync } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { now, query } from "../db/query";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { type Config, readConfig, rootOpts } from "./utils";

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i;

export function planCommand(program: Command) {
  program
    .command("plan")
    .description("Manage plans")
    .addCommand(planNewCommand())
    .addCommand(planListCommand())
    .addCommand(planSetPriorityCommand());
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

function planSetPriorityCommand(): Command {
  return new Command("set-priority")
    .description(
      "Set priority for a plan (1 = most important, shown first in status/dashboard; lower number = higher in queue)",
    )
    .argument("<planIdOrTitle>", "Plan ID (UUID) or exact project title")
    .argument("<priority>", "Priority value (integer)", (val) =>
      parseInt(val, 10),
    )
    .action(async (planIdOrTitle, priority, _options, cmd) => {
      if (Number.isNaN(priority)) {
        console.error("Priority must be an integer.");
        process.exit(1);
      }
      const result = await readConfig().asyncAndThen((config: Config) => {
        const q = query(config.doltRepoPath);
        const resolve = UUID_REGEX.test(planIdOrTitle)
          ? q.select<{ plan_id: string }>("project", {
              columns: ["plan_id"],
              where: { plan_id: planIdOrTitle },
            })
          : q.select<{ plan_id: string }>("project", {
              columns: ["plan_id"],
              where: { title: planIdOrTitle },
            });
        return resolve.andThen((rows) => {
          if (rows.length === 0) {
            return errAsync(
              buildError(
                ErrorCode.VALIDATION_FAILED,
                `No plan found for '${planIdOrTitle}'`,
              ),
            );
          }
          if (rows.length > 1) {
            return errAsync(
              buildError(
                ErrorCode.VALIDATION_FAILED,
                `Multiple plans matched '${planIdOrTitle}'`,
              ),
            );
          }
          const planId = rows[0].plan_id;
          return q
            .update(
              "project",
              { priority, updated_at: now() },
              { plan_id: planId },
            )
            .andThen(() =>
              doltCommit(
                `plan: set-priority ${planIdOrTitle} -> ${priority}`,
                config.doltRepoPath,
                rootOpts(cmd).noCommit,
              ),
            )
            .map(() => ({ plan_id: planId, priority }));
        });
      });

      result.match(
        (data: unknown) => {
          const d = data as { plan_id: string; priority: number };
          if (!rootOpts(cmd).json) {
            console.log(`Priority set to ${d.priority} for plan ${d.plan_id}`);
          } else {
            console.log(JSON.stringify(d, null, 2));
          }
        },
        (error: AppError) => {
          console.error(`Error setting priority: ${error.message}`);
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
