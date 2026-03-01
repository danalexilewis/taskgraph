import type { Command } from "commander";
import { ResultAsync } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { now, query, type SqlValue } from "../db/query";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import {
  computeUnmatchedExistingTasks,
  upsertTasksAndEdges,
} from "../plan-import/importer";
import {
  type ParsedPlan,
  parseCursorPlan,
  parsePlanMarkdown,
} from "../plan-import/parser";
import { cancelOne } from "./cancel";
import { type Config, readConfig } from "./utils";

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
    .option(
      "--format <format>",
      "Plan format: 'legacy' (TASK:/TITLE:/BLOCKED_BY:) or 'cursor' (YAML frontmatter with todos). Default: legacy",
      "legacy",
    )
    .option(
      "--external-key-prefix <prefix>",
      "Optional prefix for task external_key to avoid collisions (e.g. when importing historical plans that share todo ids)",
    )
    .option(
      "--no-suggest",
      "Disable auto-suggestion of docs/skills from file patterns (default: suggest enabled)",
    )
    .option(
      "--force",
      "Proceed with import even when existing tasks would be unmatched (may create duplicates)",
    )
    .option(
      "--replace",
      "Cancel existing tasks that would not be matched by this import, then upsert",
    )
    .action(async (filePath, options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        const currentTimestamp = now();
        const parseResult =
          options.format === "cursor"
            ? parseCursorPlan(filePath)
            : parsePlanMarkdown(filePath);

        return parseResult.asyncAndThen((parsedPlan: ParsedPlan) => {
          return ResultAsync.fromPromise(
            (async () => {
              const q = query(config.doltRepoPath);
              const {
                planTitle,
                planIntent,
                tasks: parsedTasks,
                fileTree,
                risks,
                tests,
              } = parsedPlan;
              let planId: string | null = null;
              let planJustCreated = false;

              // Try to find plan by ID first
              if (
                options.plan.length === 36 &&
                /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
                  options.plan,
                )
              ) {
                const planResult = await q.select<{ plan_id: string }>(
                  "project",
                  {
                    columns: ["plan_id"],
                    where: { plan_id: options.plan },
                  },
                );
                if (planResult.isOk() && planResult.value.length > 0) {
                  planId = planResult.value[0].plan_id;
                }
              }

              // If not found by ID, try to find by title
              if (!planId) {
                const planResult = await q.select<{ plan_id: string }>(
                  "project",
                  {
                    columns: ["plan_id"],
                    where: { title: options.plan },
                  },
                );
                if (planResult.isOk() && planResult.value.length > 0) {
                  planId = planResult.value[0].plan_id;
                }
              }

              // If plan still not found, create a new one
              if (!planId) {
                planJustCreated = true;
                planId = uuidv4();
                const newPlanTitle = planTitle || options.plan;
                const newPlanIntent = planIntent || `Imported from ${filePath}`;
                const insertPayload: Record<string, SqlValue> = {
                  plan_id: planId,
                  title: newPlanTitle,
                  intent: newPlanIntent,
                  source_path: filePath,
                  created_at: currentTimestamp,
                  updated_at: currentTimestamp,
                };
                if (options.format === "cursor") {
                  if (fileTree != null) insertPayload.file_tree = fileTree;
                  if (risks != null)
                    insertPayload.risks = JSON.stringify(risks);
                  if (tests != null)
                    insertPayload.tests = JSON.stringify(tests);
                }
                const insertResult = await q.insert("project", insertPayload);
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

              if (
                options.format === "cursor" &&
                (fileTree != null || risks != null || tests != null)
              ) {
                const planUpdatePayload: Record<string, SqlValue> = {
                  updated_at: currentTimestamp,
                };
                if (fileTree != null) planUpdatePayload.file_tree = fileTree;
                if (risks != null)
                  planUpdatePayload.risks = JSON.stringify(risks);
                if (tests != null)
                  planUpdatePayload.tests = JSON.stringify(tests);
                const planUpdateResult = await q.update(
                  "project",
                  planUpdatePayload,
                  { plan_id: planId },
                );
                if (planUpdateResult.isErr()) throw planUpdateResult.error;
              }

              // Pre-flight: when plan already had tasks, check for unmatched
              if (!planJustCreated) {
                const unmatchedResult = await computeUnmatchedExistingTasks(
                  planId,
                  parsedTasks,
                  config.doltRepoPath,
                  options.externalKeyPrefix,
                );
                if (unmatchedResult.isErr()) throw unmatchedResult.error;
                const { unmatchedTaskIds, unmatchedExternalKeys = [] } =
                  unmatchedResult.value;
                if (
                  unmatchedTaskIds.length > 0 &&
                  !options.force &&
                  !options.replace
                ) {
                  const sample = unmatchedExternalKeys.slice(0, 10);
                  const more =
                    unmatchedExternalKeys.length > 10
                      ? ` (and ${unmatchedExternalKeys.length - 10} more)`
                      : "";
                  throw buildError(
                    ErrorCode.VALIDATION_FAILED,
                    `Import would leave ${unmatchedTaskIds.length} existing task(s) unmatched: ${sample.join(", ")}${more}. Use --force to import anyway (may create duplicates) or --replace to cancel those tasks first.`,
                  );
                }
                if (unmatchedTaskIds.length > 0 && options.replace) {
                  for (const taskId of unmatchedTaskIds) {
                    const cancelResult = await cancelOne(
                      taskId,
                      config,
                      { type: "task" },
                      cmd,
                    );
                    if (cancelResult.isErr()) throw cancelResult.error;
                  }
                }
              }

              const upsertResult = await upsertTasksAndEdges(
                planId,
                parsedTasks,
                config.doltRepoPath,
                cmd.parent?.opts().noCommit,
                options.externalKeyPrefix,
                fileTree ?? null,
                options.suggest !== false,
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
