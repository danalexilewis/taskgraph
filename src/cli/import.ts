import type { Command } from "commander";
import { err, ok, type Result, ResultAsync } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { sqlEscape } from "../db/escape";
import { tableExists } from "../db/migrate";
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
import { getStatusCache } from "./status-cache";
import { type Config, readConfig } from "./utils";

/** Default "Unassigned" initiative ID when --initiative is omitted. */
const UNASSIGNED_INITIATIVE_ID = "00000000-0000-4000-8000-000000000000";

/** Resolve initiative by ID or title to initiative_id. Returns error if not found. */
async function resolveInitiativeId(
  repoPath: string,
  value: string,
): Promise<Result<string, AppError>> {
  const q = query(repoPath);
  const escaped = sqlEscape(value.trim());
  const rowResult = await q.raw<{ initiative_id: string }>(
    `SELECT initiative_id FROM \`initiative\` WHERE initiative_id = '${escaped}' OR title = '${escaped}' LIMIT 1`,
  );
  if (rowResult.isErr()) return err(rowResult.error);
  const rows = rowResult.value;
  if (rows.length === 0) {
    return err(
      buildError(
        ErrorCode.VALIDATION_FAILED,
        `Initiative not found: '${value}'. Use an existing initiative ID or title from \`tg initiative list\`.`,
      ),
    );
  }
  return ok(rows[0].initiative_id);
}

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
    .option("--benchmark", "Mark imported plan as benchmark")
    .option(
      "--replace",
      "Cancel existing tasks that would not be matched by this import, then upsert",
    )
    .option(
      "--initiative <id>",
      "Initiative ID to assign the project to. When omitted, project.initiative_id is set to the default Unassigned initiative.",
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
              const hasProject = await tableExists(
                config.doltRepoPath,
                "project",
              ).then((r) => (r.isOk() ? r.value : false));
              const tableName = hasProject ? "project" : "plan";

              const {
                planTitle,
                planIntent,
                tasks: parsedTasks,
                fileTree,
                risks,
                tests,
                overview,
                objectives,
                outcomes,
                outputs,
                initiative: planInitiative,
              } = parsedPlan;
              const isBenchmark =
                options.benchmark === true || parsedPlan.benchmark === true;
              let planId: string | null = null;
              let planJustCreated = false;

              // Resolve initiative when using project table: plan frontmatter > CLI --initiative > Unassigned
              let effectiveInitiativeId: string | undefined;
              if (tableName === "project") {
                if (
                  planInitiative != null &&
                  typeof planInitiative === "string" &&
                  planInitiative.trim() !== ""
                ) {
                  const resolved = await resolveInitiativeId(
                    config.doltRepoPath,
                    planInitiative,
                  );
                  if (resolved.isErr()) throw resolved.error;
                  effectiveInitiativeId = resolved.value;
                } else if (
                  options.initiative != null &&
                  options.initiative !== ""
                ) {
                  effectiveInitiativeId = options.initiative;
                } else {
                  const defaultInitResult = await q.raw<{
                    initiative_id: string;
                  }>(
                    `SELECT initiative_id FROM \`initiative\` WHERE initiative_id = '${sqlEscape(UNASSIGNED_INITIATIVE_ID)}' OR title = 'Unassigned' LIMIT 1`,
                  );
                  if (
                    defaultInitResult.isOk() &&
                    defaultInitResult.value.length > 0
                  ) {
                    effectiveInitiativeId =
                      defaultInitResult.value[0].initiative_id;
                  } else {
                    effectiveInitiativeId = UNASSIGNED_INITIATIVE_ID;
                  }
                }
              }

              // Try to find plan by ID first
              if (
                options.plan.length === 36 &&
                /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
                  options.plan,
                )
              ) {
                const planResult = await q.select<{ plan_id: string }>(
                  tableName,
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
                  tableName,
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
                if (
                  tableName === "project" &&
                  effectiveInitiativeId !== undefined
                ) {
                  insertPayload.initiative_id = effectiveInitiativeId;
                  if (overview != null) insertPayload.overview = overview;
                  if (objectives != null && objectives.length > 0)
                    insertPayload.objectives = JSON.stringify(objectives);
                  if (outcomes != null && outcomes.length > 0)
                    insertPayload.outcomes = JSON.stringify(outcomes);
                  if (outputs != null && outputs.length > 0)
                    insertPayload.outputs = JSON.stringify(outputs);
                }
                if (options.format === "cursor") {
                  if (fileTree != null) insertPayload.file_tree = fileTree;
                  if (risks != null)
                    insertPayload.risks = JSON.stringify(risks);
                  if (tests != null)
                    insertPayload.tests = JSON.stringify(tests);
                  if (tableName === "project")
                    insertPayload.is_benchmark = isBenchmark ? 1 : 0;
                }
                const insertResult = await q.insert(tableName, insertPayload);
                if (insertResult.isErr()) throw insertResult.error;

                console.log(
                  `Created new project '${newPlanTitle}' with ID: ${planId}`,
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

              if (options.format === "cursor") {
                const planUpdatePayload: Record<string, SqlValue> = {
                  updated_at: currentTimestamp,
                };
                if (tableName === "project")
                  planUpdatePayload.is_benchmark = isBenchmark ? 1 : 0;
                if (fileTree != null) planUpdatePayload.file_tree = fileTree;
                if (risks != null)
                  planUpdatePayload.risks = JSON.stringify(risks);
                if (tests != null)
                  planUpdatePayload.tests = JSON.stringify(tests);
                if (
                  tableName === "project" &&
                  effectiveInitiativeId !== undefined
                ) {
                  planUpdatePayload.initiative_id = effectiveInitiativeId;
                  if (overview != null) planUpdatePayload.overview = overview;
                  if (objectives != null && objectives.length > 0)
                    planUpdatePayload.objectives = JSON.stringify(objectives);
                  if (outcomes != null && outcomes.length > 0)
                    planUpdatePayload.outcomes = JSON.stringify(outcomes);
                  if (outputs != null && outputs.length > 0)
                    planUpdatePayload.outputs = JSON.stringify(outputs);
                }
                const planUpdateResult = await q.update(
                  tableName,
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

              // If plan has any task in doing or done, set project to active (not draft).
              const countResult = await q.raw<{ c: number }>(
                `SELECT COUNT(*) AS c FROM \`task\` WHERE plan_id = '${sqlEscape(planId)}' AND \`status\` IN ('doing','done')`,
              );
              if (
                countResult.isOk() &&
                countResult.value.length > 0 &&
                (countResult.value[0]?.c ?? 0) > 0
              ) {
                const updateResult = await q.update(
                  tableName,
                  { status: "active", updated_at: currentTimestamp },
                  { plan_id: planId, status: "draft" },
                );
                if (updateResult.isOk() && !cmd.parent?.opts().noCommit) {
                  const commitResult = await doltCommit(
                    "plan: set active (has doing/done tasks)",
                    config.doltRepoPath,
                  );
                  if (commitResult.isErr()) throw commitResult.error;
                }
              }

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
          getStatusCache().clear();
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
