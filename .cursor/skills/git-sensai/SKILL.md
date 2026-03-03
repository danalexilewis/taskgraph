---
name: git-sensai
description: Expert git lead that resolves git-related issues via specialized modes (sub-agents). Pruner mode removes dead branches, restores order, and tidies worktrees. Use when the user says "git sensai", "pruner", "prune branches", "dead branches", "clean up git", "worktrees in order", or needs git/repo state fixed.
---

# Git Sensai

Expert git lead that coordinates resolution of git and repo state. The sensai has **modes** (sub-agents); each mode has a narrow specialty. Invoke the skill, then run the mode that fits the user’s request.

## When to use

- User says **git sensai**, **pruner**, **prune**, **dead branches**, **clean up git**, **worktrees in order**, or similar.
- Repo or worktrees are in a bad state and need a systematic fix.
- Multiple branches or worktrees need to be reconciled or removed.

## Knowledge lookups

This repo uses **git**, **worktrees**, **Worktrunk (wt)**, and **Dolt** together. Before running any mode, load context from the docs listed in **[knowledge.md](knowledge.md)**.

- **Core**: `docs/multi-agent.md` (per-plan worktree, plan vs task branches, `tg start`/`tg done --merge`), `docs/infra.md` (Dolt, `.taskgraph/dolt`, tg server), `docs/schema.md` (`plan_worktree` table), `docs/agent-field-guide.md` (worktree workflow, recovery), `docs/cli-reference.md` (worktree CLI), `docs/leads/execution.md` (Worktrunk in execution).
- **Pruner**: In addition to Core, read `.cursor/skills/clean-up-shop/SKILL.md` for step-by-step worktree cleanup aligned with taskgraph.

Use the tables in `knowledge.md` as the checklist: read the listed docs (or the sections that apply to the current mode) before executing the workflow.

## Modes (sub-agents)

| Mode     | Purpose |
| -------- | ------- |
| **Pruner** | Dead branches, push things back into place, general order, worktree cleanup. |
| *(future)* | Merger, conflict-resolver, or other modes as needed. |

If the request is about pruning, dead branches, or worktree order → use **Pruner**. Otherwise pick or define the mode that fits.

---

## Pruner mode

The Pruner specializes in: **removing dead branches**, **pushing things back into place**, **restoring order**, and **dealing with worktrees**.

### Pruner triggers

- "Run the pruner" / "pruner"
- "Dead branches" / "prune branches"
- "Worktrees in order" / "clean up worktrees" (beyond a quick clean)
- "Push things back into place" / "get the repo in order"

### Pruner workflow

**0. Load knowledge (if this repo is taskgraph)**

- Read [knowledge.md](knowledge.md) and the **Pruner**-listed docs (clean-up-shop, multi-agent, agent-field-guide) so you understand plan vs task branches, `tg worktree list`, and when to merge vs remove.

**1. Orient**

- List worktrees: `pnpm tg worktree list --json` (if this repo uses tg) or `git worktree list`.
- List branches: `git branch -a`; note which are merged, which are remote-only, which are local-only.
- Check main repo: `git status`, `git branch` (is main on `main`?).

**2. Identify dead or redundant branches**

- Local branches merged into main: `git branch --merged main` (excluding `main`).
- Remote-tracking branches whose upstream is gone: `git branch -vv | grep ': gone]'` or equivalent.
- Branches that are clearly task/feature branches already merged (e.g. `tg-*`, `plan-p-*` after plan-merge).

**3. Worktrees**

- For each worktree (except main):
  - Commits ahead of main? → merge to main if clean; if conflicts, note and leave for human.
  - Uncommitted changes? → if task is done or user approved, discard; else leave for human.
  - Otherwise → remove worktree and delete branch if safe.
- Prefer reusing steps from the **clean-up-shop** skill (`.cursor/skills/clean-up-shop/SKILL.md`) for worktree removal and merge order.

**4. Push back into place**

- If main is on the wrong branch: switch to `main`, merge or reset as appropriate.
- If branches that should be deleted are identified: `git branch -d <branch>` (merged) or `git branch -D <branch>` (force) only when safe.
- Remote cleanup: `git fetch --prune`; optionally delete remote-tracking refs for gone remotes.

**5. Report**

- Summarize: what was removed, what was merged, what was left for the human (and why).

### Pruner constraints

- Do not force-delete branches that might contain unique work; prefer merge then delete.
- Do not discard uncommitted changes in a worktree unless the user (or task state) clearly indicates it’s safe.
- When in doubt, report and leave the action for the human.

---

## Invocation

1. User invokes git-sensai (or a trigger phrase).
2. **Load knowledge**: Read [knowledge.md](knowledge.md) and the docs it lists for the chosen mode (Core + mode-specific).
3. Decide which mode applies (e.g. Pruner for dead branches / order / worktrees).
4. Run that mode’s workflow.
5. Return a short summary of what was done and what, if anything, is left for the user.

For detailed worktree cleanup steps that align with this repo’s taskgraph workflow, read `.cursor/skills/clean-up-shop/SKILL.md` and reuse or adapt its steps inside Pruner mode.
