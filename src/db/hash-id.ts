import type { ResultAsync } from "neverthrow";
import type { AppError } from "../domain/errors";
import { generateUniqueHashId } from "../domain/hash-id";
import { doltSql } from "./connection";

/** Fetch the current set of all used hash_ids from the task table. */
export function fetchUsedHashIds(
  repoPath: string,
): ResultAsync<Set<string>, AppError> {
  return doltSql(
    "SELECT `hash_id` FROM `task` WHERE `hash_id` IS NOT NULL",
    repoPath,
  ).map((rows: { hash_id: string }[]) => new Set(rows.map((r) => r.hash_id)));
}

/**
 * Allocate a unique hash_id given a pre-fetched set of used IDs.
 * Mutates usedIds to include the newly allocated ID so subsequent calls
 * in the same loop don't produce duplicates.
 */
export function allocateHashIdFromSet(
  taskId: string,
  usedIds: Set<string>,
): string {
  const id = generateUniqueHashId(taskId, usedIds);
  usedIds.add(id);
  return id;
}

/** Allocates a unique hash_id for a new task. Queries existing hash_ids and returns one that avoids collisions. */
export function allocateHashId(
  repoPath: string,
  taskId: string,
): ResultAsync<string, AppError> {
  return fetchUsedHashIds(repoPath).map((usedIds) =>
    allocateHashIdFromSet(taskId, usedIds),
  );
}
