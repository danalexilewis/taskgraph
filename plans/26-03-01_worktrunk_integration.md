---
name: Worktrunk Integration
overview: Delegate tg worktree management to Worktrunk (wt) CLI with graceful fallback to raw git when wt is not installed.
fileTree: |
  src/cli/
  ├── worktree.ts              (modify - replace raw git with wt delegation + fallback)
  ├── start.ts                 (modify - pass hash_id for branch naming, detect wt)
  ├── done.ts                  (modify - use wt merge/remove when available)
  ├── utils.ts                 (modify - add useWorktrunk to Config)
  └── index.ts                 (no change)
  .config/
  └── wt.toml                  (create - project-level Worktrunk hooks)
  __tests__/integration/
  └── worktree.test.ts         (modify - test both backends)
risks:
  - description: wt switch --create does not expose the created worktree path in stdout; must query wt list --format json after creation to discover it
    severity: medium
    mitigation: Parse wt list --format json filtering by branch name; verified this returns path field in JSON output
  - description: wt merge runs in the worktree's cwd and does squash+rebase+remove in one step; tg done currently does merge then remove separately
    severity: low
    mitigation: Use -C <worktreePath> flag on wt merge; skip separate remove call since wt merge handles cleanup
  - description: wt list --help panics on v0.26.1 (capacity overflow); wt list --format json works fine
    severity: low
    mitigation: Only use wt list --format json, not --help; document minimum wt version if needed
  - description: Integration tests need wt installed to test the Worktrunk path; CI may not have it
    severity: medium
    mitigation: Auto-detect wt availability in tests; skip Worktrunk-specific tests when absent; always test raw git fallback
  - description: Existing worktrees use tg/<uuid> naming and .taskgraph/worktrees/ paths; new ones will use tg-<hash_id> and wt-computed paths
    severity: low
    mitigation: done.ts already reads worktree_path and worktree_branch from the started event; backward compat is automatic
tests:
  - "wt detection: isWorktrunkAvailable returns true when wt is on PATH, false otherwise"
  - "Branch naming: worktreeBranchName returns tg-<hash_id> when hash_id provided, tg/<uuid> for raw git fallback"
  - "Worktrunk create: createWorktree delegates to wt switch -c and resolves path from wt list --format json"
  - "Worktrunk merge+remove: mergeAndRemoveWorktree delegates to wt merge with -C flag"
  - "Worktrunk remove (no merge): removeWorktree delegates to wt remove <branch>"
  - "Raw git fallback: all operations work when wt is not installed"
  - "tg start --worktree stores correct branch name and path in event body for both backends"
  - "tg done --merge cleans up worktree for both backends"
