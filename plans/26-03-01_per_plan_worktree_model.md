---
name: Per-plan Worktree Model
overview: "Replace per-task worktrees with a per-plan branch model: task worktrees branch from a shared plan branch, implementers commit per task, and the plan branch squash-merges into main at plan completion."
fileTree: |
  src/
  ├── db/
  │   └── migrate.ts                  (modify - plan.hash_id migration + plan_worktree table)
  ├── cli/
  │   ├── start.ts                    (modify - branch per-task worktree from plan branch)
  │   ├── done.ts                     (modify - merge task worktree into plan branch, not main)
  │   └── worktree.ts                 (modify - mergeWorktreeBranchIntoMain targetBranch param + plan merge helper)
  .cursor/
  ├── agents/
  │   └── implementer.md              (modify - add commit step, remove no-commit rule)
  ├── skills/
  │   └── work/
  │       └── SKILL.md                (modify - plan branch tracking, plan-merge step at completion)
  └── rules/
      └── subagent-dispatch.mdc       (modify - update Worktrunk section for per-plan model)
  docs/
  ├── multi-agent.md                  (modify - per-plan model description)
  ├── cli-reference.md                (modify - tg start --worktree and tg done --merge)
  └── schema.md                       (modify - plan_worktree table, plan.hash_id column)
  __tests__/
  └── integration/
      └── plan-worktree.test.ts       (create)
risks:
  - description: Parallel tasks each branch from the plan branch and must merge back into it sequentially on done --merge, creating a short merge window
    severity: medium
    mitigation: mergeWorktreeBranchIntoMain with targetBranch=planBranch; sequential done --merge calls are safe since each is atomic
  - description: Race condition if two parallel tasks call tg start --worktree simultaneously for same plan before either creates the plan branch
    severity: medium
    mitigation: Handle 'branch already exists' from wt switch --create as a reuse signal; retry with wt switch (no --create) or discover via wt list
  - description: wt merge squashes all per-task commits into one; per-task granularity lost on main
    severity: low
    mitigation: Acceptable tradeoff; plan branch retains per-task commits until merge; can always git log the plan branch before it's deleted
  - description: tg done without --merge on a mid-plan task must not remove the plan branch
    severity: high
    mitigation: done.ts checks for plan_worktree row and only removes worktree for orphaned tasks or when --close-plan flag is passed
  - description: Plan branch persists after plan completion if orchestrator fails to merge
    severity: low
    mitigation: Document cleanup; add wt remove fallback in the work skill's error path
tests:
  - "tg start --worktree on task 1 of a plan creates plan.hash_id, plan_worktree row, and plan-<hash> branch"
  - "tg start --worktree on task 2 of same plan returns same plan branch (reuse)"
  - "tg done --merge merges task worktree into plan branch (not main); plan branch still exists"
  - "After two tg done --merge calls, plan branch has both task commits"
  - "At plan completion, wt merge brings plan-<hash> into main cleanly"
  - "Two simultaneous tg start --worktree for same plan do not error; both succeed"
