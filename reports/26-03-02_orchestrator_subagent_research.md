# Research: Orchestrator and Sub-Agent Combos for .cursor and AgentDex

**Date:** 2026-03-02  
**Scope:** External orchestrator/sub-agent patterns; recommendations for `.cursor/agents`, leads, skills, and AgentDex.  
**Skill:** Research (reference projects, vendor guidance, ecosystem patterns).

---

## Current state (Task-Graph)

### .cursor/agents (workers)

| Agent                 | Purpose                                    |
| --------------------- | ------------------------------------------ |
| implementer           | Task execution (tg start → work → tg done) |
| reviewer              | PASS/FAIL or research mode                 |
| investigator          | Hunter-killer on gate:full failures        |
| debugger              | Systematic 4-phase debug for a single task |
| fixer                 | Escalation after 2 implementer failures    |
| planner-analyst       | Pre-plan codebase analysis                 |
| documenter            | Doc-only tasks                             |
| spec-reviewer         | Two-stage: spec compliance                 |
| quality-reviewer      | Two-stage: code quality                    |
| test-quality-auditor  | Test quality audit                         |
| test-infra-mapper     | Test infrastructure mapping                |
| test-coverage-scanner | Coverage gap scanning                      |
| explorer              | Rescope/skill use                          |
| sitrep-analyst        | Sitrep formation                           |

### Leads (skill → orchestration pattern)

Execution, planner-analyst, investigator, test-review, review, rescope, risk, meta, debug, reprioritise — see `docs/leads/README.md`.

### AgentDex (planned)

Dolt table `agent_dex`: profile_id, name, source (observed | researched), profile_json, first_seen_at, updated_at. Purpose: hoard researched/observed agent profiles as context; "Agents (discovered)" count; research-agents skill to add profiles. Authority remains `.cursor/agents` and available-agents; dex is context-only.

---

## Cursor (official subagents)

**What it is:** Cursor’s built-in and custom subagent system: separate context per subagent, foreground/background, optional custom agents in `.cursor/agents/`.

**Key patterns worth extracting:**

- **Verifier subagent** — Validates that claimed-done work actually works: run tests, check edge cases, report incomplete/broken. Fits our flow after implementer marks done; we use reviewer for quality, but a dedicated _skeptical verifier_ (run tests, don’t trust claims) is a distinct role.
- **Orchestrator pattern (Cursor doc)** — Sequence: Verifier (requirements match) → Implementer (build) → Planner (analyze). We already do planner→implementer→reviewer; adding an explicit verifier _after_ done could catch “marked done but tests not run.”
- **Custom subagent format** — YAML frontmatter: `name`, `description`, `model` (fast | inherit | id), `readonly`, `is_background`. We can add these to new agents and to AgentDex profile_json for discovered agents.
- **When to use subagents vs skills** — Subagents: context isolation, parallel workstreams, specialized multi-step work, independent verification. Skills: single-purpose, one-shot, no extra context window. Aligns with our split: heavy/complex → sub-agent; repeatable one-shot → skill.

**Gaps it fills:** Independent verification of “done” (tests run, behavior confirmed). We rely on reviewer + run-full-suite task; a verifier is a named, reusable combo.

**Adoption cost:** Low. Add `.cursor/agents/verifier.md` (and optionally wire into /work as post-done check for high-stakes tasks). Add to available-agents and, once dex exists, as a researched profile.

---

## Gastown (Mayor / Polecat / Convoy)

**What it is:** Multi-agent orchestration for Claude Code: Mayor (coordinator), Polecats (ephemeral workers with persistent identity), Convoys (work bundles), Hooks (git worktree persistence), mail protocol for completion/merge/rework.

**Key patterns worth extracting:**

- **Persistent agent identity** — Polecats are ephemeral sessions but keep identity and work history. We have task ownership and `body.agent` in events; we could add “agent identity” as a first-class notion in AgentDex (e.g. profile_id stable across invocations).
- **Structured completion signals** — POLECAT_DONE, MERGE_READY, MERGE_FAILED, REWORK_REQUEST. We have tg done + evidence; we don’t have a formal “merge failed / rework” handback. Extract: explicit completion/merge-failure message types for orchestrator→implementer or investigator (e.g. in task notes or a small protocol).
- **Witness / Refinery / Deacon** — Second-order roles: witness verifies polecat work, refinery merges, deacon re-dispatches. We have investigator (fix gate failures) and fixer (re-do task). A “witness” that only verifies and signals “ready for merge” vs “rework” could sit between implementer and run-full-suite.
- **Convoy = work bundle** — Multiple beads (issues) in one unit. We have plans and task groups; “convoy” is a name for “batch of tasks with shared lifecycle.” Could document as a pattern in docs (e.g. wave = convoy-lite) without new code.
- **Mail / handoff** — HANDOFF for context continuity; HELP for escalation. We use tg note and blocking tasks. Handoff could be an AgentDex/research pattern: “agents that support handoff protocol” for long sessions.