todos:
  - id: wt-cfg-detect
    content: "Add Worktrunk detection and Config support"
    agent: implementer
    intent: |
      Add `useWorktrunk?: boolean` to the Config interface in `src/cli/utils.ts`.
      Create a new exported function `isWorktrunkAvailable(): boolean` in `src/cli/worktree.ts`
      that checks if `wt` is on PATH by running `wt --version` via execa (sync, wrapped in try/catch).
      Cache the result for the process lifetime (module-level let).

      The resolution logic: if config.useWorktrunk is explicitly true, use wt (error if not found).
      If explicitly false, use raw git. If undefined, auto-detect (use wt if available, else raw git).

      Export a `resolveWorktreeBackend(config: Config): 'worktrunk' | 'git'` function that
      encapsulates this logic.

      Do NOT change any other files in this task.
    changeType: modify

  - id: wt-branch-name
    content: "Switch branch naming from UUID to hash_id for Worktrunk"
    agent: implementer
    intent: |
      Currently `worktreeBranchName(taskId)` returns `tg/<uuid>`. For Worktrunk, branch names
      with `/` work but display poorly. Change to:

      - New function `worktreeBranchForTask(taskId: string, hashId?: string): string`
        - When hashId is provided: return `tg-<hashId>` (e.g. `tg-abc123`)
        - When hashId is null/undefined: return `tg/<taskId>` (backward compat for raw git)
      - Keep the old `worktreeBranchName(taskId)` as a deprecated alias that calls
        `worktreeBranchForTask(taskId)` (no hashId = old behavior)
      - Update `start.ts` to fetch the task's hash_id before calling createWorktree.
        The hash_id is already in the task table. Add a query in startOne to get it:
        `SELECT hash_id FROM task WHERE task_id = '<id>'` (already querying task for status,
        can add hash_id to that select).
      - Pass hashId to createWorktree so it can use the right branch name.

      Do NOT change createWorktree/removeWorktree internals yet — just the naming.
    changeType: modify
    blockedBy: [wt-cfg-detect]

  - id: wt-create-wt
    content: "Implement Worktrunk-backed createWorktree with fallback"
    agent: implementer
    intent: |
      Modify `createWorktree` in `src/cli/worktree.ts` to support both backends.

      **Worktrunk path** (when backend is 'worktrunk'):
      1. Run `wt switch --create <branchName> --no-cd --no-verify -y -C <repoPath>`
         via execa. The `--no-cd` flag prevents shell directory change (we're in a Node process).
         `--no-verify` skips hooks during programmatic creation (tg manages its own lifecycle).
         `-y` skips approval prompts.
      2. After creation, run `wt list --format json -C <repoPath>` and parse the JSON array.
         Find the entry where `branch === branchName`. Extract its `path` field.
      3. Return `{ worktree_path: path, worktree_branch: branchName }`.

      **Raw git path** (fallback): Keep existing `git worktree add -b` logic unchanged.

      Accept a `backend: 'worktrunk' | 'git'` parameter (or resolve it internally from config).
      Signature becomes:
      ```
      createWorktree(taskId, repoPath, options: {
        backend: 'worktrunk' | 'git';
        hashId?: string;
        baseBranch?: string;
      }): ResultAsync<{ worktree_path: string; worktree_branch: string }, AppError>
      ```

      The old signature should still work for backward compat — make the third param optional
      and default to `{ backend: 'git' }` when a string (baseBranch) is passed.

      Important: `wt` binary is invoked as `wt` (not a full path). Use `command wt` or just
      `wt` — execa resolves from PATH.

      Note: `wt switch` uses shell integration for cd; in a Node subprocess it won't cd.
      The `--no-cd` flag is still good practice to be explicit.
    changeType: modify
    blockedBy: [wt-branch-name]

  - id: wt-merge-rm
    content: "Implement Worktrunk-backed merge and remove with fallback"
    agent: implementer
    intent: |
      Modify `removeWorktree` and `mergeWorktreeBranchIntoMain` in `src/cli/worktree.ts`.

      **mergeWorktreeBranchIntoMain — Worktrunk path:**
      When backend is 'worktrunk', replace the entire function body with:
      ```
      wt merge <mainBranch> -C <worktreePath> --no-verify -y
      ```
      This does squash + rebase + merge + worktree removal + branch deletion in one step.
      Return success. The caller (done.ts) should NOT call removeWorktree separately when
      using wt merge — wt merge already removes the worktree.

      **mergeWorktreeBranchIntoMain — Raw git path:**
      Keep existing `git checkout main && git merge <branch>` logic.

      **removeWorktree — Worktrunk path:**
      ```
      wt remove <branchName> --force --force-delete --no-verify -y -C <repoPath>
      ```
      `--force` handles untracked files (build artifacts). `--force-delete` handles unmerged branches.
      `--foreground` ensures we wait for completion (default is background removal).
      Actually check: `wt remove` defaults to background. Add `--foreground` to ensure
      synchronous completion so tg done can report success/failure accurately.

      **removeWorktree — Raw git path:**
      Keep existing `git worktree remove --force` + optional `git branch -d` logic.

      Update signatures to accept `backend` parameter similar to createWorktree.

      **Critical change in done.ts:** When backend is 'worktrunk' and `--merge` is used,
      call only mergeWorktreeBranchIntoMain (which does merge + remove). Do NOT call
      removeWorktree afterward. When `--merge` is NOT used, call only removeWorktree.
      This replaces the current pattern where done.ts calls merge then remove separately.

      Update done.ts to detect the backend (read config, call resolveWorktreeBackend).
    changeType: modify
    blockedBy: [wt-create-wt]

  - id: wt-list-dlg
    content: "Delegate tg worktree list to wt list when available"
    agent: implementer
    intent: |
      Modify `listWorktrees` and the `worktreeCommand` list action in `src/cli/worktree.ts`.

      When backend is 'worktrunk':
      - `listWorktrees` calls `wt list --format json -C <repoPath>` and maps the JSON
        to `WorktreeEntry[]`. The wt JSON has `branch`, `path`, `commit.sha` fields.
        Map: `{ path: entry.path, commit: entry.commit.sha, branch: entry.branch }`.
      - The CLI action for `tg worktree list` (non-JSON mode) can optionally shell out
        to `wt list -C <repoPath>` directly for the rich colored output. Only do this
        when NOT in --json mode. When --json, use the parsed WorktreeEntry[] format
        for backward compat.

      When backend is 'git': keep existing `git worktree list --porcelain` parsing.

      Read config in the action handler to determine backend.
    changeType: modify
    blockedBy: [wt-cfg-detect]

  - id: wt-proj-cfg
    content: "Create .config/wt.toml with project hooks"
    agent: implementer
    intent: |
      Create `.config/wt.toml` in the repo root with Worktrunk project hooks:

      ```toml
      [post-create]
      install = "pnpm install"
      build = "pnpm build"
      env = "cp \"$ROOT_WORKTREE_PATH/.env.local\" .env.local 2>/dev/null || true"

      [pre-merge]
      gate = "pnpm gate"
      ```

      The post-create hooks run when a worktree is created (via wt switch --create).
      They install deps, build, and copy .env.local from the main worktree.
      The pre-merge hook runs pnpm gate before allowing merge to main.

      Also add `.config/wt.toml` to the template at `src/template/.config/wt.toml`
      so that `tg setup` scaffolds it for consuming projects. Use a minimal version
      with commented-out examples since consuming projects have different build systems.

      Add `.config/` to .gitignore exclusion if needed (check if .config/ is already tracked).
    changeType: create

  - id: wt-integ-tests
    content: "Update integration tests for both Worktrunk and raw git backends"
    agent: implementer
    intent: |
      Update `__tests__/integration/worktree.test.ts` to test both backends.

      **Structure:**
      - Keep the existing test suite as the "raw git backend" tests (they should still pass
        as-is since the fallback preserves current behavior).
      - Add a new `describe.serial("Worktree with Worktrunk backend", ...)` block that:
        1. Checks if `wt` is available (skip if not: `describe.skipIf(!isWorktrunkAvailable())`)
        2. Creates a temp dir with git init + initial commit (same as existing setup)
        3. Sets up a taskgraph config with `useWorktrunk: true`
        4. Tests `tg start --worktree` creates a worktree via wt (branch name is `tg-<hash_id>`)
        5. Tests `tg done` removes the worktree
        6. Tests `tg done --merge` merges and removes via wt merge
        7. Verifies worktree path is NOT under `.taskgraph/worktrees/` (it's wherever wt puts it)
        8. Verifies branch name is `tg-<hash_id>` not `tg/<uuid>`

      **Key assertions for Worktrunk path:**
      - After start: `wt list --format json` shows the branch
      - After done: `wt list --format json` does NOT show the branch
      - Event body contains correct `worktree_path` and `worktree_branch`

      Use `--no-verify` or set up hook approvals in test setup to avoid interactive prompts.

      The raw git tests should continue to work unchanged (they don't set useWorktrunk).
    changeType: modify
    blockedBy: [wt-merge-rm, wt-list-dlg]

  - id: wt-clean-stale
    content: "Clean up stale UUID worktrees from .taskgraph/worktrees/"
    agent: implementer
    intent: |
      The repo currently has 6 stale worktrees under `.taskgraph/worktrees/` with UUID names.
      Most show as "integrated" or "behind" in wt list --format json.

      Run `wt remove <branch> --force --force-delete -y` for each stale worktree branch.
      Specifically these branches (from wt list output):
      - tg/2e10b8b8-378e-4225-878d-8f7e46af675f
      - tg/313c7a3c-4535-4755-9123-89eb49590541
      - tg/6391dd9b-c0bf-4e64-a6fa-5e346c591b22
      - tg/84538d6d-c16e-4c07-a485-0dba4313627e
      - tg/c84aaf29-fae3-4d9f-9a78-ec6473481ed5
      - tg/fc5ef7ea-04b1-43f8-a639-9e4ff880a362

      After cleanup, verify with `wt list` that only main remains.
      Also verify with `git worktree list` for confirmation.

      This is a one-time cleanup task. Use shell commands, not code changes.
      Evidence: list of removed worktrees and final wt list output.
    changeType: modify
isProject: false
---

## Analysis

### Why Worktrunk

Task-Graph currently manages worktrees with raw `git worktree add/remove` using UUID-based paths
(`.taskgraph/worktrees/<uuid>`) and branch names (`tg/<uuid>`). This works but is painful:

- UUIDs are opaque — `wt list` shows 6 identical-looking entries with no context
- No build cache sharing between worktrees (cold `pnpm install` each time)
- No merge workflow — raw `git merge` with no squash/rebase
- No lifecycle hooks for setup/validation
- Manual cleanup of stale worktrees

Worktrunk solves all of these with human-readable branch names, hooks, `wt merge` (squash+rebase+cleanup),
and `wt list` with rich status display.

### Design decisions

1. **Branch naming**: `tg-<hash_id>` (e.g. `tg-abc123`) instead of `tg/<uuid>`. The hash_id is
   already allocated for every task and is 6-7 hex chars — short, unique, and Worktrunk-friendly
   (no `/` in branch names). Raw git fallback keeps `tg/<uuid>` for backward compat.

2. **Path discovery**: Worktrunk computes worktree paths from its config template (default: sibling
   directory `repo.branch`). After `wt switch --create`, we query `wt list --format json` to
   discover the path. This is one extra subprocess call but keeps tg decoupled from wt's path logic.

3. **Merge flow**: `wt merge` does squash + rebase + merge + remove in one atomic operation.
   When using Worktrunk, `tg done --merge` delegates entirely to `wt merge` and skips the
   separate `removeWorktree` call. Without `--merge`, `tg done` uses `wt remove`.

4. **Fallback**: All operations check the resolved backend ('worktrunk' | 'git') and branch
   to the appropriate implementation. Existing behavior is preserved when wt is not installed.

5. **Hooks**: `.config/wt.toml` provides post-create (install, build, copy env) and pre-merge
   (gate) hooks. These run automatically when Worktrunk manages the lifecycle. When tg creates
   worktrees programmatically, it uses `--no-verify` to skip hooks (the implementer agent
   handles its own setup).

### Dependency graph

```
Parallel start (2 unblocked):
  ├── wt-cfg-detect (Config + detection utility)
  └── wt-proj-cfg (.config/wt.toml + template)

After wt-cfg-detect:
  ├── wt-branch-name (hash_id-based branch names)
  └── wt-list-dlg (tg worktree list delegation)

After wt-branch-name:
  └── wt-create-wt (Worktrunk-backed create)

After wt-create-wt:
  └── wt-merge-rm (Worktrunk-backed merge + remove + done.ts changes)

After wt-merge-rm + wt-list-dlg:
  └── wt-integ-tests (test both backends)

Independent (can run anytime):
  └── wt-clean-stale (remove 6 stale UUID worktrees)
```

### Out of scope

- **Cursor CLI agent integration** (`wt switch -x agent`): This plan focuses on tg's internal
  worktree management. The Cursor CLI dispatch pattern is a separate concern — once tg uses
  Worktrunk, the user can manually use `wt switch -c <branch> -x agent` or we can add a
  `tg dispatch` command later.
- **Worktrunk user config** (`~/.config/worktrunk/config.toml`): Personal preference; not
  managed by tg.
- **Claude Code plugin**: Separate tool; not part of tg.
- **Worktree path template customization**: Users configure this in their Worktrunk user config.
  tg discovers paths via `wt list --format json` regardless of template.

<original_prompt>
User wants to integrate Worktrunk (wt CLI) as the worktree management backend for Task-Graph,
replacing raw git worktree commands. Option B: tg delegates to Worktrunk under the hood with
graceful fallback to raw git when wt is not installed.
</original_prompt>
