import * as path from "node:path";
import { ResultAsync } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import { doltCommit } from "../db/commit";
import { sqlEscape } from "../db/escape";
import { allocateHashId } from "../db/hash-id";
import { planHashFromPlanId } from "../domain/hash-id";
import { jsonObj, now, query } from "../db/query";
import { syncBlockedStatusForTask } from "../domain/blocked-status";
import {
  loadRegistry,
  matchDocsForTask,
  matchSkillsForTask,
  type RegistryEntry,
} from "../domain/doc-skill-registry";
import type { AppError } from "../domain/errors";
import type { Task } from "../domain/types";

interface ParsedTask {
  stableKey: string;
  title: string;
  feature?: string;
  area?: string;
  blockedBy: string[];
  acceptance: string[];
  status?: "todo" | "done";
  agent?: string;
  docs?: string[];
  skills?: string[];
  changeType?:
    | "create"
    | "modify"
    | "refactor"
    | "fix"
    | "investigate"
    | "test"
    | "document";
  intent?: string;
  suggestedChanges?: string;
}

interface ImportResult {
  importedTasksCount: number;
  createdPlansCount: number;
}

/** Plan-scoped external_key suffix (-[0-9a-f]{6}). Strip for stable key lookup. */
const PLAN_HASH_SUFFIX = /-[0-9a-f]{6}$/i;

/**
 * Pre-flight: load existing tasks for the plan and return those whose normalized
 * stableKey is not in the parsed task set. No DB writes. Uses same load and
 * normalization as upsertTasksAndEdges so behavior stays in sync.
 */
export function computeUnmatchedExistingTasks(
  planId: string,
  parsedTasks: ParsedTask[],
  repoPath: string,
  externalKeyPrefix?: string,
): ResultAsync<
  { unmatchedTaskIds: string[]; unmatchedExternalKeys?: string[] },
  AppError
> {
  const q = query(repoPath);
  const parsedStableKeys = new Set(parsedTasks.map((t) => t.stableKey));

  return q
    .select<Task>("task", {
      columns: ["task_id", "external_key"],
      where: { plan_id: planId },
    })
    .map((existingTasksResult) => {
      const existingTasks = existingTasksResult as Task[];
      const unmatchedTaskIds: string[] = [];
      const unmatchedExternalKeys: string[] = [];

      for (const task of existingTasks) {
        if (!task.external_key) continue;
        let normalizedKey = task.external_key.replace(PLAN_HASH_SUFFIX, "");
        if (
          externalKeyPrefix &&
          normalizedKey.startsWith(`${externalKeyPrefix}-`)
        ) {
          normalizedKey = normalizedKey.slice(externalKeyPrefix.length + 1);
        }
        if (!parsedStableKeys.has(normalizedKey)) {
          unmatchedTaskIds.push(task.task_id);
          unmatchedExternalKeys.push(task.external_key);
        }
      }

      return {
        unmatchedTaskIds,
        unmatchedExternalKeys,
      };
    });
}

/** Derive repo root from Dolt repo path (e.g. .taskgraph/dolt -> repo root). */
function repoRootFromDoltPath(repoPath: string): string {
  const resolved = path.resolve(repoPath);
  return path.join(path.dirname(resolved), "..");
}

/** Extract file paths from plan fileTree string (lines with .ts, .md, .mdc; strip tree chars and (create)/(modify)). */
function extractFilePathsFromFileTree(fileTree: string | null): string[] {
  if (!fileTree || typeof fileTree !== "string") return [];
  const paths: string[] = [];
  const extRe = /\.(ts|md|mdc)(?:\s|$|[(\s])/;
  for (const line of fileTree.split("\n")) {
    if (!extRe.test(line)) continue;
    const s = line
      .replace(/^[\s│├└─]*/, "")
      .trim()
      .replace(/\s*\((?:create|modify|delete|refactor)\)\s*$/i, "")
      .trim();
    if (s) paths.push(s);
  }
  return paths;
}

/** Extract path-like strings ending in .ts, .md, .mdc from suggestedChanges text. */
function extractFilePathsFromSuggestedChanges(
  suggestedChanges: string | undefined,
): string[] {
  if (!suggestedChanges || typeof suggestedChanges !== "string") return [];
  const paths: string[] = [];
  const re = /[^\s[\](){}'"]*\.(ts|md|mdc)(?:\s|$|[)\]\s,])/g;
  let m: RegExpExecArray | null = re.exec(suggestedChanges);
  while (m !== null) {
    const p = m[0]
      .replace(/\s*$/, "")
      .replace(/[,)\]\s]+$/, "")
      .trim();
    if (p) paths.push(p);
    m = re.exec(suggestedChanges);
  }
  return paths;
}

