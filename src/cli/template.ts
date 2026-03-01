import type { Command } from "commander";
import { ResultAsync } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { now, query, type SqlValue } from "../db/query";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { loadAndSubstituteTemplate } from "../domain/template-schema";
import {
  computeUnmatchedExistingTasks,
  upsertTasksAndEdges,
} from "../plan-import/importer";
import type { ParsedPlan } from "../plan-import/parser";
import { cancelOne } from "./cancel";
import { type Config, readConfig, rootOpts } from "./utils";

/** Parse --var key=value pairs into a record. Invalid entries are skipped. */
function parseVarPairs(pairs: string[] | undefined): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!pairs || !Array.isArray(pairs)) return vars;
  for (const p of pairs) {
    const idx = p.indexOf("=");
    if (idx > 0) {
      const key = p.slice(0, idx).trim();
      const value = p.slice(idx + 1).trim();
      if (key) vars[key] = value;
    }
  }
  return vars;
}

export function templateCommand(program: Command) {
  const template = program
    .command("template")
    .description("Apply plan templates with variable substitution");

  template
    .command("apply")
    .description(
      "Read a template YAML file, substitute variables, and create a plan and tasks in Dolt",
    )
    .argument("<file>", "Template YAML file (Cursor plan frontmatter format)")
    .requiredOption("--plan <name>", "Plan name for the created plan and tasks")
    .option(
      "--var <pairs...>",
      "Variable substitutions as key=value (e.g. --var feature=auth --var area=backend)",
    )
    .option(
      "--force",
      "Proceed with apply even when existing tasks would be unmatched (may create duplicates)",
    )
    .option(
      "--replace",
      "Cancel existing tasks that would not be matched by this apply, then upsert",
    )
    .action(
      async (
        file: string,
        options: {
          plan: string;
          var?: string[];
          force?: boolean;
          replace?: boolean;
        },
        cmd,
      ) => {
        const vars = parseVarPairs(options.var);
        const result = await readConfig().asyncAndThen((config: Config) => {
          const loadResult = loadAndSubstituteTemplate(file, vars);
          return loadResult.asyncAndThen((parsedPlan: ParsedPlan) => {
            return ResultAsync.fromPromise(
              (async () => {
                const currentTimestamp = now();
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
                const planName = options.plan;

                // Try to find plan by ID first
                if (
                  planName.length === 36 &&
                  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
                    planName,
                  )
                ) {
                  const planResult = await q.select<{ plan_id: string }>(
                    "project",
                    {
                      columns: ["plan_id"],
                      where: { plan_id: planName },
                    },
                  );
                  if (planResult.isOk() && planResult.value.length > 0) {
                    planId = planResult.value[0].plan_id;
                  }
                }

                // If not found by ID, try by title
                if (!planId) {
                  const planResult = await q.select<{ plan_id: string }>(
                    "project",
                    {
                      columns: ["plan_id"],
                      where: { title: planName },
                    },
                  );
                  if (planResult.isOk() && planResult.value.length > 0) {
                    planId = planResult.value[0].plan_id;
                  }
                }

                // If still not found, create new plan
                if (!planId) {
                  planJustCreated = true;
                  planId = uuidv4();
                  const newPlanTitle = planTitle ?? planName;
                  const newPlanIntent =
                    planIntent ?? `Applied from template ${file}`;
                  const insertPayload: Record<string, SqlValue> = {
                    plan_id: planId,
                    title: newPlanTitle,
                    intent: newPlanIntent,
                    source_path: file,
                    created_at: currentTimestamp,
                    updated_at: currentTimestamp,
                  };
                  if (fileTree != null) insertPayload.file_tree = fileTree;
                  if (risks != null)
                    insertPayload.risks = JSON.stringify(risks);
                  if (tests != null)
                    insertPayload.tests = JSON.stringify(tests);
                  const insertResult = await q.insert("project", insertPayload);
                  if (insertResult.isErr()) throw insertResult.error;

                  if (!rootOpts(cmd).json) {
                    console.log(
                      `Created new plan '${newPlanTitle}' with ID: ${planId}`,
                    );
                  }
                  const commitResult = await doltCommit(
                    `plan: create ${newPlanTitle} from template apply`,
                    config.doltRepoPath,
                    cmd.parent?.opts().noCommit,
                  );
                  if (commitResult.isErr()) throw commitResult.error;
                }

                // Pre-flight: when plan already had tasks, check for unmatched (mirror import)
                if (!planJustCreated && planId) {
                  const unmatchedResult = await computeUnmatchedExistingTasks(
                    planId,
                    parsedTasks,
                    config.doltRepoPath,
                    undefined,
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
                      `Apply would leave ${unmatchedTaskIds.length} existing task(s) unmatched: ${sample.join(", ")}${more}. Use --force to apply anyway (may create duplicates) or --replace to cancel those tasks first.`,
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
                  undefined,
                  fileTree ?? null,
                  true,
                );
                if (upsertResult.isErr()) throw upsertResult.error;

                return {
                  filePath: file,
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
            if (!rootOpts(cmd).json) {
              console.log(
                `Successfully applied template ${resultData.filePath} to plan ${resultData.plan_id} (${resultData.importedTasksCount} tasks).`,
              );
            } else {
              console.log(JSON.stringify(resultData, null, 2));
            }
          },
          (error: AppError) => {
            console.error(
              `Error applying template from ${file}: ${error.message}`,
            );
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
      },
    );
}