**Gaps it fills:** Clear completion/merge/rework protocol; optional “witness” role; vocabulary for work bundles and agent identity.

**Adoption cost:** Medium. Protocol and witness role need docs and possibly a small skill or lead; AgentDex can store Gastown-style profiles (Mayor, Polecat, Witness, Refinery, Deacon) as researched entries.

---

## Superpowers (brainstorm → plan → execute)

**What it is:** Composable skills framework: brainstorm, writing-plans, executing-plans, subagent-driven-development, TDD, systematic-debugging, verification-before-completion, code-review, git-worktrees, finishing-a-development-branch.

**Key patterns worth extracting:**

- **Verification-before-completion** — Explicit skill: ensure fix is actually in place before marking done. Maps to our reviewer + run-full-suite; also to Cursor’s verifier. Worth a single “verifier” agent that we use after implementer (and optionally after investigator).
- **Subagent-driven-development** — One subagent per task, two-stage review (spec then quality). We already do implementer + spec-reviewer + quality-reviewer for two-stage; Superpowers reinforces that combo as a named workflow.
- **Systematic-debugging** — 4-phase (investigate, pattern, hypothesis, implement). We have debugger.md and investigator; ensure our debugger template matches this structure and add to AgentDex as “systematic-debugging” profile.
- **Dispatching-parallel-agents** — Concurrent subagent workflows. We do parallel batches via tg next and Task tool; document as “parallel execution” pattern in agent-strategy or AgentDex.
- **Finishing-a-development-branch** — Merge/PR/keep/discard, cleanup. We have worktrees and tg done merge; no explicit “finish branch” skill. Could add a small skill or doc section that ties tg done, worktree cleanup, and /clean-up-shop.

**Gaps it fills:** Named “verification-before-completion” and “subagent-driven-development” workflows; alignment of our debugger with a standard 4-phase; branch-finish checklist.

**Adoption cost:** Low. Add verifier agent; document combos in docs and AgentDex; optionally add finishing-a-branch as a short skill or section in clean-up-shop.

---

## Anthropic (when to use multi-agent)

**What it is:** Decision framework: use multi-agent when (1) context pollution, (2) parallel execution, (3) specialization; otherwise prefer single agent.

**Key patterns worth extracting:**

- **Context protection** — Subagents for high-volume, filter-before-use subtasks. We already use subagents for implementer/reviewer/planner-analyst to isolate context; document this as “context protection” in agent-strategy and in AgentDex for “orchestrator-subagent” profile.
- **Parallelization** — Lead decomposes work, subagents run in parallel, synthesize. We do this with tg next + parallel Task calls; make it explicit in docs and in dex.
- **Specialization** — Different prompts/tools per role. We have implementer vs documenter vs debugger; list “specialization” as a reason we use multiple agents and add to dex.
- **Cost** — 3–10× tokens vs single agent; use only when benefits justify. Note in docs/agent-strategy or memory: when to add a new subagent type vs when to improve prompts.

**Gaps it fills:** Clear “when to add an agent” and “when not to” guidance; vocabulary for context/parallel/specialization.

**Adoption cost:** Low. Docs and AgentDex entries only.

---

## Additional ecosystem (verifier, test-runner, security)

**What it is:** Common subagent types in docs and blogs: verifier, test-runner, security-auditor; multi-agent code verification (multiple agents for different bug classes).

**Key patterns worth extracting:**

- **Verifier** — Skeptical validator; run tests and checks; report passed vs incomplete. Add as first-class agent (see Cursor section).
- **Test-runner** — Proactively run tests on changes, analyze failures, fix and re-run. We have run-full-suite task and gate; a dedicated test-runner subagent could be used inside a task (“run tests and fix failures”) rather than as a separate task. Optional; medium value.
- **Security-auditor** — Auth, payments, sensitive data, injection/XSS, secrets. We don’t have this. Good candidate for AgentDex as _researched_ profile first; add `.cursor/agents/security-auditor.md` only if we get security-sensitive tasks (e.g. plan with `agent: security-auditor`).
- **Multi-agent verification** — Several agents with different prompts find more bugs (CodeX-Verify style). We use reviewer + investigator; could add “second reviewer” or “verifier” for critical paths. Document as optional pattern in AgentDex.

