import type { ResultAsync } from "neverthrow";
import type { AppError } from "../domain/errors";
import { generateUniqueHashId } from "../domain/hash-id";
import { doltSql } from "./connection";

/** Allocates a unique hash_id for a new task. Queries existing hash_ids and returns one that avoids collisions. */
export function allocateHashId(
  repoPath: string,
  taskId: string,
): ResultAsync<string, AppError> {
  return doltSql(
    "SELECT `hash_id` FROM `task` WHERE `hash_id` IS NOT NULL",
    repoPath,
  ).map((rows: { hash_id: string }[]) => {
    const usedIds = new Set(rows.map((r) => r.hash_id));
    return generateUniqueHashId(taskId, usedIds);
  });
}
