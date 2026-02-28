# Health-Check Skill

This skill provides functions to detect health issues in plans and tasks by querying the Task Graph Dolt database.

## detectStaleTasks

**Signature:**

```ts
function detectStaleTasks(
  doltRepoPath: string,
): Promise<
  Array<{
    task_id: string;
    title: string;
    started_by: string | null;
    started_at: string;
  }>
>;
```

**Description:**
Returns tasks with status `doing` that have no active worker. Useful for finding tasks that were claimed but never completed.

## detectOrphanedTasks

**Signature:**

```ts
function detectOrphanedTasks(
  doltRepoPath: string,
): Promise<Array<{ task_id: string; title: string }>>;
```

**Description:**
Finds tasks not linked to any plan or lacking any events since creation, indicating potential oversights or abandoned tasks.

## detectUnresolvedDependencies

**Signature:**

```ts
function detectUnresolvedDependencies(
  doltRepoPath: string,
): Promise<Array<{ task_id: string; title: string; unmet_blockers: number }>>;
```

**Description:**
Identifies tasks with `blockedBy` edges pointing to tasks in other plans or tasks that are still todo/doing, helping uncover cross-plan or unresolved dependencies.

## Usage Example

```ts
import {
  detectStaleTasks,
  detectOrphanedTasks,
  detectUnresolvedDependencies,
} from "src/skills/health-check/SKILL";

async function runHealthChecks() {
  const stale = await detectStaleTasks(process.env.DOLT_REPO_PATH!);
  const orphaned = await detectOrphanedTasks(process.env.DOLT_REPO_PATH!);
  const unresolved = await detectUnresolvedDependencies(
    process.env.DOLT_REPO_PATH!,
  );

  console.log("Stale tasks:", stale);
  console.log("Orphaned tasks:", orphaned);
  console.log("Unresolved dependencies:", unresolved);
}
```