todos:
  - id: schema-plan-worktree
    content: "Add plan.hash_id column and plan_worktree table via Dolt migrations"
    agent: implementer
    changeType: modify
    docs: [schema]
    skill: dolt-schema-migration
    intent: |
      Add two migrations to src/db/migrate.ts:

      Migration 1 — 'add_plan_hash_id':
        ALTER TABLE plan ADD COLUMN IF NOT EXISTS hash_id VARCHAR(20);
        UPDATE plan SET hash_id = CONCAT('p-', LOWER(SUBSTR(HEX(plan_id), 1, 6))) WHERE hash_id IS NULL OR hash_id = '';
      This follows the same pattern as task.hash_id. The hash_id becomes the basis for the plan
      branch name: 'plan-<hash_id>' (e.g. 'plan-abc123').

      Migration 2 — 'create_plan_worktree':
        CREATE TABLE IF NOT EXISTS plan_worktree (
          plan_id CHAR(36) PRIMARY KEY,
          worktree_path VARCHAR(512) NOT NULL,
          worktree_branch VARCHAR(128) NOT NULL,
          created_at DATETIME NOT NULL
        );
      This table tracks the active plan-level branch per plan. It is used by tg start to find and
      reuse the plan branch for subsequent tasks without scanning events.

      Wire both migrations into ensureMigrations in the standard position.
    suggestedChanges: |
      In migrate.ts, add after the last existing migration:
        { id: 'add_plan_hash_id', up: `ALTER TABLE plan ADD COLUMN IF NOT EXISTS hash_id VARCHAR(20); ...` },
        { id: 'create_plan_worktree', up: `CREATE TABLE IF NOT EXISTS plan_worktree (...)` }

  - id: worktree-target-branch
    content: "Extend mergeWorktreeBranchIntoMain to accept a targetBranch parameter"
    agent: implementer
    changeType: modify
    intent: |
      In src/cli/worktree.ts, update mergeWorktreeBranchIntoMain to accept an optional
      targetBranch parameter (default: 'main'). When set, merges the worktree branch into
      targetBranch instead of main.

      For Worktrunk: `wt merge <targetBranch> -C <resolvedWorktree> --no-verify -y`
      For git: `git checkout <targetBranch> && git merge <branch>`

      This is a pure additive signature change. All existing callers pass nothing and continue
      to get 'main' behavior — no regression. Callers in done.ts will be updated in a separate task
      to pass the plan branch name.

      Also add a new helper function: createPlanBranchAndWorktree(planHashId, repoPath, baseBranch)
      that creates the plan-level branch 'plan-<planHashId>' using wt switch --create (or git checkout -b)
      from baseBranch='main'. If the branch already exists (race condition), it should handle the error
      gracefully and return the existing path. Returns the worktree path.
    suggestedChanges: |
      Signature change:
        export function mergeWorktreeBranchIntoMain(
          repoPath: string,
          branchName: string,
          targetBranch: string = "main",  // was mainBranch
          worktreePath?: string,
          backendOverride?: "worktrunk" | "git",
        )
      New helper function below the existing one.

  - id: start-plan-branch-reuse
    content: "tg start --worktree branches per-task worktree from plan branch and tracks it in plan_worktree"
    agent: implementer
    changeType: modify
    blockedBy: [schema-plan-worktree, worktree-target-branch]
    docs: [multi-agent, cli]
    skill: cli-command-implementation
    intent: |
      Modify src/cli/start.ts so that tg start --worktree uses a plan-level branch as the base
      when the task belongs to a plan.

      New logic when --worktree is passed and task has a plan_id:
      1. Look up plan.hash_id for the task's plan_id.
      2. Check plan_worktree table for this plan_id. If a row exists and the worktree path is live
         (dir exists on disk), the plan branch already exists — skip branch creation.
      3. If no row or stale path: call createPlanBranchAndWorktree(planHashId, repoPath, 'main')
         from worktree.ts to create the plan-<hash> branch and a dedicated plan worktree directory.
         Insert into plan_worktree table.
      4. Now create the PER-TASK worktree: call createWorktree(taskId, repoPath, planBranch, hash_id)
         — pass planBranch as the baseBranch so the task worktree branches FROM the plan branch, not main.
      5. Store plan_branch and plan_worktree_path in the started event body alongside existing fields.

      For tasks without a plan_id (orphaned), keep current behavior (branch from main).

      Handle the race: if createPlanBranchAndWorktree fails with "branch already exists", treat it
      as success — query wt list to find the existing path and proceed.
    suggestedChanges: |
      In start.ts, after resolving taskId and before createWorktree:
        const planRow = await query(doltPath).select('task', {columns: ['plan_id'], where: {task_id: resolved}})
        if (planRow[0].plan_id) {
          const planBranch = await ensurePlanBranch(planRow[0].plan_id, repoPath)  // new helper
          // then createWorktree(..., baseBranch=planBranch.branch, ...)
        }

  - id: done-merge-to-plan-branch
    content: "tg done --merge merges task worktree into plan branch (not main); skip plan worktree removal"
    agent: implementer
    changeType: modify
    blockedBy: [schema-plan-worktree, worktree-target-branch]
    docs: [multi-agent, cli]
    skill: cli-command-implementation
    intent: |
      Modify src/cli/done.ts so that tg done --merge merges the task's per-task worktree branch
      into the PLAN branch (not main) when the task belongs to a plan with an active plan_worktree.

      Logic after the task is marked done in DB:
      1. Look up plan_id from the task table.
      2. If plan_id exists, query plan_worktree for the plan branch name.
      3. If a plan branch exists: call mergeWorktreeBranchIntoMain(repoPath, taskBranch, planBranch, taskWorktreePath)
         — targetBranch is planBranch, not 'main'. After merge, the per-task worktree is removed (wt merge
         handles this as part of the squash+merge+cleanup step). Do NOT remove the plan worktree.
      4. If no plan branch (orphaned task): keep current behavior — merge to main and remove worktree.

      The plan worktree is NEVER removed by tg done. It is only removed by the orchestrator at plan
      completion via a dedicated plan-merge step (wt merge main -C <plan-worktree-path>).

      Note: with Worktrunk, `wt merge <planBranch> -C <taskWorktreePath>` does squash+rebase+merge+
      cleanup for the task worktree. This is safe because each task worktree is merged independently.
    suggestedChanges: |
      In done.ts, in the --merge branch:
        const planWorktree = await getPlanWorktreeForTask(resolved, doltPath)  // new helper
        const targetBranch = planWorktree?.branch ?? 'main'
        await mergeWorktreeBranchIntoMain(repoRoot, branch, targetBranch, worktreePath)
        // only call removeWorktree for orphaned (no planWorktree) case

  - id: implementer-commit-step
    content: "Update implementer.md: require git commit after task implementation in worktree"
    agent: documenter
    changeType: modify
    intent: |
      Update .cursor/agents/implementer.md:
      1. Remove "Do not commit unless the task explicitly requires it" from the MUST NOT DO list.
      2. Add a commit step in Step 3 (after implementation work, before tg done):
           git add -A && git commit -m "task(<hash_id>): <brief one-line description of what was done>"
         Run this from the worktree directory. Only applies when running in a worktree (WORKTREE_PATH
         was passed or obtained). If no worktree, skip this step (work lands on main directly).
      3. Update Step 4 to note: commit must happen before tg done, so the merge in tg done --merge
         has a commit to squash.
      Keep the "Do not commit unless required" rule removed entirely — the new contract is "always commit
      in a worktree."

  - id: work-skill-plan-branch
    content: "Update work SKILL.md: track plan branch, pass to all tasks in plan, add plan-merge step"
    agent: documenter
    changeType: modify
    intent: |
      Update .cursor/skills/work/SKILL.md:
      1. In the Loop, step 6b: after the first tg start --worktree for a plan, capture the plan
         branch returned in the started event (or from tg worktree list --json). Inject this as
         {{PLAN_BRANCH}} for subsequent tasks in the same plan — pass it in the implementer prompt
         so the implementer knows the plan branch context even though each task has its own worktree.
      2. Add a plan-merge step at the end of the loop (after run-full-suite passes):
           wt merge main -C <plan-worktree-path> --no-verify -y
         This squash-merges the plan branch into main. If wt is not available, fall back to:
           git checkout main && git merge --squash <plan-branch> && git commit -m "plan: <plan-name>"
      3. The "Final action — commit .taskgraph/dolt" section already exists; confirm it runs AFTER
         the plan-merge step, not before.
      4. Multi-plan mode: the orchestrator maintains a map of plan_id -> plan_worktree_path for
         all active plans; runs the plan-merge step for each plan that completed in this session.

  - id: dispatch-rule-update
    content: "Update subagent-dispatch.mdc Worktrunk section for per-plan worktree model"
    agent: documenter
    changeType: modify
    intent: |
      Update .cursor/rules/subagent-dispatch.mdc, specifically:
      1. "Worktrunk — standard for sub-agent worktrees" section:
         Replace the per-task description with the per-plan model. Each plan gets a plan-<hash> branch.
         Per-task worktrees branch FROM the plan branch. tg done --merge merges task worktree into
         the plan branch, not main.
      2. Pattern 1, step 4: update the worktree instruction. The orchestrator should capture the
         plan_branch from the first task's started event and pass {{PLAN_BRANCH}} to all subsequent
         implementers in the same plan (informational, not the worktree path).
      3. Add note: at plan completion, after run-full-suite, the orchestrator runs the plan-merge
         step (wt merge main -C <plan-worktree-path>) before the dolt commit.
      4. Parallel tasks from different plans still use separate plan branches with no conflict.

  - id: integration-tests
    content: "Add integration tests for plan-level worktree creation, reuse, commit flow, and plan-branch merge"
    agent: implementer
    changeType: create
    blockedBy: [start-plan-branch-reuse, done-merge-to-plan-branch]
    docs: [testing]
    intent: |
      Create __tests__/integration/plan-worktree.test.ts with integration tests covering:
      1. tg start --worktree on task 1 of a plan: plan.hash_id is set, plan_worktree row exists,
         plan-<hash> branch is created, per-task worktree is a subdirectory branching from plan branch
      2. tg start --worktree on task 2 of same plan: plan_worktree row already exists, returns same
         plan branch name in started event; a fresh per-task worktree is created for this task
      3. tg done (no --merge) on a mid-plan task: plan_worktree row still exists; plan branch not removed
      4. tg done --merge on a task: per-task branch is merged into plan branch (not main);
         verify plan branch now contains the task's commit
      5. tg done --merge on a second task: plan branch has both task commits
      6. Race condition: two simultaneous tg start --worktree for the same plan (simulate with two
         sequential calls before either completes setup) — both succeed without error

      Follow existing integration test patterns from __tests__/integration/. Use makeTestDb or
      equivalent. Cleanup all worktrees and branches in afterEach/afterAll.

  - id: docs-update
    content: "Update multi-agent.md, cli-reference.md, and schema.md for per-plan worktree model"
    agent: documenter
    changeType: modify
    blockedBy:
      [
        integration-tests,
        implementer-commit-step,
        work-skill-plan-branch,
        dispatch-rule-update,
      ]
    docs: [multi-agent, schema, cli]
    intent: |
      Update three docs:
      1. docs/multi-agent.md — Worktrunk section: replace per-task model with per-plan model.
         Describe: plan branch (plan-<hash>), per-task worktrees branching from plan branch,
         tg done --merge target, plan-merge at completion, parallel task handling.
      2. docs/cli-reference.md — tg start --worktree: add note about plan branch creation/reuse.
         tg done --merge: add note about merge target being plan branch, not main.
      3. docs/schema.md — plan table: add hash_id column. Add plan_worktree table section.

  - id: run-full-suite
    content: "Run full test suite (gate:full) to validate per-plan worktree changes"
    agent: implementer
    changeType: test
    blockedBy: [docs-update]
    intent: |
      From repo root, run `pnpm gate:full`. Record the result as evidence. If it passes, mark done
      with "gate:full passed". If it fails, add a tg note with the failure reason and mark done
      with "gate:full failed: <brief reason>" so the orchestrator can create fix tasks.
