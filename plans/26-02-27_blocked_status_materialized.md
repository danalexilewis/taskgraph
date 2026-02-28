---
name: Materialized Blocked Status from Edge Graph
overview: Materialize task status blocked from the blocks edge graph so tg status Blocked column is meaningful and cross-plan gating works via auto-block/unblock on write.
fileTree: |
  src/
  ├── domain/
  │   └── blocked-status.ts          (create)
  ├── db/
  │   └── query.ts                   (modify)
  ├── cli/
  │   ├── block.ts                   (modify)
  │   ├── done.ts                    (modify)
  │   ├── cancel.ts                  (modify)
  │   ├── edge.ts                    (modify)
  │   └── crossplan.ts                (modify)
  └── plan-import/
      └── importer.ts                (modify)
  __tests__/
  ├── domain/
  │   └── blocked-status.test.ts     (create)
  └── integration/
  └── blocked-status-materialized.test.ts  (create)
  docs/
  └── schema.md                      (modify)
risks:
  - description: Sync on every done/cancel could touch many dependent tasks across plans
    severity: low
    mitigation: Single query to find dependents, then one update per affected task; batch or limit if needed later
  - description: Import order — tasks created before edges; sync must run after all edges for the plan are written
    severity: low
    mitigation: Call sync pass after the full task/edge loop in importer, once per plan task
tests:
  - "Unit: syncBlockedStatusForTask sets blocked when unmet blockers > 0, todo when 0 (and was blocked)"
  - "Integration: import plan with blockedBy yields some tasks with status=blocked"
  - "Integration: tg done on blocker transitions dependent from blocked to todo"
  - "Integration: tg edge add blocks / tg block / crossplan blocks sets to_task status=blocked when applicable"
  - "Integration: tg cancel on blocker unblocks dependents"
todos:
  - id: sync-helper
    content: Add syncBlockedStatusForTask domain/db helper and call from write paths
    agent: implementer
    intent: |
      Create src/domain/blocked-status.ts (or similar) with a function that:
      1. Takes repoPath and taskId.
      2. Queries unmet blockers for taskId (same pattern as checkRunnable: COUNT edge where to_task_id=taskId, type=blocks, from_task status NOT IN (done,canceled)).
      3. If unmet > 0 and current status is todo or doing: update task to status=blocked, updated_at=now; optionally insert event kind=blocked with body { blockerTaskId(s), reason: "materialized", timestamp }. Respect checkValidTransition.
      4. If unmet = 0 and current status is blocked: update task to status=todo, updated_at=now; optionally insert event kind=unblocked with body { timestamp }.
      Use neverthrow Result/ResultAsync; use query(repoPath) for DB. Export from domain a pure "compute desired status" if you want to keep DB in a thin layer. Ensure done.ts, cancel.ts, block.ts, edge.ts, crossplan.ts, and importer can all call this after their mutations.
      Reference: src/domain/invariants.ts checkRunnable (unmet blockers query), checkValidTransition (blocked <-> todo).
    changeType: create
    docs: [schema, neverthrow-error-handling]
    skills: [taskgraph-lifecycle-execution]
  - id: importer-sync
    content: After upserting tasks and edges in importer, sync blocked status for all plan tasks
    agent: implementer
    blockedBy: [sync-helper]
    intent: |
      In src/plan-import/importer.ts, inside upsertTasksAndEdges, after the for-loop that creates/updates tasks and edges (and before doltCommit), add a pass over all task_ids in the plan (e.g. collect from externalKeyToTaskId or re-query tasks for plan_id). For each task_id, call syncBlockedStatusForTask(repoPath, taskId). This materializes blocked for any task that has unmet blockers after import (intra-plan blockedBy). No new events required if sync helper already emits them; otherwise at least set status so status display is correct.
    changeType: modify
    docs: [plan-import, schema]
    skills: [taskgraph-lifecycle-execution]
  - id: done-unblock
    content: On tg done, find dependents (blocks from this task) and sync their blocked status
    agent: implementer
    blockedBy: [sync-helper]
    intent: |
      In src/cli/done.ts, after updating the task to done and inserting the done event (and before or after autoCompletePlanIfDone), query edge for rows where from_task_id = completed taskId and type = 'blocks'. For each to_task_id, call syncBlockedStatusForTask(repoPath, to_task_id). Those tasks may transition from blocked to todo and receive an unblocked event if the sync helper emits it.
    changeType: modify
    docs: [schema, agent-contract]
    skills: [taskgraph-lifecycle-execution]
  - id: cancel-unblock
    content: On tg cancel, find dependents (blocks from this task) and sync their blocked status
    agent: implementer
    blockedBy: [sync-helper]
    intent: |
      In src/cli/cancel.ts, after setting the task to canceled and inserting the note event, query edge for from_task_id = canceled taskId and type = 'blocks'. For each to_task_id, call syncBlockedStatusForTask(repoPath, to_task_id). Same pattern as done-unblock.
    changeType: modify
    docs: [schema, cli-reference]
    skills: [taskgraph-lifecycle-execution]
  - id: block-cmd-use-sync
    content: Refactor tg block to use shared sync helper for consistency
    agent: implementer
    blockedBy: [sync-helper]
    intent: |
      In src/cli/block.ts, after inserting the blocks edge, call syncBlockedStatusForTask for taskId instead of (or in addition to) directly setting status=blocked. This keeps one place that defines "blocked = unmet blockers > 0". Retain the existing blocked event insert if the sync helper does not emit it for this path, or remove duplicate if sync does.
    changeType: modify
    docs: [cli-reference]
    skills: [cli-command-implementation]
  - id: edge-add-sync
    content: After tg edge add type=blocks, sync blocked status for to_task_id
    agent: implementer
    blockedBy: [sync-helper]
    intent: |
      In src/cli/edge.ts, when type === 'blocks' and the edge was successfully inserted, call syncBlockedStatusForTask(config.doltRepoPath, toTaskId). This covers manual edge add; crossplan is separate.
    changeType: modify
    docs: [cli-reference]
    skills: [cli-command-implementation]
  - id: crossplan-sync
    content: After crossplan edges adds a blocks edge, sync blocked status for to_task_id
    agent: implementer
    blockedBy: [sync-helper]
    intent: |
      In src/cli/crossplan.ts runEdges, after each successful insert of a type=blocks edge (and after pushing to existingBlocks), call syncBlockedStatusForTask(config.doltRepoPath, edge.to_task_id). Ensures cross-plan blocking shows up in status=blocked.
    changeType: modify
    docs: [cli-reference]
    skills: [cli-command-implementation]
  - id: docs-schema-blocked
    content: Document materialized blocked semantics in schema and CLI reference
    agent: implementer
    intent: |
      Update docs/schema.md: In the task table description or invariants section, state that task.status = 'blocked' is a materialized view of the blocks graph — set when the task has at least one unmet blocker (edge type=blocks from a task not done/canceled), and cleared to todo when all blockers are done/canceled. Sync occurs on plan import, tg block, tg edge add (blocks), tg done, tg cancel, and tg crossplan edges. In docs/cli-reference.md, under tg status, note that the Blocked column shows tasks in status=blocked (materialized from the dependency graph).
    changeType: document
    docs: [schema, cli-reference, documentation-sync]
    skills: [documentation-sync]
  - id: tests-blocked-status
    content: Add unit and integration tests for sync helper and materialized blocked flows
    agent: implementer
    blockedBy: [sync-helper]
    intent: |
      Unit (e.g. __tests__/domain/blocked-status.test.ts): Test syncBlockedStatusForTask with a test DB or mocked query — task with unmet blockers becomes blocked; task that is blocked and has all blockers cleared becomes todo. Integration (e.g. __tests__/integration/blocked-status-materialized.test.ts): Import a plan with blockedBy, assert some tasks have status=blocked; run tg done on a blocker, assert dependent moves to todo; add blocks edge (tg block or edge add or crossplan), assert to_task becomes blocked; tg cancel blocker, assert dependent unblocked. Use real Dolt repo in .taskgraph/dolt or test fixture; follow existing integration test patterns.
    changeType: test
    docs: [testing]
    skills: [integration-testing, taskgraph-lifecycle-execution]
