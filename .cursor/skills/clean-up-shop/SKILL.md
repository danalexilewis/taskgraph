---
name: clean-up-shop
description: Clean up worktrees, stale branches, and orphaned directories after a work session when no jobs are in flight. Use when the user says "clean up shop", "clean house", "no jobs in flight", "clean up worktrees", "remove worktrees", or after completing a /work session.
---

# Clean Up Shop

**You** (the lead) do the cleanup. Do not dispatch sub-agents.

Post-session housekeeping: return the main checkout to `main`, merge completed work, remove worktree directories, and delete merged branches.

## Decision map

```
for each worktree (excluding main):
  commits ahead of main? ──yes──► merge to main if clean, keep branch ref if conflicting
  uncommitted changes?   ──yes──► task done? discard changes. task doing? leave for human.
  nothing special?       ──────► remove worktree, delete branch
```

## Steps

**1. Orient**

```bash
pnpm tg worktree list --json
pnpm tg status --tasks    # look for any tasks still doing
```

Check whether the main repo itself is on a non-main branch:

```bash
git branch                # is * something other than main?
```

**2. Handle main repo on a task branch**

If the main checkout is on a task branch (e.g. `tg-XXXXXX`):

```bash
# a. Commit any pending orchestrator changes
git add -A && git commit -m "chore(orchestrator): <description of session changes>"

# b. Commit the dolt journal if it's dirty too
git add .taskgraph/dolt && git commit -m "chore: persist dolt journal state"

# c. Switch to main and fast-forward merge
git checkout main && git merge <task-branch>

# d. Delete the task branch
git branch -d <task-branch>
```

> If `git checkout main` fails on dolt journal files: commit those files first (step b), then retry.

**3. Assess each external worktree**

For each entry in `tg worktree list --json` that is NOT the main repo path:

```bash
# Check commits this branch has that main doesn't
git log --oneline main..<branch-name>

# Check for uncommitted changes
cd <worktree-path> && git status --short
```

| State                             | Action                                                        |
| --------------------------------- | ------------------------------------------------------------- |
| 0 commits ahead, no changes       | Remove worktree, delete branch                                |
| Commits ahead, no merge conflicts | `git merge --no-ff` from main; remove worktree; delete branch |
| Commits ahead, conflicts          | Remove worktree; **keep branch** — note for human             |
| Uncommitted changes, task `done`  | `git restore .` in worktree, then remove + delete branch      |
| Uncommitted changes, task `doing` | Leave for human; do not discard                               |

**4. Remove worktrees**

```bash
# From main repo root — removes the directory, NOT the branch
git worktree remove /path/to/worktree

# If it has uncommitted changes that you've already discarded:
git worktree remove --force /path/to/worktree
```

**5. Remove orphaned directories**

After removing all registered worktrees, check for leftover directories:

```bash
ls /path/to/repos/ | grep Task-Graph   # substitute the actual parent dir
rm -rf /path/to/repos/Task-Graph.<stale-hash>
```

**6. Delete merged branches**

```bash
# Safe delete (only if merged into current branch)
git branch -d <branch-name>

# For branches that are merged but git doesn't know it (e.g. squash merges):
git branch -D <branch-name>   # force — only do this after verifying contents
```

**Keep as branch refs (no worktree)**: Branches with unique commits that conflicted. They cost no disk space and the human can decide later.

**7. Process pending learnings**

```bash
ls .cursor/pending-learnings.md 2>/dev/null && echo "process this file"
```

If `pending-learnings.md` exists: route its learnings to `docs/` or `.cursor/memory.md` following the memory.mdc routing guide, then delete it.

**8. Verify**

```bash
git worktree list          # should show only main checkout
git branch                 # remaining branches are intentional
git status                 # clean working tree
ls /path/to/repos/ | grep Task-Graph   # no orphaned directories
```

## Common gotchas

- **Dolt journal files block `git checkout main`** — commit `.taskgraph/dolt` first, then checkout.
- **Merge conflicts on plan branches** — plan branches often diverge far from main when multiple plans run in parallel. Prefer removing the worktree and keeping the branch for deliberate later resolution; don't force-merge conflicting changes.
- **Orphaned directories after `git worktree remove`** — `git worktree remove` unregisters the worktree but may leave the directory. Always run the `ls` check in step 5.
- **Task is still `doing`** — do not discard uncommitted work from a `doing` task. Either hand it to a fixer agent or leave it for the human.