isProject: false
---

## Analysis

The current per-task worktree model has three compounding failures:

1. `tg done` without `--merge` calls `wt remove --force-delete` which deletes the branch. The work loop never passes `--merge`.
2. Implementers don't commit their work (template says not to), so there's nothing to merge even when `--merge` is eventually passed.
3. Sub-agents may be editing files at the main repo path rather than in the worktree, since their tools use absolute paths and aren't scoped to the worktree.

The result is branches appear (via `tg start --worktree`), disappear (via `tg done`), and all work lands on `main` directly — the worktree infrastructure is a no-op.

The per-plan model fixes all three by making the design intent match actual usage: one feature branch per plan, tasks commit to it, plan merges to main when done.

### Hybrid parallelism

Parallel tasks each still get their own per-task worktree, branching from the plan branch. This preserves the parallel execution model while ensuring all work accumulates on the plan branch before going to main. Sequential execution is not forced; the existing file-conflict check in the work loop is sufficient.

```
main ──────────────────────────────────────────────────────────► main
        │                                                 ▲
        │ (plan start)                                    │ wt merge
        ▼                                                 │
   plan-abc123 ──────────────────────────────────────────►
         │                │                  │
         │ (task 1 start)  │ (task 2 start)   │ (task 3 start)
         ▼                 ▼                  ▼
     tg-t1 ──►         tg-t2 ──►          tg-t3 ──►
     (merge to         (merge to          (merge to
     plan-abc123)      plan-abc123)       plan-abc123)
```

