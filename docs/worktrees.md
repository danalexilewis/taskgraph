---
triggers:
  files: ["src/cli/worktree.ts", "src/cli/start.ts", "src/cli/done.ts", ".cursor/skills/commit-messages/**", ".cursor/skills/clean-up-shop/**", ".cursor/skills/work/**"]
  change_types: ["create", "modify"]
  keywords: ["worktree", "Worktrunk", "plan branch", "tg start", "tg done", "plan_worktree"]
---

# Worktrees

How worktrees are used across task-graph execution, commit-messages, and cleanup; how to avoid common failures; and how to fix them when they occur.

## Purpose

This doc **owns**:

- The **task-graph worktree model**: per-plan + per-task worktrees (Worktrunk or raw git). Commit-messages does **not** use worktrees — the lead stages and commits in the main repo.
- **Optimization rules** so skills and agents use worktrees consistently and don’t conflict.
- **Troubleshooting**: symptom → cause → fix for the most common worktree problems.

It **does not** own: Dolt schema details (see [schema.md](schema.md)), full CLI reference (see [cli-reference.md](cli-reference.md)), or multi-agent coordination (see [multi-agent.md](multi-agent.md)).

## Task-graph worktree model

| Model | Who creates | Backend | Merge target | Used by |
| ----- | ----------- | ------- | ------------ | ------- |
| **Task-graph (plan/task)** | `tg start <taskId> --worktree` | Worktrunk (`wt`) or raw `git worktree` | Plan branch (`plan-<hash>`); plan branch later merged to main by orchestrator | /work skill, implementers, plan-merge |
- **Task-graph:** One **plan** branch and worktree per plan; **task** worktrees branch from the plan branch. `tg done --merge` merges task → plan. Plan-merge (`wt merge main -C <plan-worktree-path>`) lands plan → main. See [multi-agent.md](multi-agent.md) and [.cursor/rules/subagent-dispatch.mdc](../.cursor/rules/subagent-dispatch.mdc).
- **Commit-messages:** Lead-only; no worktrees. The lead groups changes, stages each group, and runs `git commit` in the main repo. See [.cursor/skills/commit-messages/SKILL.md](../.cursor/skills/commit-messages/SKILL.md).  

**Critical rule:** Parallel agents that share one git repo must **not** share one working tree. Use **one worktree per agent**. Otherwise checkouts overwrite each other and commits land on the wrong branch.

## Optimizations across skills and agents

1. **Single source of truth for “one worktree per parallel unit”**  
   All batch-dispatch skills (work, review, review-tests, audit-performance) must either give each sub-agent its own worktree (task-graph or git worktree) or document why dispatch is sequential. (Commit-messages is lead-only; no sub-agents.) Ref: [.cursor/agent-utility-belt.md](../.cursor/agent-utility-belt.md) § Parallel sub-agent dispatch.

2. **Don’t run install/build/typecheck in a worktree unless the task changed deps**  
   Worktrees already have the tree from the branch they were created from. Running `pnpm install` / `pnpm build` / `pnpm typecheck` in every worktree is redundant unless the task added or changed dependencies. Ref: utility belt, same section.

3. **Task-graph: default = implementer self-starts; pre-start only when you need event data**  
   Orchestrator should **omit** `{{WORKTREE_PATH}}` by default and let each implementer run `tg start <taskId> --agent <name> --worktree` and then `cd` to the path from `tg worktree list --json`. Pre-start only when you need `plan_branch` or started-event data before building prompts. Ref: [subagent-dispatch.mdc](../.cursor/rules/subagent-dispatch.mdc), [docs/leads/execution.md](leads/execution.md).

4. **Plan-branch pre-flight before first wave**  
   Before dispatching the first wave of implementers for a worktree plan, verify the plan branch exists: `git branch | grep plan-p-`. If absent, pre-start one task to create it, then re-check. If still absent, **halt** — `tg done --merge` would have no merge target and commits would be orphaned. Ref: [.cursor/rules/subagent-dispatch.mdc](../.cursor/rules/subagent-dispatch.mdc) step 4b, [.cursor/memory.md](../.cursor/memory.md) (Verify plan branch exists).

5. **Clean-up order**  
   When removing worktrees (task-graph): remove worktrees with `git worktree remove` (or `--force` if dirty and you’ve discarded), run `git worktree prune`, delete any orphaned worktree directory, then delete merged branches. Ref: [.cursor/skills/clean-up-shop/SKILL.md](../.cursor/skills/clean-up-shop/SKILL.md).

## How to fix common problems

### Symptom: “Worktrunk worktree create failed” or “Could not find worktree path for branch X”

| Cause | Fix |
| ----- | --- |
| `wt` not on PATH | Install Worktrunk or add to PATH; or set `useWorktrunk: false` in `.taskgraph/config.json` to use raw git worktrees. |
| Branch already exists but worktree missing | CLI retries with `wt switch` (no `--create`) when cause indicates “branch exists”. If it still fails, from repo root: `tg worktree list --json` to see live worktrees; if the branch exists but no path, create worktree manually: `git worktree add <path> <branch>` (or use `wt` equivalent), then continue without re-running `tg start` for that task. |
| Permissions or disk | Fix filesystem permissions or free space; retry `tg start --worktree`. |