isProject: false
---

## Analysis

Option A makes `task.status = 'blocked'` a **materialized view** of the `edge` graph: any task with at least one unmet blocker (blocks edge from a task that is not done/canceled) is kept in status `blocked`; when all blockers clear, status is set back to `todo`. The "Blocked" column in `tg status` already counts `task.status = 'blocked'`, so it will show meaningful numbers once status is maintained on every write path that affects blocking edges or blocker completion.

**Why materialize on write (not on read):** Keeps status display and `tg next` semantics consistent without changing runnability queries; existing runnability logic (unmet_blockers = 0) can remain. We add a single sync helper and call it from importer, block, done, cancel, edge add (blocks), and crossplan edges.

**Rejected:** Computing "blocked" only at display time would require changing status UI to a derived count and would not give a single source of truth for "this task is blocked" in the DB.

**Event semantics:** The sync helper can emit `blocked` when setting status to blocked (e.g. on import) and `unblocked` when transitioning to todo so the event log stays consistent; optional for MVP but recommended.

## Dependency graph

```
Parallel start (2 unblocked):
  ├── sync-helper          (domain/db helper: sync status from graph)
  └── docs-schema-blocked  (document materialized semantics)

After sync-helper:
  ├── importer-sync        (importer: sync after edges)
  ├── done-unblock         (done: sync dependents)
  ├── cancel-unblock       (cancel: sync dependents)
  ├── block-cmd-use-sync   (block: use shared sync)
  ├── edge-add-sync        (edge add blocks: sync to_task)
  ├── crossplan-sync       (crossplan blocks: sync to_task)
  └── tests-blocked-status (unit + integration tests)
```

## Proposed changes

- **syncBlockedStatusForTask(repoPath, taskId):** Query `SELECT COUNT(*) FROM edge e JOIN task bt ON e.from_task_id = bt.task_id WHERE e.to_task_id = ? AND e.type = 'blocks' AND bt.status NOT IN ('done','canceled')`. If count > 0 and task status in (todo, doing): update task to blocked; optionally insert event `blocked`. If count = 0 and task status = blocked: update task to todo; optionally insert event `unblocked`. Use `checkValidTransition` before updating.
- **Importer:** After the task/edge upsert loop, for each task in the plan call syncBlockedStatusForTask.
- **done.ts / cancel.ts:** After updating the completed/canceled task, select `to_task_id` from edge where from_task_id = id and type = 'blocks'; for each, syncBlockedStatusForTask.
- **block.ts:** After insert edge, call syncBlockedStatusForTask(taskId) (or keep direct set and document that block always sets blocked; analyst suggested one place — sync is that place).
- **edge.ts:** After insert when type=blocks, syncBlockedStatusForTask(toTaskId).
- **crossplan.ts:** After each blocks edge insert in runEdges, syncBlockedStatusForTask(edge.to_task_id).

## Open questions

- None; analyst breakdown and risks are addressed in the task intents.

## Original prompt

<original_prompt>
Implement Option A: Make task status `blocked` a materialized view of the edge graph (second-order dependency tree for cross-plan blocking). Auto-block when a task has unmet blockers; auto-unblock when blockers are done/canceled. Status display Blocked column should show meaningful counts.
</original_prompt>
