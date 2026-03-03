# Pruner mode (reference)

Detailed reference for the Pruner sub-agent of git-sensai.

## Scope

- **In scope:** Dead branches, merged branches, worktree list and removal, main branch restoration, remote prune.
- **Out of scope:** Resolving merge conflicts (future mode), rewriting history, force-push policy.

## Commands cheat sheet

```bash
# Worktrees (taskgraph)
pnpm tg worktree list --json
pnpm tg status --tasks   # doing vs done before discarding

# Branches
git branch -a
git branch --merged main
git branch -vv | grep ': gone]'

# Safe delete
git branch -d <branch>   # merged only
git worktree remove <path>

# Main repo
git fetch --prune
git checkout main && git merge <branch>
```

## Coordination with clean-up-shop

When the repo uses taskgraph, Pruner reuses the decision map and steps from [clean-up-shop/SKILL.md](../clean-up-shop/SKILL.md): merge completed work to main, remove worktrees, delete merged branches. Pruner can run as a deeper pass (e.g. also pruning remote-tracking and long-dead local branches) on top of that workflow.
