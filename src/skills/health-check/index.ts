import { query } from "../../db/query";

export interface StaleTask {
  task_id: string;
  title: string;
  started_by: string | null;
  started_at: string;
}

export async function detectStaleTasks(
  doltRepoPath: string,
): Promise<StaleTask[]> {
  const q = query(doltRepoPath);
  // Select latest "started" event for tasks still in 'doing' status
  const sql = `
    SELECT t.task_id, t.title, e.body, e.created_at
    FROM task t
    JOIN event e ON e.task_id = t.task_id AND e.kind = 'started'
    WHERE t.status = 'doing'
      AND e.created_at = (
        SELECT MAX(e2.created_at)
        FROM event e2
        WHERE e2.task_id = t.task_id AND e2.kind = 'started'
      )
  `;
  const rowsResult = await q.raw<{
    task_id: string;
    title: string;
    body: string;
    created_at: string;
  }>(sql);
  const rows = rowsResult._unsafeUnwrap();

  const stale: StaleTask[] = [];
  for (const r of rows) {
    let started_by: string | null = null;
    try {
      const parsed = typeof r.body === "string" ? JSON.parse(r.body) : r.body;
      started_by = parsed.agent ?? null;
    } catch {
      started_by = null;
    }
    // If no agent claimed the task, consider it stale
    if (!started_by) {
      stale.push({
        task_id: r.task_id,
        title: r.title,
        started_by,
        started_at: r.created_at,
      });
    }
  }
  return stale;
}

export async function detectOrphanedTasks(
  doltRepoPath: string,
): Promise<Array<{ task_id: string; title: string }>> {
  const q = query(doltRepoPath);

  // 1. Tasks with no plan_id (plan_id IS NULL)
  const noPlanSql = `
    SELECT task_id, title FROM \`task\`
    WHERE plan_id IS NULL
  `;

  // 2. Tasks with zero events (no engagement: no started, note, etc.)
  const noEventsSql = `
    SELECT t.task_id, t.title FROM \`task\` t
    LEFT JOIN \`event\` e ON t.task_id = e.task_id
    WHERE e.event_id IS NULL
  `;

  const unionSql = `(${noPlanSql.trim()}) UNION (${noEventsSql.trim()})`;
  const result = await q.raw<{ task_id: string; title: string }>(unionSql);
  return result._unsafeUnwrap();
}

export async function detectUnresolvedDependencies(
  doltRepoPath: string,
): Promise<Array<{ task_id: string; title: string; unmet_blockers: number }>> {
  const q = query(doltRepoPath);
  const sql = `
    SELECT t.task_id, t.title, COUNT(bt.task_id) as unmet_blockers
    FROM task t
    JOIN edge e ON e.to_task_id = t.task_id AND e.type = 'blocks'
    JOIN task bt ON e.from_task_id = bt.task_id AND bt.status NOT IN ('done', 'canceled')
    WHERE t.status NOT IN ('done', 'canceled')
    GROUP BY t.task_id, t.title
  `;
  const result = await q.raw<{
    task_id: string;
    title: string;
    unmet_blockers: number;
  }>(sql);
  if (result.isErr()) throw result.error;
  return result.value;
}
