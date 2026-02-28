---
name: Status Polish and Auto-Complete Plans
overview: Add Done column to active plans table, auto-complete plans when all tasks are done, hide completed plans from status, show active work as a table before next runnable, limit next runnable to 3.
fileTree: |
  src/
  ├── cli/
  │   ├── status.ts                    (modify)
  │   └── done.ts                      (modify)
  ├── domain/
  │   └── plan-completion.ts           (create)
  __tests__/
  ├── cli/
  │   └── status.test.ts              (modify)
  └── domain/
      └── plan-completion.test.ts     (create)
risks:
  - description: Auto-completing plans could mark a plan done prematurely if tasks were canceled rather than completed
    severity: medium
    mitigation: Only auto-complete when every task is in done or canceled status AND at least one task is done (not all canceled). Plans with all-canceled tasks stay as-is.
  - description: Existing plans with all-done tasks won't retroactively get marked done until next tg done call
    severity: low
    mitigation: Add a one-time sweep in status command that checks and reports plans eligible for completion. Actual marking happens in tg done.
tests:
  - "Auto-complete: plan status set to done when last task is marked done"
  - "Auto-complete: plan NOT marked done if remaining tasks exist in todo/doing/blocked"
  - "Auto-complete: plan NOT marked done if all tasks are canceled (no done tasks)"
  - "Status output: Done column appears in active plans table"
  - "Status output: completed plans excluded from active plans table"
  - "Status output: active work shown as table before next runnable"
  - "Status output: next runnable limited to 3 rows"
  - "Status output: vanity metrics reflect auto-completed plans"
todos:
  - id: add-plan-completion-logic
    content: Create plan auto-completion function that marks a plan done when all tasks are done/canceled
    agent: implementer
    changeType: create
    intent: |
      Create src/domain/plan-completion.ts with a function:
      ```ts
      async function autoCompletePlanIfDone(planId: string, doltRepoPath: string): Promise<boolean>
      ```
      Logic:
      1. Query all tasks for the plan: SELECT status, COUNT(*) FROM task WHERE plan_id = ? GROUP BY status
      2. If no tasks exist, return false (don't complete empty plans)
      3. If every task is in done or canceled, AND at least one task is done -> UPDATE plan SET status = 'done', updated_at = NOW() WHERE plan_id = ? AND status != 'done'
      4. Return true if plan was marked done, false otherwise

      No migration needed — plan.status already has 'done' in the enum. The schema supports it,
      but no code path ever sets it today. All plans are stuck in 'draft'.

      Use the query helper from db/query.ts. Return a ResultAsync<boolean, AppError>.
    suggestedChanges: |
      ```ts
      import { query, now } from "../db/query";
      import { ResultAsync } from "neverthrow";
      import { AppError } from "./errors";

      export function autoCompletePlanIfDone(
        planId: string,
        doltRepoPath: string,
      ): ResultAsync<boolean, AppError> {
        const q = query(doltRepoPath);
        return q
          .raw<{ status: string; count: number }>(
            `SELECT status, COUNT(*) as count FROM \`task\` WHERE plan_id = '${planId}' GROUP BY status`
          )
          .map((rows) => {
            const counts = Object.fromEntries(rows.map(r => [r.status, r.count]));
            const total = rows.reduce((sum, r) => sum + r.count, 0);
            if (total === 0) return false;
            const doneCount = counts["done"] ?? 0;
            const canceledCount = counts["canceled"] ?? 0;
            return doneCount > 0 && doneCount + canceledCount === total;
          })
          .andThen((shouldComplete) => {
            if (!shouldComplete) return ResultAsync.fromSafePromise(Promise.resolve(false));
            return q
              .update("plan", { status: "done", updated_at: now() }, { plan_id: planId })
              .map(() => true);
          });
      }
      ```
  - id: hook-auto-complete-into-done
    content: Call autoCompletePlanIfDone in tg done after marking each task done
    agent: implementer
    changeType: modify
    blockedBy: [add-plan-completion-logic]
    intent: |
      In src/cli/done.ts, after successfully marking a task as done (after the doltCommit),
      look up the task's plan_id and call autoCompletePlanIfDone(planId, config.doltRepoPath).

      If the plan was auto-completed, include that in the output:
      - Human: "Task <id> done. Plan '<title>' is now complete!"
      - JSON: add "plan_completed": true and "plan_title": "..." to the result object

      The plan_id can be fetched from the task row (already queried for status check —
      just add plan_id to the SELECT columns).
  - id: polish-status-output
    content: Add Done column, hide completed plans, show active work as table, limit next runnable to 3
    agent: implementer
    changeType: modify
    intent: |
      Modify src/cli/status.ts with these changes:

      1. DONE COLUMN: Add a "Done" column to the active plans table showing count of
         done tasks per plan. Update the activePlansSql to also count done tasks
         (currently filtered out by t.status NOT IN ('canceled')). Include done in the
         GROUP BY results and add it to the table.

      2. HIDE COMPLETED PLANS: The active plans table already filters
         p.status NOT IN ('done', 'abandoned'). Once auto-complete is hooked in,
         completed plans will naturally disappear. No change needed here, but verify
         the filter is correct.

      3. ACTIVE WORK AS TABLE: Replace the current bullet-list active work section
         with a proper table (like the plans and next runnable tables). Columns:
         Task (truncated title), Plan, Agent. Position it BETWEEN the active plans
         table and the next runnable table. Remove the old bullet-list format.

      4. NEXT RUNNABLE LIMIT: Change LIMIT from 5 to 3 in the nextSql query.

      5. VANITY METRICS: The completedPlans count should now reflect auto-completed
         plans (it already queries WHERE status = 'done', so this works automatically).
    suggestedChanges: |
      Active plans table header change:
      ```
      Plan │ Todo │ Doing │ Done │ Blocked │ Actionable
      ```

      Active work table (new format):
      ```
      ── Active Work ──────────────────────────
        Task                    │ Plan              │ Agent
        ────────────────────────┼───────────────────┼──────────
        Update status.ts...     │ Health Check...   │ implementer-3
      ```

      Next runnable LIMIT change: 5 -> 3
  - id: write-plan-completion-tests
    content: Write unit tests for autoCompletePlanIfDone function
    agent: implementer
    changeType: create
    blockedBy: [add-plan-completion-logic]
    intent: |
      Create __tests__/domain/plan-completion.test.ts with integration tests:

      1. Plan with all tasks done -> plan marked done, returns true
      2. Plan with mix of done and todo -> not marked done, returns false
      3. Plan with all tasks canceled (none done) -> not marked done
      4. Plan with mix of done and canceled -> marked done
      5. Empty plan (no tasks) -> not marked done

      Use setupIntegrationTest from __tests__/integration/test-utils.ts.
      Create plans and tasks via doltSql, then call autoCompletePlanIfDone.
  - id: update-status-tests
    content: Update status tests to cover new Done column, hidden completed plans, active work table, and 3-item limit
    agent: implementer
    changeType: modify
    blockedBy: [polish-status-output]
    intent: |
      Update __tests__/cli/status.test.ts to verify:
      1. Done column appears in active plans table
      2. Completed plans (status=done) do not appear in active plans table
      3. Active work section renders as a table with Task/Plan/Agent columns
      4. Next runnable shows at most 3 items
isProject: false
---

## Analysis

### What needs to change

The plan.status enum already supports `done` — no migration needed. The gap is purely application logic:

1. **No code ever sets plan.status to 'done'** — all plans stay in `draft` forever. We need `autoCompletePlanIfDone()` called from `tg done`.
2. **Status output needs polish** — Done column missing, active work is a bullet list not a table, next runnable shows 5 instead of 3, completed plans clutter the table.

### Auto-completion logic

When `tg done <taskId>` succeeds:

```
task marked done
  → look up task.plan_id
  → SELECT status, COUNT(*) FROM task WHERE plan_id = ? GROUP BY status
  → if all tasks are done/canceled AND at least 1 is done
    → UPDATE plan SET status = 'done'
    → print "Plan '<title>' is now complete!"
