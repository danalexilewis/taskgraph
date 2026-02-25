import { Command } from "commander";
import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { readConfig, Config } from "./utils"; // Import Config
import { ResultAsync } from "neverthrow";
import { AppError, buildError, ErrorCode } from "../domain/errors";
import { query, now } from "../db/query";

export function planCommand(program: Command) {
  program
    .command("plan")
    .description("Manage plans")
    .addCommand(planNewCommand());
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
          .insert("plan", {
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
              cmd.parent?.opts().noCommit,
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
          if (!cmd.parent?.opts().json) {
            console.log(`Plan created with ID: ${resultData.plan_id}`);
          } else {
            console.log(JSON.stringify(resultData, null, 2));
          }
        },
        (error: AppError) => {
          console.error(`Error creating plan: ${error.message}`);
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
