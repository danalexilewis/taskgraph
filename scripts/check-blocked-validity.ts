/**
 * Check that all tasks with status='blocked' have valid block relationships, then
 * sync blocked/todo status across the whole graph (fixes stale blocked tasks whose
 * blockers are done/canceled).
 *
 * - Each blocked task must have at least one blocks edge and/or a pending gate.
 * - Every blocks edge must reference existing tasks.
 * - After validation, runs syncBlockedStatusForPlanTasks for all tasks and commits.
 *
 * Run with: pnpm exec tsx scripts/check-blocked-validity.ts
 */

import { readConfig } from "../src/cli/utils";
import { doltCommit } from "../src/db/commit";
import { tableExists } from "../src/db/migrate";
import { sqlEscape } from "../src/db/escape";
import { query } from "../src/db/query";
import { syncBlockedStatusForPlanTasks } from "../src/domain/blocked-status";

interface BlockedTaskRow {
  task_id: string;
  title: string;
}

interface EdgeRow {
  from_task_id: string;
  to_task_id: string;
  type: string;
}

interface TaskIdRow {
  task_id: string;
  status: string;
}

interface GateRow {
  task_id: string;
  name: string;
}

async function main() {
  const configResult = await readConfig();
  if (configResult.isErr()) {
    console.error(configResult.error.message);
    process.exit(1);
  }
  const repo = configResult.value.doltRepoPath;
  const q = query(repo);

  // All task IDs for full-graph sync (used at end)
  const allTasksResult = await q.select<{ task_id: string }>("task", {
    columns: ["task_id"],
  });
  if (allTasksResult.isErr()) {
    console.error(allTasksResult.error.message);
    process.exit(1);
  }
  const allTaskIds = allTasksResult.value.map((r) => r.task_id);

  // 1. All tasks with status = 'blocked'
  const blockedResult = await q.select<BlockedTaskRow>("task", {
    columns: ["task_id", "title"],
    where: { status: "blocked" },
  });
  if (blockedResult.isErr()) {
    console.error(blockedResult.error.message);
    process.exit(1);
  }
  const blockedTasks = blockedResult.value;

  if (blockedTasks.length === 0) {
    console.log("No blocked tasks.");
  } else {
    console.log(`Found ${blockedTasks.length} blocked task(s). Checking validity...\n`);
  }

  // 2. All blocks edges (from_task_id blocks to_task_id)
  const edgesResult = await q.select<EdgeRow>("edge", {
    where: { type: "blocks" },
  });
  if (edgesResult.isErr()) {
    console.error(edgesResult.error.message);
    process.exit(1);
  }
  const blocksEdges = edgesResult.value;

  // 3. Pending gates (if gate table exists)
  let pendingGatesByTask = new Map<string, string[]>();
  const gateExistsResult = await tableExists(repo, "gate");
  if (gateExistsResult.isOk() && gateExistsResult.value) {
    const gatesResult = await q.raw<GateRow>(
      "SELECT task_id, name FROM `gate` WHERE status = 'pending'",
    );
    if (gatesResult.isOk()) {
      for (const row of gatesResult.value) {
        const list = pendingGatesByTask.get(row.task_id) ?? [];
        list.push(row.name);
        pendingGatesByTask.set(row.task_id, list);
      }
    }
  }

  const blockedIds = new Set(blockedTasks.map((t) => t.task_id));
  const edgesByTo = new Map<string, EdgeRow[]>();
  for (const e of blocksEdges) {
    const list = edgesByTo.get(e.to_task_id) ?? [];
    list.push(e);
    edgesByTo.set(e.to_task_id, list);
  }

  // 4. Resolve all blocker task_ids: exist in task table and their status
  const blockerIds = [...new Set(blocksEdges.map((e) => e.from_task_id))];
  const blockerIdList =
    blockerIds.length > 0
      ? blockerIds.map((id) => `'${sqlEscape(id)}'`).join(",")
      : "";

  const blockerStatusByTaskId = new Map<string, string>();
  if (blockerIdList) {
    const blockerRowsResult = await q.raw<TaskIdRow>(
      `SELECT task_id, status FROM \`task\` WHERE task_id IN (${blockerIdList})`,
    );
    if (blockerRowsResult.isErr()) {
      console.error(blockerRowsResult.error.message);
      process.exit(1);
    }
    for (const r of blockerRowsResult.value) {
      blockerStatusByTaskId.set(r.task_id, r.status);
    }
  }

  const invalidNoBlock: BlockedTaskRow[] = [];
  const invalidBlockerMissing: { task: BlockedTaskRow; blockerId: string }[] = [];
  const staleBlock: { task: BlockedTaskRow; blockerId: string; blockerStatus: string }[] = [];

  for (const task of blockedTasks) {
    const edges = edgesByTo.get(task.task_id) ?? [];
    const gates = pendingGatesByTask.get(task.task_id) ?? [];

    // No blocks edge and no pending gate -> invalid
    if (edges.length === 0 && gates.length === 0) {
      invalidNoBlock.push(task);
      continue;
    }

    for (const e of edges) {
      const blockerStatus = blockerStatusByTaskId.get(e.from_task_id);
      if (blockerStatus === undefined) {
        // Blocker task_id not in task table (should not happen with FK)
        invalidBlockerMissing.push({ task, blockerId: e.from_task_id });
      } else if (blockerStatus === "done" || blockerStatus === "canceled") {
        staleBlock.push({
          task,
          blockerId: e.from_task_id,
          blockerStatus: blockerStatus,
        });
      }
    }
  }

  // Report
  let hasInvalid = false;

  if (invalidNoBlock.length > 0) {
    hasInvalid = true;
    console.log("Invalid: blocked task has no block edge and no pending gate:");
    for (const t of invalidNoBlock) {
      console.log(`  ${t.task_id}  ${t.title.slice(0, 60)}${t.title.length > 60 ? "…" : ""}`);
    }
    console.log("");
  }

  if (invalidBlockerMissing.length > 0) {
    hasInvalid = true;
    console.log("Invalid: block edge references non-existent blocker task:");
    for (const { task, blockerId } of invalidBlockerMissing) {
      console.log(`  ${task.task_id} blocked by ${blockerId} (blocker not in task table)`);
    }
    console.log("");
  }

  if (staleBlock.length > 0) {
    console.log(
      "Sync inconsistency: blocked task has blocker(s) that are done/canceled (should have been unblocked):",
    );
    for (const { task, blockerId, blockerStatus } of staleBlock) {
      console.log(`  ${task.task_id} blocked by ${blockerId} (blocker status: ${blockerStatus})`);
    }
    console.log("");
  }

  if (!hasInvalid && staleBlock.length === 0 && blockedTasks.length > 0) {
    console.log("All blocked tasks have valid blocks (blocker tasks exist; no stale sync).");
  }

  // Sync blocked/todo status across the whole graph and commit
  if (allTaskIds.length > 0) {
    console.log("\nSyncing blocked status across graph...");
    const syncResult = await syncBlockedStatusForPlanTasks(repo, allTaskIds);
    if (syncResult.isErr()) {
      console.error(syncResult.error.message);
      process.exit(1);
    }
    const commitResult = await doltCommit(
      "chore: sync blocked status across graph (check-blocked-validity)",
      repo,
    );
    if (commitResult.isErr()) {
      console.error(commitResult.error.message);
      process.exit(1);
    }
    console.log("Done. Committed sync.");
  } else {
    console.log("No tasks in graph. Skipping sync.");
  }

  process.exit(hasInvalid ? 1 : 0);
}

main();