Ref: [multi-agent.md](multi-agent.md) § Worktree / Worktrunk failure conditions; [.cursor/agent-utility-belt.md](../.cursor/agent-utility-belt.md) (tg start --force when branch already exists).

### Symptom: Task was started with worktree but “tg done” didn’t merge / commits “disappeared”

| Cause | Fix |
| ----- | --- |
| `tg done` run **without** `--merge` | Implementer must run `pnpm tg done <taskId> --merge --evidence "..."`. Without `--merge`, the task is marked done and the worktree is cleaned up but the task branch is **not** merged into the plan branch; commits are left on a branch that may be deleted. |
| `tg done` run from **repo root** instead of worktree | Run `tg done` from **inside** the task worktree directory. Running from repo root can merge nothing or fail silently. |
| Plan branch never created (no `plan_worktree` row) | Before first wave, verify plan branch exists (`git branch | grep plan-p-`). If missing after first `tg start --worktree`, halt and diagnose; do not continue dispatching — all subsequent `tg done --merge` would have no valid merge target. |

Ref: [agent-contract.md](agent-contract.md), [agent-field-guide.md](agent-field-guide.md) § Worktree Workflow and “Running tg done from repo root instead of worktree”.

### Symptom: "Your local changes would be overwritten by checkout"

| Context | Fix |
| ------- | --- |
| **Task-graph:** Switching branch in main repo while worktree has uncommitted changes | Commit or stash in the worktree first; or run `tg done --merge` from the worktree so the task branch is merged, then main can safely checkout/merge. |
| **Clean-up-shop:** Main on a task branch and checkout main fails | Commit or stash (e.g. dolt journal) in main repo, then `git checkout main && git merge <task-branch>`. If Dolt journal files block checkout, commit `.taskgraph/dolt` first. |

Ref: [.cursor/skills/clean-up-shop/SKILL.md](../.cursor/skills/clean-up-shop/SKILL.md).

### Symptom: Plan branch exists but no worktree on disk (“Plan branch X exists but could not find worktree path”)

| Cause | Fix |
| ----- | --- |
| Plan worktree was removed manually or crashed | From repo root: `tg worktree list --json` (or `git worktree list`). If plan branch is in DB but not in list, create a worktree for the plan branch: `git worktree add <path> plan-<hash>` (or `wt switch` into that branch in a new path). Update `plan_worktree` if your workflow persists it, or rely on next `tg start --worktree` to recreate. |
| `wt list` output format changed | Check CLI code that parses `wt list`; update path extraction. See [multi-agent.md](multi-agent.md) § Worktree / Worktrunk failure conditions. |

### Symptom: gate:full passed on main but plan had failing tests

| Cause | Fix |
| ----- | --- |
| gate:full was run from **repo root (main)** instead of plan worktree | Run `pnpm gate:full` from **inside the plan worktree** where merged task changes are visible. Implementers’ work lives on task branches merged into the plan branch; main doesn’t have those commits until plan-merge. |

Ref: [agent-contract.md](agent-contract.md) § gate:full Orchestration Rules; [.cursor/rules/taskgraph-workflow.mdc](../.cursor/rules/taskgraph-workflow.mdc).

### Symptom: Orphaned worktree directories or “not a git repository” in a worktree path

| Cause | Fix |
| ----- | --- |
| `git worktree remove` unregistered but left directory on disk | Run `git worktree prune`, then manually remove the directory: `rm -rf <path>`. Clean-up-shop step 5: list parent dir (e.g. `ls … | grep Task-Graph`) and remove any stale dirs. |

Ref: [.cursor/skills/clean-up-shop/SKILL.md](../.cursor/skills/clean-up-shop/SKILL.md) § Orphaned directories.

### Recovering lost worktree commits (task or plan branch merged away or worktree removed before merge)

```bash
git fsck --lost-found 2>&1 | grep "dangling commit"
git show <hash> --stat    # inspect
git cherry-pick <hash1> <hash2> ...
```

Ref: [agent-field-guide.md](agent-field-guide.md) § Recovering lost worktree commits.

## Decisions / gotchas

- **Merge target for task-graph is the plan branch, not main.** `tg done --merge` merges task branch → plan branch. Plan → main happens only in the **plan-merge** step (`wt merge main -C <plan-worktree-path>`). Skipping plan-merge leaves all task work on the plan branch only.
- **Commit-messages is lead-only.** No worktrees; the lead stages and commits in the main repo. No `tg` or task IDs.
- **Dolt journal files can block `git checkout main`.** If checkout fails due to `.taskgraph/dolt` changes, commit those first (e.g. `git add .taskgraph/dolt && git commit -m "chore: persist dolt journal"`), then checkout.

## Related docs

- [multi-agent.md](multi-agent.md) — Per-plan worktree model, failure conditions, retry heuristic
- [agent-contract.md](agent-contract.md) — `tg done --merge`, gate:full from plan worktree
- [agent-field-guide.md](agent-field-guide.md) — Worktree workflow, running tg done from worktree, recovery
- [schema.md](schema.md) — `plan_worktree` table
- [cli-reference.md](cli-reference.md) — `tg start --worktree`, `tg worktree list`
- [.cursor/skills/clean-up-shop/SKILL.md](../.cursor/skills/clean-up-shop/SKILL.md) — Step-by-step worktree cleanup
- [.cursor/agent-utility-belt.md](../.cursor/agent-utility-belt.md) — Parallel dispatch, one worktree per agent