### Plan branch naming

`plan.hash_id` follows the same mechanism as `task.hash_id`. Branch name: `plan-<hash_id>` (e.g. `plan-d4e8f2`). Stable, short, not derived from the plan title (which can change).

### `plan_worktree` table

A dedicated table (not event-log scan) for looking up the plan branch by plan_id. Needed because multiple tasks need to query "what is the plan branch for this plan?" quickly and without scanning all started events.

### Squash merge

`wt merge main -C <plan-worktree-path>` squashes all per-task commits into one merge commit on main. This is the current Worktrunk behavior. Per-task commit granularity is preserved on the plan branch until the squash merge; if fine-grained history is needed, the plan branch can be inspected before it's deleted.

## Dependency graph

```
Parallel start (5):
  ├── schema-plan-worktree          (migrate.ts only; no upstream deps)
  ├── worktree-target-branch        (worktree.ts only; no upstream deps)
  ├── implementer-commit-step       (implementer.md; independent docs change)
  ├── work-skill-plan-branch        (SKILL.md; independent docs change)
  └── dispatch-rule-update          (subagent-dispatch.mdc; independent docs change)

After schema-plan-worktree AND worktree-target-branch:
  ├── start-plan-branch-reuse       (needs both migrations + target-branch helper)
  └── done-merge-to-plan-branch     (needs both migrations + target-branch param)

After start-plan-branch-reuse AND done-merge-to-plan-branch:
  └── integration-tests             (tests the new CLI behavior end-to-end)

After integration-tests AND implementer-commit-step AND work-skill-plan-branch AND dispatch-rule-update:
  └── docs-update                   (documents the complete per-plan model)

After docs-update:
  └── run-full-suite
```

## Open questions

1. **wt merge into non-main target**: Worktrunk's `wt merge` currently always targets the main branch conceptually. The `targetBranch` param change should work, but needs validation against the actual Worktrunk version installed. If `wt merge <plan-branch>` doesn't work (Worktrunk may assume main), fall back to `git merge` for the per-task-to-plan-branch step.

2. **Plan worktree path at plan completion**: The orchestrator needs the plan worktree path to run `wt merge main -C <path>`. It can recover it from: `tg worktree list --json` (the plan-<hash> branch should appear), or by querying the `plan_worktree` table via a future `tg plan worktree <planId>` command. For now, the work SKILL.md should instruct the orchestrator to capture the plan worktree path from the first task's `tg worktree list --json` output and hold it for plan completion.

<original_prompt>
Also maybe it makes sense to have one worktree per project rather then per task. Review this change and tell me what you think. We may as well make a command as part of /work that tells it to git add and commit .taskgraph/dolt as the last action it does after all tasks are done and tests run. Provide a good git message with links to all the prs that got merged for this project.
</original_prompt>