export function upsertTasksAndEdges(
  planId: string,
  parsedTasks: ParsedTask[],
  repoPath: string,
  noCommit: boolean = false,
  externalKeyPrefix?: string,
  fileTree?: string | null,
  suggest: boolean = true,
): ResultAsync<ImportResult, AppError> {
  const currentTimestamp = now();
  const q = query(repoPath);

  return q
    .select<Task>("task", {
      columns: ["task_id", "external_key"],
      where: { plan_id: planId },
    })
    .andThen((existingTasksResult) => {
      return ResultAsync.fromPromise(
        (async () => {
          const existingTasks = existingTasksResult as Task[];
          const planHash = planHashFromPlanId(planId);
          const externalKeyToTaskId = new Map<string, string>();
          existingTasks.forEach((task) => {
            if (task.external_key) {
              let normalizedKey = task.external_key.replace(
                PLAN_HASH_SUFFIX,
                "",
              );
              if (
                externalKeyPrefix &&
                normalizedKey.startsWith(`${externalKeyPrefix}-`)
              ) {
                normalizedKey = normalizedKey.slice(
                  externalKeyPrefix.length + 1,
                );
              }
              externalKeyToTaskId.set(normalizedKey, task.task_id);
            }
          });

          // Auto-suggest docs/skills when both empty (registry load failure => skip silently)
          let registry: RegistryEntry[] = [];
          if (suggest) {
            const repoRoot = repoRootFromDoltPath(repoPath);
            const registryResult = loadRegistry(repoRoot);
            if (registryResult.isOk()) registry = registryResult.value;
            const planFilePatterns = extractFilePathsFromFileTree(
              fileTree ?? null,
            );
            for (const parsedTask of parsedTasks) {
              const docsEmpty = (parsedTask.docs ?? []).length === 0;
              const skillsEmpty = (parsedTask.skills ?? []).length === 0;
              if (!docsEmpty || !skillsEmpty) continue;
              const taskPaths = extractFilePathsFromSuggestedChanges(
                parsedTask.suggestedChanges,
              );
              const filePatterns = [
                ...new Set([...planFilePatterns, ...taskPaths]),
              ];
              if (filePatterns.length === 0) continue;
              const matchedDocs = matchDocsForTask(
                registry,
                filePatterns,
                parsedTask.changeType ?? null,
                parsedTask.title,
              );
              const matchedSkills = matchSkillsForTask(
                registry,
                filePatterns,
                parsedTask.changeType ?? null,
                parsedTask.title,
              );
              if (matchedDocs.length > 0 || matchedSkills.length > 0) {
                console.warn(
                  `[import] Auto-suggested for task "${parsedTask.title}" (${parsedTask.stableKey}): docs=[${matchedDocs.join(", ")}], skills=[${matchedSkills.join(", ")}]`,
                );
                parsedTask.docs = matchedDocs;
                parsedTask.skills = matchedSkills;
              }
            }
          }

          let importedTasksCount = 0;

          for (const parsedTask of parsedTasks) {
            let taskId = externalKeyToTaskId.get(parsedTask.stableKey);

            if (taskId) {
              // Update existing task (include external_key to migrate to plan-scoped format)
              const baseKey = externalKeyPrefix
                ? `${externalKeyPrefix}-${parsedTask.stableKey}`
                : parsedTask.stableKey;
              const externalKey = `${baseKey}-${planHash}`;
              const updateResult = await q.update(
                "task",
                {
                  external_key: externalKey,
                  title: parsedTask.title,
                  feature_key: parsedTask.feature ?? null,
                  area: parsedTask.area ?? null,
                  agent: parsedTask.agent ?? null,
                  change_type: parsedTask.changeType ?? null,
                  intent: parsedTask.intent ?? null,
                  suggested_changes: parsedTask.suggestedChanges ?? null,
                  acceptance:
                    parsedTask.acceptance.length > 0
                      ? jsonObj({ val: JSON.stringify(parsedTask.acceptance) })
                      : null,
                  ...(parsedTask.status !== undefined && {
                    status: parsedTask.status,
                  }),
                  updated_at: currentTimestamp,
                },
                { task_id: taskId },
              );
              if (updateResult.isErr()) {
                console.error("Error updating task:", updateResult.error);
                throw updateResult.error;
              }
            } else {
              // Insert new task
              taskId = uuidv4();
              importedTasksCount++;
              const hashIdRes = await allocateHashId(repoPath, taskId);
              if (hashIdRes.isErr()) throw hashIdRes.error;
              const hashId = hashIdRes.value;
              const taskStatus = parsedTask.status ?? "todo";
              const baseKey = externalKeyPrefix
                ? `${externalKeyPrefix}-${parsedTask.stableKey}`
                : parsedTask.stableKey;
              const externalKey = `${baseKey}-${planHash}`;
              const insertResult = await q.insert("task", {
                task_id: taskId,
                plan_id: planId,
                hash_id: hashId,
                external_key: externalKey,
                title: parsedTask.title,
                feature_key: parsedTask.feature ?? null,
                area: parsedTask.area ?? null,
                agent: parsedTask.agent ?? null,
                change_type: parsedTask.changeType ?? null,
                intent: parsedTask.intent ?? null,
                suggested_changes: parsedTask.suggestedChanges ?? null,
                acceptance:
                  parsedTask.acceptance.length > 0
                    ? jsonObj({ val: JSON.stringify(parsedTask.acceptance) })
                    : null,
                status: taskStatus,
                created_at: currentTimestamp,
                updated_at: currentTimestamp,
              });
              if (insertResult.isErr()) {
                console.error("Error inserting new task:", insertResult.error);
                throw insertResult.error;
              }

              const insertEventResult = await q.insert("event", {
                event_id: uuidv4(),
                task_id: taskId,
                kind: "created",
                body: jsonObj({
                  title: parsedTask.title,
                  externalKey: externalKey,
                }),
                created_at: currentTimestamp,
              });
              if (insertEventResult.isErr()) {
                console.error(
                  "Error inserting new task event:",
                  insertEventResult.error,
                );
                throw insertEventResult.error;
              }
            }

            // Register for edge resolution (blocker keys may reference tasks just inserted)
            externalKeyToTaskId.set(parsedTask.stableKey, taskId);

            // Sync task_doc and task_skill junction tables
            // Junction sync: delete existing task_doc rows for this task before re-inserting; whitelisted in doltSql guard (not core data).
            const delDocResult = await q.raw(
              `DELETE FROM \`task_doc\` WHERE task_id = '${sqlEscape(taskId)}'`,
            );
            if (delDocResult.isErr()) throw delDocResult.error;
            // Junction sync: delete existing task_skill rows for this task before re-inserting; whitelisted in doltSql guard (not core data).
            const delSkillResult = await q.raw(
              `DELETE FROM \`task_skill\` WHERE task_id = '${sqlEscape(taskId)}'`,
            );
            if (delSkillResult.isErr()) throw delSkillResult.error;
            for (const doc of parsedTask.docs ?? []) {
              const ins = await q.insert("task_doc", {
                task_id: taskId,
                doc,
              });
              if (ins.isErr()) throw ins.error;
            }
            for (const skill of parsedTask.skills ?? []) {
              const ins = await q.insert("task_skill", {
                task_id: taskId,
                skill,
              });
              if (ins.isErr()) throw ins.error;
            }

            // Handle edges
            for (const blockerKey of parsedTask.blockedBy) {
              const blockerTaskId = externalKeyToTaskId.get(blockerKey);
              if (!blockerTaskId) {
                console.warn(
                  `Blocker task with stable key '${blockerKey}' not found. Skipping edge creation for task '${parsedTask.stableKey}'.`,
                );
                continue;
              }

              const edgeExistsResult = await q.count("edge", {
                from_task_id: blockerTaskId,
                to_task_id: taskId,
                type: "blocks",
              });
              if (edgeExistsResult.isErr()) throw edgeExistsResult.error;
              const edgeExists = edgeExistsResult.value;

              if (edgeExists === 0) {
                const insertEdgeResult = await q.insert("edge", {
                  from_task_id: blockerTaskId,
                  to_task_id: taskId,
                  type: "blocks",
                  reason: "Blocked by plan import",
                });
                if (insertEdgeResult.isErr()) {
                  console.error(
                    "Error inserting new edge:",
                    insertEdgeResult.error,
                  );
                  throw insertEdgeResult.error;
                }
              }
            }
          }

          // Sync blocked status for all plan tasks after edges are in place
          const planTaskIds = Array.from(externalKeyToTaskId.values());
          for (const taskId of planTaskIds) {
            const syncResult = await syncBlockedStatusForTask(repoPath, taskId);
            if (syncResult.isErr()) throw syncResult.error;
          }

          const commitResult = await doltCommit(
            "plan-import: upsert tasks and edges",
            repoPath,
            noCommit,
          );
          if (commitResult.isErr()) throw commitResult.error;

          return {
            importedTasksCount,
            createdPlansCount: 0, // This logic is in the cli/import.ts, not here.
          };
        })(),
        (e) => e as AppError, // Error handler for the promise
      );
    });
}
