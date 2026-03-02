# Worktree Lifecycle Evolve — Anti-Patterns and Fixes

**Date:** 2026-03-02  
**Scope:** Post-plan evolve analysis focused on worktree usage; root cause of lost breadcrumbs plan work and documenter changes; identification and remediation of 8 anti-patterns across agent templates and rules.  
**Produced by:** Reviewer sub-agent (research mode) + orchestrator synthesis and application.

---

## Scope

The user invoked `/evolve` with a focus on how worktrees are used, asking to look through recent agent and sub-agent experiences for improvements. The breadcrumbs plan had just completed in the task graph (all tasks marked done) but **no code or docs from that plan existed on main**. Investigation showed: (1) implementer commits existed as **orphaned git objects** (e.g. `bc7a804`, `34edac9`) because `tg done` was called without `--merge`; (2) the **plan-merge step** was never run by the orchestrator; (3) documenter changes were written to the main working tree but **never committed**, so they were ephemeral. A reviewer sub-agent in research mode was dispatched with full context; it returned a structured anti-pattern inventory, contradiction matrix, and ranked recommendations (S1–S8). All 8 fixes were applied and the lost work was recovered.

---

## Findings

### Root cause (evidence)

| Observation                                | Evidence                                                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Plan branch had zero commits ahead of main | `git diff main...plan-p-396334` empty; `git log plan-p-396334 --not main --oneline` empty                                                |
| Implementer commits still in object store  | `git cat-file -t bc7a804` → `commit`; `git show bc7a804 --stat` → `.breadcrumbs.json`, `.gitattributes`                                  |
| Documenter changes present but uncommitted | `git status` showed modified `docs/breadcrumbs.md`, `docs/domains.md`, `.cursor/agent-utility-belt.md`, etc., before the recovery commit |
| Template instructed omit `--merge`         | `implementer.md` Step 4: "the orchestrator will run done with `--merge`; you only run `tg done` with evidence"                           |
| No plan-merge in completion flow           | `AGENT.md` and `taskgraph-workflow.mdc` Plan completion listed only `tg export markdown`                                                 |

### Anti-pattern inventory (8 closed)

| #    | Severity | Pattern                                                                                                       | Location                             | Fix applied                                                           |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| AP-1 | CRITICAL | Implementer told to omit `--merge`; ownership assigned to orchestrator who has no step to run it              | `implementer.md` Step 4              | Command set to `tg done --merge --evidence`; ownership to implementer |
| AP-2 | CRITICAL | Plan-merge step absent from orchestrator completion checklists                                                | `AGENT.md`, `taskgraph-workflow.mdc` | Step 1 added: `wt merge main -C <plan-worktree-path>` before export   |
| AP-3 | HIGH     | "tg done from repo root" rule in AGENT.md and agent-contract.md contradicted workflow rule and implementer.md | Both docs                            | Removed; replaced with worktree directory + `--merge` requirement     |
| AP-4 | HIGH     | agent-contract.md had two sections giving opposite instructions on same page                                  | `docs/agent-contract.md`             | Both sections aligned: `--merge` required, run from worktree          |
| AP-5 | HIGH     | Plan-merge only in Worktrunk intro prose; not in Pattern 1 numbered steps                                     | `subagent-dispatch.mdc`              | Added as step 9 in Pattern 1                                          |
| AP-6 | HIGH     | Documenter template: no commit before `tg done`; changes lost when plan-merge runs                            | `documenter.md`                      | Mandatory `git add -A && git commit` before `tg done`                 |
| AP-7 | MEDIUM   | Plan-branch verification was retrospective gotcha; no pre-dispatch gate                                       | `subagent-dispatch.mdc`              | Step 4b: assert `git branch \| grep plan-p-` before Wave 1            |
| AP-8 | LOW      | Learnings entry addressed directory only, not `--merge`                                                       | `implementer.md` Learnings           | Updated; added 2026-03-02 orphaned-commit learning                    |

### Contradictions resolved

| Topic                               | Conflicting sources                                                                            | Resolution                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `tg done` working directory         | AGENT.md / agent-contract: "from repo root"; taskgraph-workflow / implementer: "from worktree" | Canonical: worktree directory + `--merge`                         |
| Who owns `--merge`                  | implementer.md: "orchestrator will run done with --merge"; Pattern 1: no such step             | Implementer owns `--merge`; orchestrator has no retroactive merge |
| Does directory alone trigger merge? | agent-contract: "auto-merges"; multi-agent.md: "Without --merge ... no merge"                  | `--merge` flag required regardless of directory                   |

### Files changed (evolve + recovery)

- **Agent templates:** `.cursor/agents/implementer.md`, `.cursor/agents/documenter.md`, `.cursor/agents/reviewer.md`
- **Rules:** `.cursor/rules/taskgraph-workflow.mdc`, `.cursor/rules/subagent-dispatch.mdc`
- **Canonical / docs:** `AGENT.md`, `docs/agent-contract.md`
- **Recovered:** cherry-picked `bc7a804`, `34edac9`; committed documenter working-tree changes in same commit as evolve fixes

---

## Implications

- **Strong conventions prevent data loss:** The lifecycle is now explicit in numbered steps and in every completion checklist. Wrong or missing command examples in templates were the primary vector for silent failure.
- **Documenters must commit:** In the default no-worktree path, documenter edits live only in the main working tree until committed; without a commit step they are lost at plan-merge. The template now requires commit before `tg done`.
- **Plan-merge is orchestrator-owned but was invisible:** It was documented once in Worktrunk intro text but not in any step-by-step flow. It is now step 9 in Pattern 1 and step 1 in Plan completion in both AGENT.md and taskgraph-workflow.mdc.

---

## Recommendations (already applied)

All S1–S8 recommendations from the reviewer were applied in this session. No open follow-up from the evolve itself.

**Durable pattern for future templates:** Any command in a Step N block or Output contract should be copy-paste runnable and correct. When the example omits a required flag (e.g. `--merge`), agents follow the example; prose alone does not override it.

---

## Summary

The evolve analysis traced the loss of breadcrumbs plan work to two causes: implementers calling `tg done` without `--merge` (orphaning commits) and the orchestrator never running the plan-merge step. Documenter changes were also at risk because they were never committed. Eight anti-patterns were identified and fixed across implementer, documenter, reviewer, AGENT.md, taskgraph-workflow.mdc, subagent-dispatch.mdc, and agent-contract.md. Orphaned commits were cherry-picked to main and uncommitted documenter changes were committed with the evolve fixes. Stronger conventions—explicit `--merge` in every relevant command example and a mandatory plan-merge step in all completion checklists—should prevent recurrence.
