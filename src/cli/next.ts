import type { Command } from "commander";
import { TgClient } from "../api";
import type { AppError } from "../domain/errors";
import { recoverStaleTasks } from "./recover";
import { readConfig, shouldUseJson } from "./utils";

export function nextCommand(program: Command) {
  program
    .command("next")
    .description("Select runnable tasks")
    .option("--plan <planId>", "Optional filter by project ID or title")
    .option(
      "--domain <domain>",
      "Filter by task domain (maps to docs/<domain>.md)",
    )
    .option(
      "--skill <skill>",
      "Filter by task skill (maps to docs/skills/<skill>.md)",
    )
    .option(
      "--change-type <type>",
      "Filter by change type: create, modify, refactor, fix, investigate, test, document",
    )
    .option("--limit <limit>", "Limit the number of tasks returned", "10")
    .option("--all", "Include canceled tasks and abandoned plans")
    .action(async (options, cmd) => {
      const configForRecover = readConfig();
      if (configForRecover.isOk()) {
        const recovered = await recoverStaleTasks(
          configForRecover.value.doltRepoPath,
          2,
        );
        if (recovered.isOk() && recovered.value.length > 0) {
          process.stderr.write(
            `Recovered ${recovered.value.length} stale task(s) back to todo.\n`,
          );
        }
      }

      const client = new TgClient();
      const result = await client.next({
        plan: options.plan,
        domain: options.domain,
        skill: options.skill,
        changeType: options.changeType,
        limit: parseInt(options.limit, 10),
        all: options.all,
      });

      const json = shouldUseJson(cmd);
      result.match(
        (tasksArray) => {
          if (!json) {
            if (tasksArray.length > 0) {
              console.log("Runnable Tasks:");
              tasksArray.forEach((task) => {
                const id = task.hash_id ?? task.task_id;
                console.log(
                  `  ID: ${id}, Title: ${task.title}, Project: ${task.plan_title}, Risk: ${task.risk}, Estimate: ${task.estimate_mins ?? "N/A"}`,
                );
              });
            } else {
              console.log("No runnable tasks found.");
            }
          } else {
            console.log(JSON.stringify(tasksArray, null, 2));
          }
        },
        (error: AppError) => {
          console.error(`Error fetching next tasks: ${error.message}`);
          if (json) {
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