```

This is safe because:

- It only triggers on `tg done`, not on import or status checks
- It requires at least one done task (not all-canceled)
- It's idempotent (won't re-update if already done)

### Status output changes

Before:

```
── Active Plans ─────────────────
  Plan          │ Todo │ Doing │ Blocked │ Actionable
  ...30+ rows including completed plans...

  ⚠ Stale: ...

── Active Work ──────────────────
  id  title (plan) [agent]        <-- bullet list

── Next Runnable ────────────────
  Task │ Plan                     <-- 5 rows
```

After:

```
── Completed ────────────────────
  Plans: 20 done    Tasks: 152 done    Canceled: 3

── Active Plans ─────────────────
  Plan          │ Todo │ Doing │ Done │ Blocked │ Actionable
  ...only in-flight plans...

  ⚠ Stale: ...

── Active Work ──────────────────
  Task          │ Plan          │ Agent        <-- table format

── Next Runnable ────────────────
  Task │ Plan                                  <-- 3 rows
```

## Dependency graph

```
Parallel start (2 unblocked):
  ├── add-plan-completion-logic
  └── polish-status-output

After add-plan-completion-logic:
  ├── hook-auto-complete-into-done
  └── write-plan-completion-tests

After polish-status-output:
  └── update-status-tests
```

<original_prompt>
we should have a column in the status output for done. also we should mark plans as done if all the todos, doings and blocked have been cleared. Ie all tasks are done. I see there are no completed plans in the vanity metrics. Also why is active work at the bottom of status still. I dont think thats needed. If you want to show active work it should be another table. before next runnable.

Lets also set limits on the next runnable table and just show 3 items. for the plans we can hide completed plans unless a specific `tg plans` is writ. in other words `tg status` is an overview of whats in flight and upcoming. not history.

This may require a migration, make a plan for this.
</original_prompt>
