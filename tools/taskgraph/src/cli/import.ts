import { Command } from "commander";
import { readConfig, Config } from "./utils";
import { parsePlanMarkdown, ParsedPlan } from "../plan-import/parser";
import { upsertTasksAndEdges } from "../plan-import/importer";
import { doltCommit } from "../db/commit";
import { v4 as uuidv4 } from "uuid";
import { ResultAsync, ok, err } from "neverthrow";
import { AppError, buildError, ErrorCode } from "../domain/errors";
import { query, now } from "../db/query";

export function importCommand(program: Command) {
  program
    .command("import")
    .description("Import tasks and edges from a markdown plan file")
    .argument(
      "<filePath>",
      "Path to the markdown plan file (e.g., plans/feature-auth.md)",
    )
    .requiredOption(
      "--plan <planTitleOrId>",
      "Title or ID of the plan to associate tasks with",
    )
    .action(async (filePath, options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        const currentTimestamp = now();

        return parsePlanMarkdown(filePath).asyncAndThen((parsedPlan: ParsedPlan) => {
          return ResultAsync.fromPromise(
            (async () => {
              const q = query(config.doltRepoPath);
              const { planTitle, planIntent, tasks: parsedTasks } = parsedPlan;
              let planId: string | null = null;

              // Try to find plan by ID first
              if (
                options.plan.length === 36 &&
                /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
                  options.plan,
                )
              ) {
                const planResult = await q.select<{ plan_id: string }>("plan", { columns: ["plan_id"], where: { plan_id: options.plan } });
                if (planResult.isOk() && planResult.value.length > 0) {
                  planId = planResult.value[0].plan_id;
                }
              }

              // If not found by ID, try to find by title
              if (!planId) {
                const planResult = await q.select<{ plan_id: string }>("plan", { columns: ["plan_id"], where: { title: options.plan } });
                if (planResult.isOk() && planResult.value.length > 0) {
                  planId = planResult.value[0].plan_id;
                }
              }

              // If plan still not found, create a new one
              if (!planId) {
                planId = uuidv4();
                const newPlanTitle = planTitle || options.plan;
                const newPlanIntent = planIntent || `Imported from ${filePath}`;
                const insertResult = await q.insert("plan", {
                  plan_id: planId,
                  title: newPlanTitle,
                  intent: newPlanIntent,
                  source_path: filePath,
                  created_at: currentTimestamp,
                  updated_at: currentTimestamp,
                });
                if (insertResult.isErr()) throw insertResult.error;

                console.log(
                  `Created new plan '${newPlanTitle}' with ID: ${planId}`,
                );
                const commitResult = await doltCommit(
                  `plan: create ${newPlanTitle} from import`,
                  config.doltRepoPath,
                  cmd.parent?.opts().noCommit,
                );
                if (commitResult.isErr()) throw commitResult.error;
              }

              if (!planId) {
                throw buildError(
                  ErrorCode.PLAN_NOT_FOUND,
                  "Could not find or create a plan for the import.",
                );
              }

              const upsertResult = await upsertTasksAndEdges(
                planId,
                parsedTasks,
                config.doltRepoPath,
                cmd.parent?.opts().noCommit,
              );
              if (upsertResult.isErr()) throw upsertResult.error;

              return {
                filePath,
                plan_id: planId,
                importedTasksCount: upsertResult.value.importedTasksCount,
              };
            })(),
            (e) => e as AppError,
          );
        });
      });

      result.match(
        (data: unknown) => {
          const resultData = data as {
            filePath: string;
            plan_id: string;
            importedTasksCount: number;
          };
          if (!cmd.parent?.opts().json) {
            console.log(
              `Successfully imported tasks and edges from ${resultData.filePath} to plan ${resultData.plan_id}.`,
            );
          } else {
            console.log(JSON.stringify(resultData, null, 2));
          }
        },
        (error: AppError) => {
          console.error(
            `Error importing plan from ${filePath}: ${error.message}`,
          );
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
