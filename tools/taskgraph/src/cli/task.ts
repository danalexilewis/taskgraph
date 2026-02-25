import { Command } from "commander";
import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { readConfig, Config } from "./utils"; // Import Config
import { ResultAsync, ok, err, errAsync } from "neverthrow"; // Import errAsync
import { AppError, buildError, ErrorCode } from "../domain/errors";
import { TaskStatusSchema, Task } from "../domain/types";
import { query, now, jsonObj } from "../db/query";

export function taskCommand(program: Command) {
  program
    .command("task")
    .description("Manage tasks")
    .addCommand(taskNewCommand());
}

function taskNewCommand(): Command {
  return new Command("new")
    .description("Create a new task")
    .argument("<title>", "Title of the task")
    .requiredOption("--plan <planId>", "ID of the parent plan") // Changed to requiredOption
    .option("--feature <featureKey>", "Feature key for portfolio analysis")
    .option("--area <area>", "Area of the task (e.g., frontend, backend)")
    .option("--acceptance <json>", "JSON array of acceptance checks")
    .action(async (title, options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        // Removed async, added type
        const task_id = uuidv4();
        const currentTimestamp = now();

        const q = query(config.doltRepoPath);

        let acceptanceJson: JsonObj | null = null;
        if (options.acceptance) {
          try {
            const parsedAcceptance = JSON.parse(options.acceptance);
            acceptanceJson = jsonObj({ val: options.acceptance });
          } catch (e: unknown) {
            return errAsync(
              buildError(
                ErrorCode.VALIDATION_FAILED,
                `Invalid JSON for acceptance criteria: ${options.acceptance}`,
                e as Error,
              ),
            );
          }
        }

        return q
          .insert("task", {
            task_id,
            plan_id: options.plan,
            feature_key: options.feature ?? null,
            title,
            area: options.area ?? null,
            acceptance: acceptanceJson,
            created_at: currentTimestamp,
            updated_at: currentTimestamp,
          })
          .andThen(() => {
            return q.insert("event", {
              event_id: uuidv4(),
              task_id,
              kind: "created",
              body: jsonObj({ title }),
              created_at: currentTimestamp,
            });
          })
          .andThen(() =>
            doltCommit(
              `task: create ${task_id} - ${title}`,
              config.doltRepoPath,
              cmd.parent?.opts().noCommit,
            ),
          )
          .map(() => ({
            task_id,
            plan_id: options.plan,
            title,
            feature_key: options.feature,
            area: options.area,
          }));
      });

      result.match(
        (data: unknown) => {
          // Type unknown
          const resultData = data as Task; // Cast to Task
          if (!cmd.parent?.opts().json) {
            console.log(
              `Task created with ID: ${resultData.task_id} for Plan ID: ${resultData.plan_id}`,
            );
          } else {
            console.log(JSON.stringify(resultData, null, 2));
          }
        },
        (error: AppError) => {
          // Type AppError
          console.error(`Error creating task: ${error.message}`);
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
