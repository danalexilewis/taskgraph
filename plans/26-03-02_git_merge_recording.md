---
name: Git Merge Recording - Tags and Branch History
overview: After each task worktree merge, create a git tag and/or no-ff merge commit so task boundaries are visible in GitHub history.
fileTree: |
  src/
  ├── cli/
  │   ├── utils.ts              (modify - add RecordMerge type + config field)
  │   ├── worktree.ts           (modify - tag+push helper and --no-ff merge logic)
  │   └── done.ts               (modify - thread taskTitle + taskHashId into merge call)
  __tests__/
  └── integration/
      ├── worktree.test.ts      (modify - tag and no-ff assertions)
      └── plan-worktree.test.ts (modify - tag assertions for plan-branch path)
risks:
  - description: Push to remote fails (no remote or no push credentials)
    severity: medium
    mitigation: Push uses .orElse() soft-fail - warns to console but never fails tg done. Tag is still created locally.
  - description: Worktrunk wt merge is atomic; cannot inject no-ff commit inside it
    severity: low
    mitigation: Worktrunk backend always falls back to tagging only regardless of recordMerge value. Document this behavior.
  - description: hash_id is null on old tasks (created before hash_id column was added)
    severity: low
    mitigation: Fallback in done.ts - extract hashId from worktree_branch by stripping tg- prefix. Skip tag creation if neither is available.
  - description: Tag already exists if tg done is re-run on a completed task
    severity: low
    mitigation: Tag creation is soft-fail (same .orElse() guard). Warn and continue.
tests:
  - "Git backend recordMerge=tag: git tag -l 'task/*' shows task/tg-<hashId> after tg done --merge"
  - "Git backend recordMerge=no-ff: git log --merges shows merge commit 'Merge tg-<hashId>: <title> into <target>'"
  - "recordMerge=false: no tags created, behavior unchanged"
  - "No remote configured: tg done exits 0 with push warning (soft-fail)"
  - "Default (no recordMerge in config.json): tag IS created (default is tag)"
  - "Worktrunk backend: tag created on plan branch tip after wt merge"
