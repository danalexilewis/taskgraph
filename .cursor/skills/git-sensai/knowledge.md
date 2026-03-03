# Git Sensai — knowledge lookups

Read these docs when running git-sensai (especially Pruner) so the agent has context on how this repo uses git, worktrees, Worktrunk, and Dolt.

## Core (read when orienting in this repo)

| Doc | Path | Use for |
| ----- | ----- | ----- |
| **Multi-agent / worktrees** | `docs/multi-agent.md` | Per-plan worktree model, plan branch vs task branches, `tg start --worktree`, `tg done --merge`, Worktrunk backend, failure conditions and retry heuristic. |
| **Infra / Dolt** | `docs/infra.md` | Dolt repo at `.taskgraph/dolt`, `DOLT_PATH`, tg server start/stop, sql-server mode, writable sessions. |
| **Schema (plan_worktree)** | `docs/schema.md` | Table `plan_worktree`: plan_id, worktree_path, worktree_branch; how plan branches are recorded. |
| **Agent field guide** | `docs/agent-field-guide.md` | Worktree workflow, running `tg done` from worktree (not root), recovering lost worktree commits, Dolt/query patterns, which worktrees are active. |
| **CLI reference (worktree)** | `docs/cli-reference.md` | `tg start --worktree`, `tg worktree list --json`; Worktrunk vs raw git; plan branch creation. |
| **Execution lead** | `docs/leads/execution.md` | Worktrunk in execution loop, worktree path injection, focus project. |

## Pruner mode

| Doc | Path | Use for |
| ----- | ----- | ----- |
| **Clean-up shop** | `.cursor/skills/clean-up-shop/SKILL.md` | Step-by-step worktree cleanup: main on wrong branch, each worktree (merge vs remove), `git worktree remove`, delete merged branches. |
| **Multi-agent** | `docs/multi-agent.md` | Plan branch vs task branch; merge target is plan branch; when to keep vs remove worktrees. |
| **Agent field guide** | `docs/agent-field-guide.md` | Recovering lost worktree commits; `tg worktree list --json` vs `git worktree list`. |

## Quick commands (this repo)

```bash
# Worktrees (taskgraph)
pnpm tg worktree list --json
pnpm tg status --tasks

# Dolt (do not run destructive SQL)
# Repo: .taskgraph/dolt  (see docs/infra.md)
```

When in doubt, read the **Core** docs first, then the **Pruner** docs if running Pruner.
