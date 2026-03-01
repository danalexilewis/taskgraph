# Worktree Workflow Analysis

**Date:** 2026-03-01
**Scope:** Investigation into why worktrunk branches were disappearing, assessment of per-project vs per-task worktree model, and identification of missing dolt-commit step at end of /work.
**Produced by:** Orchestrator analysis (conversation context).

---

## Current State

### What the workflow intends

1. `tg start <taskId> --worktree` creates a git worktree + branch (e.g. `tg-f46186`)
2. Implementer `cd`s to the worktree path and does all work there
3. `tg done <taskId> --merge` squash-merges the branch into `main` via `wt merge`, removes worktree, deletes branch

### What is actually happening

| Step | Intended | Actual |
|------|----------|--------|
| Worktree created | Yes | Yes — branch + directory created |
| Implementer works in worktree | Yes | Likely not — file edits use absolute paths; sub-agents may be editing main repo path |
| Implementer commits in worktree | Yes (implied) | No — template says "Do not commit unless explicitly required" |
| `tg done --merge` runs | Yes | No — `--merge` is never passed in the work loop |
| Branch merged into main | Yes | Never — no merge commits in git log |
| Branch cleaned up | Via merge | Via branch deletion (`git branch -d`) without merging |

**Evidence:**
- `git log --oneline --all --graph` shows all commits landing directly on `main`; no merge commits from task branches
- `git branch -a` shows only `main` + one live worktree branch (`tg-f46186`) currently checked out
- Modified files in `git status` are at the main repo path, not a worktree path
- `tg done --merge` flag exists but is optional and defaults to `false`

### Root causes

1. **`--merge` not wired into the work loop.** The work SKILL.md and subagent-dispatch rule never pass `--merge` to `tg done`. Implementers are told not to commit by default, so there is nothing to merge even if the flag were set.
2. **Implementers don't commit.** The implementer template explicitly says "Do not commit unless the task explicitly requires it." This means worktrees are ephemeral scratch space, not isolated branches.
3. **`tg done` without `--merge` deletes the branch.** The CLI calls `git branch -d <branch>` as part of worktree cleanup when `--merge` is false. The branch disappears rather than being merged.

---

## Per-Task vs Per-Project Worktree Model

### Current: per-task

| Property | Value |
|----------|-------|
| Branch lifetime | Created on `tg start`, deleted on `tg done` |
| Isolation | Each task has its own directory and branch |
| Parallelism | Safe — each task works in its own space |
| Merge requirement | `tg done --merge` (never used in practice) |
| Commit requirement | Implementer must commit before merge (never done) |
| Actual outcome | Worktrees exist as scratch dirs, deleted silently on done |

### Proposed: per-project (one branch per plan)

| Property | Value |
|----------|-------|
| Branch lifetime | Created on first task in plan, merged on plan completion |
| Isolation | All tasks in a plan share one branch and directory |
| Parallelism | Safe if existing file-conflict check is respected |
| Merge requirement | One `wt merge` at plan end (or PR creation) |
| Commit requirement | Implementer commits after each task |
| Actual outcome | Plan work lives on a feature branch; merged atomically |

### Trade-offs

| Concern | Per-task | Per-project |
|---------|----------|-------------|
| Sequential task visibility | Task B cannot see Task A's uncommitted changes | Task B naturally builds on Task A's committed changes |
| Parallel task conflicts | No conflicts (separate worktrees) | No conflicts if file-conflict check respected |
| Branch hygiene | N short-lived branches; no trace in git log | 1 branch per plan; clean history |
| Commit discipline | Commitless; work may be lost | Must commit; healthier habit |
| Merge complexity | N merges (never happening) | 1 merge at plan end |
| Implementation delta | Existing | New: reuse-worktree flag in `tg start`, commit step in implementer, merge step in work loop |

### Recommendation

**Adopt per-project.** The per-task model is not working in practice and adds no isolation benefit when implementers don't commit. Per-project aligns with standard feature-branch workflow and makes the git history meaningful. Required changes:

1. `tg start --worktree` for tasks 2–N in a plan should reuse the existing plan worktree (via a `--plan-branch` or auto-detect flag)
2. Implementer template: commit after completing task work (small, descriptive message per task)
3. Work loop: final task or plan-completion step runs `tg done --merge` (or `wt merge`) to bring the plan branch into main
4. Work SKILL.md: after merge, commit `.taskgraph/dolt` with a message referencing the plan and task IDs

---

## Dolt Commit Step

**Gap identified:** After a work session completes (all tasks done, tests passed), the `.taskgraph/dolt` directory contains the updated task graph state but is never committed to git. This means the task graph and the code it describes get out of sync in the git history.

**Fix applied:** Added `## Final action — commit task graph state` to `.cursor/skills/work/SKILL.md`. The step:
- Runs after the loop reports "plan complete"
- Stages only `.taskgraph/dolt`
- Builds a commit message from the completed task list (with PR URLs if `gh` is available)
- Skips if there are no staged changes

---

## Summary

Worktrunk task branches were being created on every `tg start --worktree` call but deleted silently on `tg done` because: (1) `--merge` was never passed, and (2) implementers never committed their work to the branch. All actual work landed on `main` directly. Switching to a per-project worktree model (one branch per plan, implementer commits per task, single merge at plan end) fixes the root causes and makes the git history reflect the plan-based workflow. A dolt-commit step has been added to the work skill as a quick fix; the per-project model is a separate plan.
