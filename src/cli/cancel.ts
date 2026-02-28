import type { Command } from "commander";
import { ResultAsync } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { jsonObj, now, query } from "../db/query";
import { syncBlockedStatusForTask } from "../domain/blocked-status";
import { type AppError, buildError, ErrorCode } from "../domain/errors";
import { checkValidTransition } from "../domain/invariants";
import type { TaskStatus } from "../domain/types";
import { type Config, parseIdList, readConfig } from "./utils";

type PlanRow = { plan_id: string; status: string };
type TaskRow = { task_id: string; status: TaskStatus };

type CancelOneResult =
  | { type: "plan"; id: string; status: "abandoned" }
  | { type: "task"; id: string; status: "canceled" };

type PerIdResult =
  | { id: string; type?: "plan" | "task"; status?: string }
  | { id: string; error: string };

async function cancelOne(
  id: string,
  config: Config,
  options: { type?: string; reason?: string },
  cmd: Command,
): Promise<ResultAsync<CancelOneResult, AppError>> {
  const currentTimestamp = now();
  const q = query(config.doltRepoPath);
  const typeHint =
    options.type === "plan" || options.type === "task" ? options.type : "auto";

  return ResultAsync.fromPromise(
    (async (): Promise<CancelOneResult> => {
      const tryCancelPlan = async (plan: PlanRow) => {
        if (plan.status === "done" || plan.status === "abandoned") {
          throw buildError(
            ErrorCode.INVALID_TRANSITION,
            `Plan is in terminal state '${plan.status}'. Refusing to cancel.`,
          );
        }
        const updateResult = await q.update(
          "plan",
          { status: "abandoned", updated_at: currentTimestamp },
          { plan_id: plan.plan_id },
        );
        if (updateResult.isErr()) throw updateResult.error;
        const commitResult = await doltCommit(
          `cancel: plan ${plan.plan_id}`,
          config.doltRepoPath,
          cmd.parent?.opts().noCommit,
        );
        if (commitResult.isErr()) throw commitResult.error;
        return {
          type: "plan" as const,
          id: plan.plan_id,
          status: "abandoned" as const,
        };
      };

      if (typeHint === "plan" || typeHint === "auto") {
        const byPlanId = await q.select<PlanRow>("plan", {
          columns: ["plan_id", "status"],
          where: { plan_id: id },
        });
        if (byPlanId.isErr()) throw byPlanId.error;
        if (byPlanId.value.length > 0) return tryCancelPlan(byPlanId.value[0]);

        const byTitle = await q.select<PlanRow>("plan", {
          columns: ["plan_id", "status"],
          where: { title: id },
        });
        if (byTitle.isErr()) throw byTitle.error;
        if (byTitle.value.length > 0) return tryCancelPlan(byTitle.value[0]);

        if (typeHint === "plan") {
          throw buildError(
            ErrorCode.PLAN_NOT_FOUND,
            `Plan with ID or title '${id}' not found.`,
          );
        }
      }

      if (typeHint === "task" || typeHint === "auto") {
        const taskResult = await q.select<TaskRow>("task", {
          columns: ["task_id", "status"],
          where: { task_id: id },
        });
        if (taskResult.isErr()) throw taskResult.error;
        if (taskResult.value.length > 0) {
          const task = taskResult.value[0];
          const transitionResult = checkValidTransition(
            task.status,
            "canceled",
          );
          if (transitionResult.isErr()) throw transitionResult.error;

          const updateResult = await q.update(
            "task",
            { status: "canceled", updated_at: currentTimestamp },
            { task_id: task.task_id },
          );
          if (updateResult.isErr()) throw updateResult.error;

          const insertEventResult = await q.insert("event", {
            event_id: uuidv4(),
            task_id: task.task_id,
            kind: "note",
            body: jsonObj({
              type: "cancel",
              reason: options.reason ?? null,
            }),
            created_at: currentTimestamp,
          });
          if (insertEventResult.isErr()) throw insertEventResult.error;

          // Sync blocked status for dependents (blocks from this task)
          const blocksResult = await q.select<{ to_task_id: string }>("edge", {
            columns: ["to_task_id"],
            where: { from_task_id: task.task_id, type: "blocks" },
          });
          if (blocksResult.isOk() && blocksResult.value.length > 0) {
            for (const row of blocksResult.value) {
              const syncResult = await syncBlockedStatusForTask(
                config.doltRepoPath,
                row.to_task_id,
              );
              if (syncResult.isErr()) throw syncResult.error;
            }
          }

          const commitResult = await doltCommit(
            `cancel: task ${task.task_id}`,
            config.doltRepoPath,
            cmd.parent?.opts().noCommit,
          );
          if (commitResult.isErr()) throw commitResult.error;
          return {
            type: "task" as const,
            id: task.task_id,
            status: "canceled",
          };
        }
      }

      throw buildError(
        ErrorCode.PLAN_NOT_FOUND,
        `Plan or task '${id}' not found.`,
      );
    })(),
    (e) => e as AppError,
  );
}

export function cancelCommand(program: Command) {
  program
    .command("cancel")
    .description("Soft-delete a plan (abandoned) or task (canceled)")
    .argument(
      "<ids...>",
      "One or more plan or task IDs (space- or comma-separated)",
    )
    .option(
      "--type <type>",
      "Resolve as plan or task (default: auto-detect)",
      "auto",
    )
    .option("--reason <reason>", "Reason for canceling")
    .action(async (ids: string[], options, cmd) => {
      const configResult = await readConfig();
      if (configResult.isErr()) {
        console.error(`Error: ${configResult.error.message}`);
        process.exit(1);
      }
      const config = configResult.value;

      const idList = parseIdList(ids);
      if (idList.length === 0) {
        console.error("At least one plan or task ID required.");
        process.exit(1);
      }

      const results: PerIdResult[] = [];
      for (const id of idList) {
        const one = await cancelOne(id, config, options, cmd);
        one.match(
          (data) =>
            results.push({ id: data.id, type: data.type, status: data.status }),
          (error) => results.push({ id, error: error.message }),
        );
      }

      const anyFailed = results.some((r) => "error" in r);
      if (anyFailed) {
        if (!cmd.parent?.opts().json) {
          for (const r of results) {
            if ("error" in r) console.error(`${r.id}: ${r.error}`);
          }
        }
        if (cmd.parent?.opts().json) {
          console.log(JSON.stringify(results, null, 2));
        }
        process.exit(1);
      }

      if (!cmd.parent?.opts().json) {
        for (const r of results) {
          const row = r as {
            id: string;
            type?: "plan" | "task";
            status?: string;
          };
          const label = row.type === "plan" ? "Plan" : "Task";
          console.log(`${label} ${row.id} ${row.status}.`);
        }
      } else {
        console.log(JSON.stringify(results, null, 2));
      }
    });
}
