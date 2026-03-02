---
name: Git Workflow Tidy-Up
overview: Enforce no-ff merge commits, add tg merge-plan command, guard dirty worktrees, document commit conventions, and prepare for future PR/CodeRabbit workflow.
fileTree: |
  src/
  ├── cli/
  │   ├── worktree.ts          (modify - add commitMessage param, --no-ff on git backend)
  │   ├── done.ts              (modify - guard uncommitted changes, warn without --merge)
  │   └── merge-plan.ts        (create - new tg merge-plan command)
  .cursor/
  └── agents/
      └── implementer.md       (modify - commit message convention)
  docs/
  └── multi-agent.md           (modify - merge topology and commit convention)
  __tests__/
  └── integration/
      └── git-workflow.test.ts (create - no-ff merge, dirty guard, warn-no-merge)
risks:
  - description: tg merge-plan modifies git history on main; if run on wrong branch it could disrupt the repo
    severity: medium
    mitigation: Validate that target branch exists and plan_worktree row is present; dry-run output before merge
  - description: Worktrunk wt merge squashes task->plan commits; changing git backend no-ff only affects non-Worktrunk setups
    severity: low
    mitigation: Document clearly which backend produces which topology; no-ff on git backend is still correct for that path
  - description: Uncommitted-changes guard could block agents that rely on auto-stashing
    severity: low
    mitigation: Error message should be clear and actionable; no silent failure
tests:
  - "tg done --merge on git backend produces a no-ff merge commit, not a fast-forward"
  - "tg done --merge with dirty worktree exits with a clear error before merging"
  - "tg done without --merge on a worktree task prints a warning naming the unmerged branch"
  - "tg merge-plan merges the plan branch into main with --no-ff and semantic commit message"
