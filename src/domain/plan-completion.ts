import { ResultAsync } from "neverthrow";
import { sqlEscape } from "../db/escape";
import { now, query } from "../db/query";
import type { AppError } from "./errors";

export function autoCompletePlanIfDone(
  planId: string,
  doltRepoPath: string,
): ResultAsync<boolean, AppError> {
  const q = query(doltRepoPath);
  return q
    .raw<{
      status: string;
      count: number;
    }>(`SELECT status, COUNT(*) as count FROM \`task\` WHERE plan_id = '${sqlEscape(planId)}' GROUP BY status`)
    .andThen((rows) => {
      const counts = Object.fromEntries(rows.map((r) => [r.status, r.count]));
      const total = rows.reduce((sum, r) => sum + r.count, 0);
      if (total === 0)
        return ResultAsync.fromSafePromise(Promise.resolve(false));
      const doneCount = counts.done ?? 0;
      const canceledCount = counts.canceled ?? 0;
      const shouldComplete =
        doneCount > 0 && doneCount + canceledCount === total;
      if (!shouldComplete)
        return ResultAsync.fromSafePromise(Promise.resolve(false));
      return q
        .update(
          "project",
          { status: "done", updated_at: now() },
          { plan_id: planId },
        )
        .map(() => true);
    });
}
