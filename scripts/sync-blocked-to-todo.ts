/**
 * One-off: sync tasks that are status=blocked but have 0 unmet blockers to status=todo.
 * Run with: pnpm exec tsx scripts/sync-blocked-to-todo.ts
 */
import { readConfig } from "../src/cli/utils";
import { query } from "../src/db/query";
import { syncBlockedStatusForTask } from "../src/domain/blocked-status";

async function main() {
  const configResult = await readConfig();
  if (configResult.isErr()) {
    console.error(configResult.error.message);
    process.exit(1);
  }
  const repo = configResult.value.doltRepoPath;
  const q = query(repo);

  const sql = `
    SELECT t.task_id, t.title
    FROM \`task\` t
    WHERE t.status = 'blocked'
    AND (SELECT COUNT(*) FROM \`edge\` e
         JOIN \`task\` bt ON e.from_task_id = bt.task_id
         WHERE e.to_task_id = t.task_id AND e.type = 'blocks'
         AND bt.status NOT IN ('done','canceled')) = 0
  `;
  const result = await q.raw<{ task_id: string; title: string }>(sql);
  result.match(
    async (rows) => {
      console.log("Blocked tasks with 0 unmet blockers:", rows.length);
      for (const r of rows) {
        const syncResult = await syncBlockedStatusForTask(repo, r.task_id);
        syncResult.match(
          () => console.log("Synced to todo:", r.task_id, r.title),
          (e) => console.error("Sync failed:", r.task_id, e.message),
        );
      }
    },
    (e) => {
      console.error("Query failed:", e.message);
      process.exit(1);
    },
  );
}

main();