todos:
  - id: no-ff-merge-message
    content: "Enforce --no-ff on git backend merge and pass semantic commit message"
    agent: implementer
    changeType: modify
    intent: |
      In `src/cli/worktree.ts`, update `mergeWorktreeBranchIntoMain` to:
      1. Accept an optional `commitMessage?: string` parameter (after `backendOverride`).
      2. On the git backend path, change `git merge <branchName>` to
         `git merge --no-ff -m <commitMessage ?? "Merge branch '<branchName>'>` .
         This ensures every task->plan merge produces a real merge commit, not a fast-forward.
      3. No change to the Worktrunk path (wt merge handles its own commit).

      In `src/cli/done.ts`, update the call to `mergeWorktreeBranchIntoMain` to pass a
      semantic `commitMessage`. To build the message, look up the task title from Dolt:
      query `task` table by `id = resolved` (already available), get `content` column.
      Message format: `"Merge task <hashId>: <task title>"`.
      If the DB lookup fails, fall back to `"Merge task branch <branchName>"` — do not
      block the merge on a title-lookup failure.

      Also update `mergeWorktreeBranchIntoMain` JSDoc to document the new parameter.
    docs:
      - multi-agent
      - infra

  - id: merge-plan-command
    content: "Add tg merge-plan <planId> command to merge plan branch into main with --no-ff"
    agent: implementer
    changeType: create
    intent: |
      Create `src/cli/merge-plan.ts` with a Commander command `tg merge-plan <planId>`.

      What it does:
      1. Read config (readConfig + rootOpts pattern from utils.ts).
      2. Look up the plan_worktree row for this planId: select `worktree_branch` from `plan_worktree`.
         If no row, exit with error: "No plan worktree found for <planId> — has the plan been started with --worktree?"
      3. Look up the plan name from the `project` table where `id = planId`; count done tasks.
      4. Run: `git -C <repoPath> merge --no-ff -m "Merge plan '<name>': <N> tasks" <planBranch>`
         where repoPath = process.cwd() (the repo root, not the plan worktree).
         The plan branch is checked out in a separate worktree; to merge it without checking it out
         in main, use: `git merge --no-ff -m "..." <planBranch>` from the main checkout.
         NOTE: if the main checkout is currently on a different branch, error out with instructions
         rather than auto-switching.
      5. Print success: "Merged plan branch <planBranch> into <mainBranch>."
      6. Optionally print: "Run `git push` to push to remote when ready for PR."

      Register the command in `src/cli/index.ts` (import and add `.addCommand(mergePlanCommand)`).

      Keep the function pure/composable: extract `executeMergePlan(config, planId)` returning
      `ResultAsync<MergePlanResult, AppError>` so it is testable without the Commander wrapper.

      Do NOT delete the plan_worktree row or the plan branch — leave cleanup to /clean-up-shop.
    docs:
      - multi-agent
      - cli-reference

  - id: guard-uncommitted-changes
    content: "Exit with error if worktree has uncommitted changes at tg done --merge"
    agent: implementer
    changeType: modify
    intent: |
      In `src/cli/done.ts`, in the `if (options.merge)` block, BEFORE calling
      `mergeWorktreeBranchIntoMain`, add a git status check:

      Run `git -C <worktreePathClean> status --porcelain` using execa.
      If stdout is non-empty (dirty working tree):
        - Set `worktreeMergeFailed = true`.
        - Add to results: `{ id: resolved, error: "Worktree has uncommitted changes. Commit or stash in <worktreePathClean> before running tg done --merge." }`.
        - Set `anyFailed = true`.
        - Skip the merge (continue to next task ID).

      This applies only when `worktreePathClean` is set (task was started with --worktree).
      When Worktrunk backend: same check applies — dirty worktree should fail cleanly.

      Use `ResultAsync.fromPromise(execa(...), ...)` pattern consistent with rest of done.ts.
      If the `git status` call itself fails (not a git repo, wt, etc.), treat as a warning
      rather than a hard failure — log and proceed.
    docs:
      - multi-agent

  - id: warn-done-without-merge
    content: "Warn when tg done is called without --merge on a worktree task"
    agent: implementer
    changeType: modify
    intent: |
      In `src/cli/done.ts`, in the block that handles a task with a worktree (i.e. where
      `worktree` is non-null from `getStartedEventWorktree`), after the existing
      `if (options.merge) { ... }` block, add an `else` branch:

      ```
      } else {
        console.warn(
          `Warning: task ${resolved} was started with a worktree (branch: ${worktree.worktree_branch}). `+
          `Branch was NOT merged into ${targetBranch ?? "main"}. Run \`tg done ${resolved} --merge\` `+
          `or merge manually before the plan branch is merged into main.`
        );
      }
      ```

      This is a console.warn (non-fatal). The task still transitions to done. The purpose is
      visibility — agents and humans should know the branch is dangling.

      The target branch name for the warning message: derive from planWorktree?.branch ?? config.mainBranch ?? "main".
      You'll need to resolve planWorktree before the if/else (it's already resolved above in the merge block).
      Refactor slightly so `planWorktree` is resolved once and shared between the `if` and `else` branches.
    docs:
      - multi-agent

  - id: commit-convention-docs
    content: "Document agent commit message convention in implementer.md and multi-agent.md"
    agent: documenter
    changeType: modify
    intent: |
      Two doc updates:

      1. `.cursor/agents/implementer.md` — add a "Commit message convention" section (or
         subsection under an existing commits/git section if one exists):
         - Format: `task(<hashId>): <description>` for every commit made inside a task worktree.
         - `hashId` is the short hash from `tg context <taskId>` (the `tg-<hashId>` branch suffix).
         - `description` is imperative mood, max ~72 chars, e.g. `task(a3f2c1): add --no-ff to merge path`.
         - Infrastructure commits (package.json, tsconfig, migration files) may use conventional
           commit format: `chore(scope): ...` or `fix(scope): ...`.
         - Do NOT leave commits as "checkin" or "WIP" — they appear verbatim in PRs.

      2. `docs/multi-agent.md` — add a "Merge topology and commit conventions" section:
         - Describe the two backends (Worktrunk squashes task->plan; git backend produces merge commits).
         - State the desired end state: plan branch accumulates commits/merge commits; plan->main
           uses `tg merge-plan` for a --no-ff merge commit with semantic message.
         - Reproduce the commit format from implementer.md.
         - Note that `tg merge-plan` should be run before PR creation.
    docs:
      - multi-agent
      - agent-contract

  - id: integration-tests
    content: "Integration tests for no-ff merge, dirty-worktree guard, and no-merge warning"
    agent: implementer
    blockedBy:
      [
        no-ff-merge-message,
        guard-uncommitted-changes,
        warn-done-without-merge,
        merge-plan-command,
      ]
    changeType: create
    intent: |
      Create `__tests__/integration/git-workflow.test.ts` with tests for the new behaviors.
      Use the existing integration test harness (see __tests__/integration/ for patterns —
      use createTestDatabase, TestHarness, or whatever the shared setup is).

      Tests to cover (use git backend, not Worktrunk, for deterministic merge behavior):
      1. `tg done --merge` on git backend produces a no-ff merge commit:
         - Create a task worktree on git backend.
         - Commit a file change in the worktree.
         - Run `tg done <taskId> --merge`.
         - Assert `git log --merges` on the target branch includes a merge commit whose message
           contains the task's hash_id.
         - Assert the branch graph has a merge topology (parent count = 2 on merge commit).
      2. `tg done --merge` with uncommitted changes fails:
         - Create a task worktree; write a file without committing.
         - Run `tg done <taskId> --merge`.
         - Assert exit code != 0 and error message mentions "uncommitted changes".
         - Assert the target branch is unchanged (no merge happened).
      3. `tg done` without `--merge` on a worktree task prints a warning:
         - Create a task worktree; commit a change.
         - Run `tg done <taskId>` (no --merge).
         - Assert stdout/stderr contains "was NOT merged" or equivalent warning text.
         - Assert task transitions to done despite the warning.
      4. `tg merge-plan` produces --no-ff merge onto main:
         - Set up a plan with one done task whose worktree branch has been merged into the plan branch.
         - Run `tg merge-plan <planId>` from the repo root.
         - Assert `git log --merges HEAD` includes a merge commit whose message contains the plan name.
    docs:
      - testing

  - id: run-full-suite
    content: "Run gate:full from plan worktree to confirm all tests pass"
    agent: implementer
    blockedBy: [integration-tests]
    changeType: modify
    intent: |
      Run `pnpm gate:full` from inside the plan worktree. Record pass/fail in evidence.
      If gate:full fails, report failures in tg note and do not mark done.
isProject: true
---

## Analysis

The current git workflow has several gaps that make history opaque and PR creation awkward:

1. **Worktrunk squashes** task→plan commits, producing a flat linear history (`git log --graph` shows no branches)
2. **Git backend** uses bare `git merge` (fast-forward when possible), losing branch topology
3. **No `tg merge-plan`** — the plan→main merge is done manually with no enforced convention
4. **No uncommitted-change guard** — `tg done --merge` silently loses dirty worktree state
5. **No convention for agent commit messages** — "checkin", "WIP", and UUID-bearing messages coexist

The plan tightens the git backend path (`--no-ff` + semantic messages), adds a `tg merge-plan` command for the final plan→main step, adds defensive guardrails around common failure modes, and documents what the commit convention should be.

Worktrunk squash behaviour is left unchanged — it's the current default (`useWorktrunk: true`) and changing it requires Worktrunk config knowledge outside this codebase. The improvements here ensure that (a) the git backend path is solid for non-Worktrunk setups, and (b) the **plan→main merge** (which uses `git` regardless of backend) is always a proper `--no-ff` merge commit.

## Dependency graph

```
Parallel start (5 unblocked):
  ├── no-ff-merge-message         (modify worktree.ts + done.ts — no-ff + semantic msg)
  ├── merge-plan-command          (create merge-plan.ts + register in index.ts)
  ├── guard-uncommitted-changes   (modify done.ts — dirty worktree guard)
  ├── warn-done-without-merge     (modify done.ts — warning when --merge skipped)
  └── commit-convention-docs      (doc task — implementer.md + multi-agent.md)

After no-ff-merge-message, merge-plan-command, guard-uncommitted-changes, warn-done-without-merge:
  └── integration-tests           (create git-workflow.test.ts)

After integration-tests:
  └── run-full-suite              (gate:full from plan worktree)
```

## Notes

- `done.ts` is touched by three tasks (no-ff-merge-message, guard-uncommitted-changes, warn-done-without-merge). To avoid conflicts, those three tasks should not run in the same worktree simultaneously. The task graph will serialize them if they share a worktree — but in parallel execution, the orchestrator should assign them to separate agents and be aware of the overlap.
- `tg merge-plan` does not delete the plan branch or plan_worktree row. That is handled by `/clean-up-shop`.
- The no-ff change only affects the git backend. Worktrunk (`wt merge`) continues to squash — this is fine for internal use; when a PR is desired, the plan branch is a clean accumulation of squashed commits.

<original_prompt>
improving use of git with projects. Id like to use branches/worktrunks that get merged into main as a branch. we dont atm need to do pr requests, but we may in the future as we can then leverage projects like coderabbit for further intel.

but for now lets just tidy up our use of git.
</original_prompt>
