import type { Command } from "commander";
import { ResultAsync } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { allocateHashId } from "../db/hash-id";
import { jsonObj, now, query } from "../db/query";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { type Task, type TaskStatus, TaskStatusSchema } from "../domain/types";
import { type Config, readConfig } from "./utils"; // Import Config

export function splitCommand(program: Command) {
  program
    .command("split")
    .description("Decompose a task into multiple subtasks")
    .argument("<taskId>", "ID of the task to split")
    .requiredOption(
      "--into <titles>",
      "Pipe-separated titles of new subtasks (e.g., 'Task 1|Task 2')",
    )
    .option(
      "--keep-original",
      "Keep the original task as a parent (default: true)",
      true,
    )
    .option(
      "--link-direction <direction>",
      "Direction of the new edges (original-to-new or new-to-original)",
      "original-to-new",
    )
    .action(async (taskId, options, cmd) => {
      const result = await readConfig().asyncAndThen((config: Config) => {
        // Removed async, added type
        const currentTimestamp = now();

        return ResultAsync.fromPromise(
          (async () => {
            const q = query(config.doltRepoPath);

            const originalTaskQueryResult = await q.select<Task>("task", {
              where: { task_id: taskId },
            });
            if (originalTaskQueryResult.isErr())
              throw originalTaskQueryResult.error;
            const originalTasks = originalTaskQueryResult.value;

            if (originalTasks.length === 0) {
              throw buildError(
                ErrorCode.TASK_NOT_FOUND,
                `Task with ID ${taskId} not found.`,
              );
            }
            const originalTask = originalTasks[0];

            const originalDomainsResult = await q.select<{ doc: string }>(
              "task_doc",
              { columns: ["doc"], where: { task_id: taskId } },
            );
            const originalSkillsResult = await q.select<{ skill: string }>(
              "task_skill",
              { columns: ["skill"], where: { task_id: taskId } },
            );
            const originalDomains = originalDomainsResult.isOk()
              ? originalDomainsResult.value
              : [];
            const originalSkills = originalSkillsResult.isOk()
              ? originalSkillsResult.value
              : [];

            const newTitles = options.into
              .split("|")
              .map((s: string) => s.trim());
            const newTasks: Task[] = [];
            const taskMappings: { original: string; new: string }[] = [];

            for (const title of newTitles) {
              const newTaskId = uuidv4();
              const newTask: Task = {
                task_id: newTaskId,
                plan_id: originalTask.plan_id,
                feature_key: originalTask.feature_key,
                title: title,
                intent: originalTask.intent,
                scope_in: originalTask.scope_in,
                scope_out: originalTask.scope_out,
                acceptance: originalTask.acceptance,
                status: TaskStatusSchema.enum.todo, // New tasks start as todo
                owner: originalTask.owner,
                area: originalTask.area,
                risk: originalTask.risk,
                estimate_mins: null, // Estimate can be re-evaluated for subtasks
                created_at: currentTimestamp,
                updated_at: currentTimestamp,
                external_key: null,
                change_type: originalTask.change_type ?? null,
                suggested_changes: originalTask.suggested_changes ?? null,
              };
              newTasks.push(newTask);
              taskMappings.push({ original: taskId, new: newTaskId });

              const hashIdRes = await allocateHashId(
                config.doltRepoPath,
                newTask.task_id,
              );
              if (hashIdRes.isErr()) throw hashIdRes.error;

              const insertTaskResult = await q.insert("task", {
                task_id: newTask.task_id,
                plan_id: newTask.plan_id,
                hash_id: hashIdRes.value,
                feature_key: newTask.feature_key ?? null,
                title: newTask.title,
                intent: newTask.intent ?? null,
                scope_in: newTask.scope_in ?? null,
                scope_out: newTask.scope_out ?? null,
                acceptance: newTask.acceptance
                  ? jsonObj({ val: JSON.stringify(newTask.acceptance) })
                  : null,
                status: newTask.status,
                owner: newTask.owner,
                area: newTask.area ?? null,
                risk: newTask.risk,
                estimate_mins: newTask.estimate_mins ?? null,
                created_at: newTask.created_at,
                updated_at: newTask.updated_at,
                external_key: newTask.external_key ?? null,
                change_type: newTask.change_type ?? null,
                suggested_changes: newTask.suggested_changes ?? null,
              });
              if (insertTaskResult.isErr())
                throw buildError(
                  ErrorCode.DB_QUERY_FAILED,
                  "Failed to insert new task",
                  insertTaskResult.error,
                );

              const insertNewTaskEventResult = await q.insert("event", {
                event_id: uuidv4(),
                task_id: newTask.task_id,
                kind: "created",
                body: jsonObj({ title: newTask.title, splitFrom: taskId }),
                created_at: currentTimestamp,
              });
              if (insertNewTaskEventResult.isErr())
                throw buildError(
                  ErrorCode.DB_QUERY_FAILED,
                  "Failed to insert new task event",
                  insertNewTaskEventResult.error,
                );

              for (const { doc } of originalDomains) {
                const dr = await q.insert("task_doc", {
                  task_id: newTask.task_id,
                  doc,
                });
                if (dr.isErr()) throw dr.error;
              }
              for (const { skill } of originalSkills) {
                const sr = await q.insert("task_skill", {
                  task_id: newTask.task_id,
                  skill,
                });
                if (sr.isErr()) throw sr.error;
              }

              let fromId = taskId;
              let toId = newTask.task_id;
              if (options.linkDirection === "new-to-original") {
                fromId = newTask.task_id;
                toId = taskId;
              }

              const insertEdgeResult = await q.insert("edge", {
                from_task_id: fromId,
                to_task_id: toId,
                type: "relates",
                reason: "split dependency",
              });
              if (insertEdgeResult.isErr())
                throw buildError(
                  ErrorCode.DB_QUERY_FAILED,
                  "Failed to insert new edge",
                  insertEdgeResult.error,
                );
            }

            if (!options.keepOriginal) {
              const updateOriginalTaskResult = await q.update(
                "task",
                { status: "canceled", updated_at: currentTimestamp },
                { task_id: taskId },
              );
              if (updateOriginalTaskResult.isErr())
                throw buildError(
                  ErrorCode.DB_QUERY_FAILED,
                  "Failed to update original task",
                  updateOriginalTaskResult.error,
                );
            }

            const insertSplitEventResult = await q.insert("event", {
              event_id: uuidv4(),
              task_id: taskId,
              kind: "split",
              body: jsonObj({
                newTasks: newTasks.map((t) => ({
                  id: t.task_id,
                  title: t.title,
                })),
                taskMappings,
              }),
              created_at: currentTimestamp,
            });
            if (insertSplitEventResult.isErr())
              throw buildError(
                ErrorCode.DB_QUERY_FAILED,
                "Failed to insert split event",
                insertSplitEventResult.error,
              );

            const commitResult = await doltCommit(
              `task: split ${taskId} into ${newTitles.join(", ")}`,
              config.doltRepoPath,
              cmd.parent?.opts().noCommit,
            );
            if (commitResult.isErr()) throw commitResult.error;

            return {
              original_task_id: taskId,
              new_tasks: newTasks.map((t) => ({
                task_id: t.task_id,
                title: t.title,
              })),
              status: options.keepOriginal ? originalTask.status : "canceled",
            };
          })(),
          (e) => e as AppError, // Error handler for the promise
        );
      });

      result.match(
        (data: unknown) => {
          const resultData = data as {
            original_task_id: string;
            new_tasks: { task_id: string; title: string }[];
            status: TaskStatus;
          };
          if (!cmd.parent?.opts().json) {
            console.log(
              `Task ${resultData.original_task_id} split into new tasks.`,
            );
            resultData.new_tasks.forEach((task) => {
              console.log(`  - ${task.title} (ID: ${task.task_id})`);
            });
          } else {
            console.log(JSON.stringify(resultData, null, 2));
          }
        },
        (error: AppError) => {
          console.error(`Error splitting task: ${error.message}`);
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