todos:
  - id: config-record-merge
    content: "Add RecordMerge type and recordMerge config field to utils.ts"
    agent: implementer
    changeType: modify
    intent: |
      In src/cli/utils.ts:

      1. Add a named type alias before the Config interface:
           export type RecordMerge = "tag" | "no-ff" | false;

      2. Add an optional field to the Config interface:
           recordMerge?: RecordMerge;

      No migration is needed — JSON.parse of config.json returns undefined for missing fields,
      which is the intended default. Consumers apply `config.recordMerge ?? "tag"` to get the
      default-on behavior.

      Export RecordMerge from utils.ts so worktree.ts can import it without circular dependencies
      (worktree.ts already imports Config from utils.ts).
    suggestedChanges: |
      // Before the Config interface in src/cli/utils.ts:
      export type RecordMerge = "tag" | "no-ff" | false;

      // In Config interface:
      recordMerge?: RecordMerge;

  - id: worktree-tag-noff
    content: "Implement createTagAndPush helper and no-ff merge in mergeWorktreeBranchIntoMain"
    agent: implementer
    changeType: modify
    intent: |
      In src/cli/worktree.ts, modify mergeWorktreeBranchIntoMain to accept an optional opts bag:

        opts?: {
          taskTitle?: string;
          taskHashId?: string;   // without tg- prefix, e.g. "abc123" (not "tg-abc123")
          recordMerge?: "tag" | "no-ff" | false;
        }

      (Use the string literal inline for now; T3 will import RecordMerge from utils.ts once T1 lands.)

      === createTagAndPush helper (private) ===

      Add a private helper function:

        function createTagAndPush(
          repoPath: string,
          tagName: string,       // e.g. "task/tg-abc123"
          targetBranch: string,  // e.g. "plan-p-xyz" or "main"
        ): ResultAsync<void, AppError>

      Implementation:
        1. git tag tagName targetBranch  (from repoPath)
        2. git push origin tagName       (from repoPath)
        3. Entire chain wrapped in .orElse(e => { console.warn(`[tg] Warning: ...`); return okAsync(undefined); })
           — soft-fail for both tag and push errors (tag may already exist on re-run; remote may not exist)

      Why tag targetBranch not HEAD: after wt merge, HEAD of repoPath may be main (not the plan
      branch). Using the branch name as the tag target always resolves to the correct tip commit,
      even when that branch is checked out in a different worktree.

      === mergeWorktreeBranchIntoMain changes ===

      Worktrunk backend: after wt merge ResultAsync resolves, chain an additional step:
        - When opts?.recordMerge is "tag" or "no-ff" (both trigger tagging) and opts?.taskHashId is present:
          .andThen(() => createTagAndPush(resolvedRepo, `task/tg-${opts.taskHashId}`, targetBranch))
        - wt merge does squash regardless of recordMerge — no-ff is not available for wt backend.

      Git backend: before the merge step, branch on recordMerge:
        - "no-ff": use git merge --no-ff -m "<message>" branchName
            message = `Merge tg-${taskHashId}: ${taskTitle ?? branchName} into ${targetBranch}`
            If taskHashId is absent, use branchName as the identifier.
        - "tag" or default (not "no-ff"): keep existing git merge branchName (no change to merge command)
        After merge (both no-ff and tag): chain createTagAndPush when taskHashId is present and recordMerge !== false.

      === Signature ===

      Full updated signature:
        export function mergeWorktreeBranchIntoMain(
          repoPath: string,
          branchName: string,
          targetBranch?: string,
          worktreePath?: string,
          backendOverride?: "worktrunk" | "git",
          opts?: {
            taskTitle?: string;
            taskHashId?: string;
            recordMerge?: "tag" | "no-ff" | false;
          },
        ): ResultAsync<void, AppError>

      The single caller in done.ts passes the opts bag; no other callers exist to update.
    suggestedChanges: |
      function createTagAndPush(
        repoPath: string,
        tagName: string,
        targetBranch: string,
      ): ResultAsync<void, AppError> {
        return ResultAsync.fromPromise(
          execa("git", ["tag", tagName, targetBranch], { cwd: repoPath }),
          (e) => buildError(ErrorCode.UNKNOWN_ERROR, `git tag ${tagName} failed`, e),
        )
          .andThen(() =>
            ResultAsync.fromPromise(
              execa("git", ["push", "origin", tagName], { cwd: repoPath }),
              (e) => buildError(ErrorCode.UNKNOWN_ERROR, `git push tag ${tagName} failed`, e),
            ),
          )
          .orElse((e) => {
            console.warn(`[tg] Warning: could not record merge tag ${tagName}: ${e.message}`);
            return okAsync(undefined);
          })
          .map(() => undefined);
      }

  - id: done-thread-title
    content: "Thread taskTitle and taskHashId from done.ts into mergeWorktreeBranchIntoMain opts"
    agent: implementer
    blockedBy: [config-record-merge, worktree-tag-noff]
    changeType: modify
    intent: |
      In src/cli/done.ts:

      1. Extend the task SELECT to include hash_id and title.
         Find the call to q.select("task", { columns: [...], where: { task_id: resolved } }).
         Change columns from ["status", "plan_id"] to ["status", "plan_id", "hash_id", "title"].

      2. Extract the new fields from the task row result. Type them as string | null.

      3. In the if (worktree) block, before calling mergeWorktreeBranchIntoMain, compute:
           const taskHashId: string | undefined =
             (hash_id ?? worktree.worktree_branch?.replace(/^tg-/, "")) || undefined;
           const taskTitle: string | undefined = title ?? undefined;

         The fallback (worktree_branch.replace(/^tg-/, "")) handles old tasks where hash_id is null
         but the branch name encodes the same short hash (e.g. tg-abc123 → abc123).

      4. Update the mergeWorktreeBranchIntoMain call to pass opts as a 6th argument:
           mergeWorktreeBranchIntoMain(
             mergeRepoPath,
             worktree.worktree_branch,
             targetBranch,
             backend === "worktrunk" ? worktreePathClean : undefined,
             backend,
             {
               taskTitle,
               taskHashId,
               recordMerge: config.recordMerge ?? "tag",
             },
           )

         The default `config.recordMerge ?? "tag"` means tagging is active out of the box without
         any config.json change. Users can explicitly set recordMerge: false to opt out, or
         "no-ff" to get merge commits on the git backend.

      5. Import RecordMerge from "./utils" if needed for type safety (opts type in worktree.ts
         will use the inline string literal; this import is optional unless linter flags it).

  - id: test-tag-noff
    content: "Add integration tests for tag creation and no-ff merge recording"
    agent: implementer
    blockedBy: [done-thread-title]
    changeType: modify
    intent: |
      In __tests__/integration/worktree.test.ts and/or __tests__/integration/plan-worktree.test.ts,
      add a describe.serial block for merge recording (or extend the existing merge block).

      Follow the existing pattern: temp git repo, runTgCli, inspect git state afterward.
      Repos in tests have no remote — push will soft-fail; tg done must still exit 0.

      Test cases (in the same describe block for efficiency):

      1. recordMerge="tag" (default): After tg done --merge, run:
           execa("git", ["tag", "-l", "task/*"], { cwd: repoPath })
         Assert one tag matching "task/tg-*" exists.
         Assert tg done exit code = 0.

      2. recordMerge="no-ff": After tg done --merge, run:
           execa("git", ["log", "--merges", "--oneline", "-1"], { cwd: repoPath })
         Assert the output contains "Merge tg-" and the task title substring.
         Also assert a tag exists (no-ff also creates a tag).

      3. recordMerge=false: After tg done --merge, assert git tag -l "task/*" returns empty.
         Assert tg done exits 0.

      4. No remote + default config: Assert tg done exits 0 even though push fails.
         (This is covered implicitly by cases 1-2 since test repos have no remote.)

      Config fixture: Write a config.json with recordMerge set appropriately in each test's
      temp repo (same pattern as existing tests set useWorktrunk: false).

      Keep the new tests in describe.serial and ensure they clean up temp dirs in afterAll.
