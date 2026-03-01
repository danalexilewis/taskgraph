import type { Command } from "commander";
import { errAsync } from "neverthrow";
import { sqlEscape } from "../db/escape";
import { query } from "../db/query";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { type Config, readConfig } from "./utils";

export function nextCommand(program: Command) {
  program
    .command("next")
    .description("Select runnable tasks")
    .option("--plan <planId>", "Optional filter by plan ID or title")
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
      const result = await readConfig().asyncAndThen((config: Config) => {
        const limit = parseInt(options.limit, 10);
        if (Number.isNaN(limit) || limit <= 0) {
          return errAsync(
            buildError(
              ErrorCode.VALIDATION_FAILED,
              `Invalid limit: ${options.limit}. Must be a positive integer.`,
            ),
          ); // Changed to errAsync
        }

        const q = query(config.doltRepoPath);

        let planFilter = "";
        if (options.plan) {
          const isUUID =
            /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
              options.plan,
            );
          if (isUUID) {
            planFilter = `AND p.plan_id = '${sqlEscape(options.plan)}'`;
          } else {
            planFilter = `AND p.title = '${sqlEscape(options.plan)}'`;
          }
        }
        let domainFilter = "";
        if (options.domain) {
          domainFilter = `AND EXISTS (SELECT 1 FROM \`task_doc\` td WHERE td.task_id = t.task_id AND td.doc = '${sqlEscape(options.domain)}')`;
        }
        let skillFilter = "";
        if (options.skill) {
          skillFilter = `AND EXISTS (SELECT 1 FROM \`task_skill\` ts WHERE ts.task_id = t.task_id AND ts.skill = '${sqlEscape(options.skill)}')`;
        }
        let changeTypeFilter = "";
        if (options.changeType) {
          changeTypeFilter = `AND t.\`change_type\` = '${sqlEscape(options.changeType)}'`;
        }

        const excludeCanceledAbandoned = options.all
          ? ""
          : " AND t.status != 'canceled' AND p.status != 'abandoned' ";

        const nextTasksQuery = `
          SELECT t.task_id, t.hash_id, t.title, p.title as plan_title, t.risk, t.estimate_mins,
            (SELECT COUNT(*) FROM \`edge\` e 
             JOIN \`task\` bt ON e.from_task_id = bt.task_id 
             WHERE e.to_task_id = t.task_id AND e.type = 'blocks' 
             AND bt.status NOT IN ('done','canceled')) as unmet_blockers
          FROM \`task\` t
          JOIN \`project\` p ON t.plan_id = p.plan_id
          WHERE t.status = 'todo'
          ${planFilter}
          ${domainFilter}
          ${skillFilter}
          ${changeTypeFilter}
          ${excludeCanceledAbandoned}
          HAVING unmet_blockers = 0
          ORDER BY p.priority DESC, t.risk ASC, 
            CASE WHEN t.estimate_mins IS NULL THEN 1 ELSE 0 END,
            t.estimate_mins ASC, t.created_at ASC
          LIMIT ${limit}
        `;

        return q.raw(nextTasksQuery);
      });

      result.match(
        (tasks: unknown) => {
          const tasksArray = tasks as Array<{
            task_id: string;
            hash_id: string | null;
            title: string;
            plan_title: string;
            risk: string;
            estimate_mins: number;
          }>;
          if (!cmd.parent?.opts().json) {
            if (tasksArray.length > 0) {
              console.log("Runnable Tasks:");
              tasksArray.forEach((task) => {
                const id = task.hash_id ?? task.task_id;
                console.log(
                  `  ID: ${id}, Title: ${task.title}, Plan: ${task.plan_title}, Risk: ${task.risk}, Estimate: ${task.estimate_mins ?? "N/A"}`,
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
