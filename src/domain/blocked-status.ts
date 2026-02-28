import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import { sqlEscape } from "../db/escape";
import { jsonObj, now, query } from "../db/query";
import { type AppError, buildError, ErrorCode } from "./errors";
import { checkValidTransition } from "./invariants";
import type { TaskStatus } from "./types";

/**
 * Pure: given current task status and unmet blocker count, compute whether we
 * should update status and to what. Used to keep DB layer thin.
 */
export function computeDesiredBlockedStatus(
  currentStatus: TaskStatus,
  unmetBlockersCount: number,
): { nextStatus: TaskStatus; transition: "to_blocked" | "to_todo" } | null {
  if (
    unmetBlockersCount > 0 &&
    (currentStatus === "todo" || currentStatus === "doing")
  ) {
    return { nextStatus: "blocked", transition: "to_blocked" };
  }
  if (unmetBlockersCount === 0 && currentStatus === "blocked") {
    return { nextStatus: "todo", transition: "to_todo" };
  }
  return null;
}

/**
 * Syncs a task's status to blocked/todo based on unmet blockers (same pattern as
 * checkRunnable). If unmet > 0 and status is todo/doing → set blocked and
 * optionally insert event kind=blocked. If unmet = 0 and status is blocked →
 * set todo and optionally insert event kind=unblocked. Respects
 * checkValidTransition. Call from write paths (done, cancel, block, edge,
 * crossplan, importer) after their mutations.
 */
export function syncBlockedStatusForTask(
  repoPath: string,
  taskId: string,
): ResultAsync<void, AppError> {
  const q = query(repoPath);

  return q
    .select<{ status: TaskStatus }>("task", {
      columns: ["status"],
      where: { task_id: taskId },
    })
    .andThen((rows) => {
      if (rows.length === 0) {
        return errAsync(
          buildError(
            ErrorCode.TASK_NOT_FOUND,
            `Task with ID ${taskId} not found.`,
          ),
        );
      }
      const currentStatus = rows[0].status;

      const unmetBlockersSql = `
        SELECT e.from_task_id
        FROM \`edge\` e
        JOIN \`task\` bt ON e.from_task_id = bt.task_id
        WHERE e.to_task_id = '${sqlEscape(taskId)}'
          AND e.type = 'blocks'
          AND bt.status NOT IN ('done','canceled');
      `;
      return q
        .raw<{ from_task_id: string }>(unmetBlockersSql)
        .andThen((blockerRows) => {
          const unmetBlockersCount = blockerRows.length;
          const blockerTaskIds = blockerRows.map((r) => r.from_task_id);
          const desired = computeDesiredBlockedStatus(
            currentStatus,
            unmetBlockersCount,
          );

          if (desired === null) {
            return okAsync(undefined);
          }

          const transitionResult = checkValidTransition(
            currentStatus,
            desired.nextStatus,
          );
          if (transitionResult.isErr()) {
            return errAsync(transitionResult.error);
          }

          const currentTimestamp = now();
          return q
            .update(
              "task",
              { status: desired.nextStatus, updated_at: currentTimestamp },
              { task_id: taskId },
            )
            .andThen(() => {
              if (desired.transition === "to_blocked") {
                return q
                  .insert("event", {
                    event_id: uuidv4(),
                    task_id: taskId,
                    kind: "blocked",
                    body: jsonObj({
                      blockerTaskIds,
                      reason: "materialized",
                      timestamp: currentTimestamp,
                    }),
                    created_at: currentTimestamp,
                  })
                  .map(() => undefined);
              }
              if (desired.transition === "to_todo") {
                return q
                  .insert("event", {
                    event_id: uuidv4(),
                    task_id: taskId,
                    kind: "unblocked",
                    body: jsonObj({ timestamp: currentTimestamp }),
                    created_at: currentTimestamp,
                  })
                  .map(() => undefined);
              }
              return okAsync(undefined);
            });
        });
    });
}