isProject: false
---

## Analysis

The worktree merge flow currently produces "invisible" squash commits — there's no signal in git history that a commit came from a specific task branch. GitHub's history view just shows a flat stream of commits, making it impossible to tell at a glance where task boundaries are.

Two mechanisms fix this:

**Tags** (`task/tg-<hashId>`) work for both worktrunk and git backends. After any merge completes, we tag the resulting HEAD of the target branch and push. Tags appear next to commits in GitHub's commit history and in `git log --oneline` (`(HEAD -> main, tag: task/tg-abc123)`). Low risk, non-breaking, and compatible with worktrunk's atomic `wt merge`.

**No-ff merge commits** (`--no-ff`) are git-backend only. They create an explicit "Merged branch tg-abc123 into plan-p-xyz" commit with the purple indicator in GitHub's network graph — the clearest possible signal. Worktrunk's `wt merge` is atomic and cannot be modified to produce a no-ff commit, so that backend gets tags only.

**Default behavior**: `recordMerge ?? "tag"` means tagging is on by default without any config.json change. This is safe — tags are additive and don't affect any existing behavior. Users can set `recordMerge: "no-ff"` for the stronger indicator (git backend only), or `false` to opt out.

### Architectural choices

- `RecordMerge` type lives in `utils.ts` (alongside Config) — no circular imports since `worktree.ts` already imports from `utils.ts`.
- `createTagAndPush` is a private helper in `worktree.ts`. The entire helper is soft-fail: push failure logs a warning and returns `okAsync` so `tg done` always succeeds regardless of remote state.
- Title threading: the task SELECT in `done.ts` already queries the task table — we just add `hash_id` and `title` to the column list. No extra round-trips, no schema changes.
- hashId fallback: old tasks without `hash_id` get it extracted from `worktree_branch` (strip `tg-` prefix), since the branch naming convention encodes the same value.

### Why not push the full branch?

Pushing the task branch before deletion would preserve commits in the remote, but GitHub wouldn't show it as "merged" without a PR. Tags give cleaner signal for less infrastructure. PRs are the natural next step (explicitly deferred to a future plan).

## Dependency graph

```
Parallel start (2 unblocked):
  ├── config-record-merge  (add RecordMerge type to utils.ts)
  └── worktree-tag-noff    (implement createTagAndPush + no-ff in worktree.ts)

After both:
  └── done-thread-title    (thread title + hashId from done.ts; connect config.recordMerge)

After done-thread-title:
  └── test-tag-noff        (integration tests for tag + no-ff scenarios)
```

## Open questions

None — all architectural choices are resolved above.

<original_prompt>
can we make tasktrunk squash commits generate branches and PRs?

maybe not actually prs that need something else te review it (yet)

but for now just at least recording the trunk being merged in as a merged branch.

alternatively we could tag squash commits.

My objective is to make it easier to read the git history in github and I think branches being merged shows the worktrunk pattern thebest.

---

One question before I write the plan: do you want to push the task branches / tags to a remote automatically? yes assume the environment is setup for this.

Should I thread it through so the merge commit message can say Merge tg-abc123: "Add migration for is_benchmark" instead of just the hash? yes
</original_prompt>