**Gaps it fills:** Verifier (high), test-runner (medium), security-auditor (dex-first), multi-agent verification (doc/dex).

**Adoption cost:** Verifier low; test-runner and security-auditor low if dex-only, medium if we add .cursor/agents.

---

## Recommendations (by impact/effort)

### High impact, low effort

1. **Add verifier agent**
   - **Where:** `.cursor/agents/verifier.md`
   - **When:** After implementer marks done; optional after investigator.
   - **Content:** YAML name/description/model; prompt: skeptical validation, run tests, report passed vs incomplete, don’t trust claims.
   - **Also:** Register in available-agents; when AgentDex exists, add profile (source: researched, from Cursor docs).

2. **Document orchestrator–subagent combos**
   - **Where:** `docs/agent-strategy.md` (or new `docs/orchestrator-subagent-patterns.md`).
   - **Content:** When we use multi-agent (context, parallel, specialization); Cursor verifier pattern; our implementer→reviewer→(verifier) flow; when _not_ to add agents (Anthropic cost note).
   - **AgentDex:** After dex exists, add “orchestrator-subagent” and “verifier” as researched profiles with one-line summary and link to doc.

3. **AgentDex research profiles (once dex exists)**
   - **Add as researched profiles:** Cursor (subagents, verifier, orchestrator pattern), Gastown (Mayor, Polecat, Witness, Refinery, Convoy, mail protocol), Superpowers (brainstorm–plan–execute, verification-before-completion, subagent-driven-development, systematic-debugging), Anthropic (when to use multi-agent), optional: security-auditor, test-runner.
   - **Purpose:** Context for planner and research-agents skill; no need to add every combo to `.cursor/agents`, but dex holds the patterns.

### Medium impact, medium effort

4. **Witness-style role (optional)**
   - **Idea:** Agent that only verifies “work complete and clean” and signals ready-for-merge vs rework (no fix).
   - **Where:** Either a small skill that runs after implementer and before run-full-suite, or a doc + AgentDex “Witness” profile from Gastown.
   - **Skip** if verifier + reviewer already cover the need.

5. **Finishing-a-branch**
   - **Where:** Extend `/clean-up-shop` or add a short skill/doc.
   - **Content:** Checklist: tg done, worktree merge, branch delete, push; when to merge vs PR vs discard.
   - **AgentDex:** Add “finishing-a-development-branch” (Superpowers) as researched.

6. **Completion/merge protocol (lightweight)**
   - **Where:** docs (and optionally task note conventions).
   - **Content:** Standard note formats for “done,” “merge failed,” “rework needed” so orchestrator and investigator can parse them.
   - **AgentDex:** Gastown mail types as researched reference (POLECAT_DONE, MERGE_READY, etc.).

### Lower priority / dex-only

7. **Security-auditor**
   - Add to AgentDex as researched profile; add `.cursor/agents/security-auditor.md` only when we have security-sensitive plans.

8. **Test-runner**
   - Add to AgentDex as researched; consider `.cursor/agents/test-runner.md` only if we want “run tests and fix in one task” as a dedicated role.

9. **Gastown-style identity and convoy**
   - Document in AgentDex and docs as patterns (persistent identity, work bundles); no code unless we add identity/convoy to schema later.

---

## Summary table: add to .cursor vs AgentDex only

| Combo / pattern                   | Add to .cursor/agents    | Add to AgentDex (researched)                                        |
| --------------------------------- | ------------------------ | ------------------------------------------------------------------- |
| Verifier                          | Yes (verifier.md)        | Yes                                                                 |
| Security-auditor                  | Only if security tasks   | Yes                                                                 |
| Test-runner                       | Optional                 | Yes                                                                 |
| Witness (Gastown)                 | No (or tiny skill)       | Yes                                                                 |
| Orchestrator–subagent             | No (we have it)          | Yes (document pattern)                                              |
| Superpowers workflows             | No (we have equivalents) | Yes (brainstorm–plan–execute, verification-before-completion, etc.) |
| Gastown Mayor/Polecat/Convoy/mail | No                       | Yes                                                                 |
| Anthropic when/why                | No                       | Yes (decision framework)                                            |

---

## References

- Cursor: [Subagents](https://cursor.com/docs/agent/subagents)
- Gastown: [README](https://github.com/steveyegge/gastown), [Mail protocol](https://gastown.dev/docs/design/mail-protocol)
- Superpowers: [README](https://github.com/obra/superpowers)
- Anthropic: [When to use multi-agent systems](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them)
- Plan: `plans/26-03-02_agent_dex_research_agents.md` (AgentDex and research-agents skill)
