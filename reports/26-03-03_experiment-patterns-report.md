# Experiment Patterns Report — What to Take Back

**Date:** 2026-03-03  
**Scope:** Transferable patterns from the taskgraph multi-agent experiment to a more normal development cycle.  
**Produced by:** Orchestrator (synthesis of user observations + codebase evidence across reports, transcripts, and evolve runs).

---

## Overview

This report synthesizes patterns discovered during the taskgraph agentic experiment — a multi-week push using Cursor agents, Dolt as a task store, worktrees, sub-agent dispatch, and structured learning systems. The goal: identify what is genuinely transferable to a normal development cycle, what only matters at multi-agent scale, and what to avoid.

The user's 7 observations are addressed directly, then additional patterns drawn from the codebase evidence are added.

---

## 1. Skills to cast agents + premade teams of sub-agents

**What worked:**  
The skill system (`.cursor/skills/<name>/SKILL.md`) is the most transferable pattern in this experiment. A skill is a short, plain-text workflow document that the orchestrator reads before acting. It encodes:
- When to use it (trigger phrases)
- Which sub-agents to dispatch (role, permissions, directive)
- What to pass to each sub-agent (context, scope, constraints)
- What to synthesize from their output

The key insight is **specialization over generalism**. Instead of one agent trying to do everything, you define roles — `implementer`, `reviewer`, `investigator`, `planner-analyst` — each with a focused prompt contract. Roles have cardinality rules (e.g. one overseer, N execution leads) and permission constraints (read-only reviewers, read-write implementers).

Teams of sub-agents (e.g. the review skill dispatching a code-health agent + a system-health agent in parallel) consistently outperformed single-agent approaches because:
- Parallelism: both agents run in the same turn, not sequentially
- Specialization: each agent gets a tighter directive and produces better signal
- Synthesis is the orchestrator's job: it resolves conflicts, not the agents

**What to take back:**  
Even in a solo development cycle, the skill document pattern is valuable. Write a `SKILL.md` for any repeated multi-step workflow (e.g. "add a CLI command", "write a database migration", "do a pre-release review"). The agent reads the skill and follows it rather than reinventing the procedure from scratch each time. This is more reliable than inline prompting and composable across sessions.

**If you never need multi-agent:** The single-agent version of this is just a well-structured directive document. The pattern generalizes.

---

## 2. Shared learning utility belt — accumulate and inject

**What worked:**  
The `agent-utility-belt.md` is a single file that accumulates cross-cutting learnings from all agents and all sessions, then gets injected into sub-agent prompts at dispatch time (`{{LEARNINGS}}`). The file is grouped by domain (SQL/DB, caching, CLI, Result/error, worktrees, parallel dispatch, breadcrumbs).

Evidence from the learnings audit (`reports/learnings-utility-belt-audit-2026-03-03.md`) shows 20 patterns identified as worth adding to the belt from agent files alone — including things like "log only at CLI boundary, not in domain/plan-import", "compute-once and pass in", "parameterized SQL for user input." These are patterns an experienced developer would know but that agents rediscover repeatedly without the belt.

The routing system matters: transient context goes to `memory.md`; durable architectural knowledge goes to `docs/`; cross-cutting agent patterns go to the belt. Without that routing discipline, everything piles up in one place and becomes noise.

**What to take back:**  
Maintain a short, evolving "learnings document" for your project. Not just a CHANGELOG or ADR — a living document of "things agents (and humans) keep getting wrong in this codebase." After each session or sprint, route new learnings into it. Keep it under 200 lines by pruning stale entries. Inject it into every significant agent prompt. The ROI compounds over time: the second session is better than the first, the tenth is much better than the second.

---

## 3. Using cursor agent transcripts as a learning source

**What worked:**  
The evolve-cli skill mined 94 sessions and 424 transcript files to surface CLI chatter patterns. The findings were quantitative and actionable: 79% of sessions hit Dolt retry loops, 68% called `tg status` and `tg next` sequentially when a single call would do, agents escalated `tg next` flag variants in a predictable pattern.

The key discovery was that **transcripts are text-only in Cursor** (no structured `tool_use`/`tool_call` blocks in the export), which means analysis requires regex text mining. But even text mining was enough to find the dominant patterns.

**Important nuance:** The evolve-cli skill revealed that ~96% of tg command mentions in transcripts are references/discussion rather than actual executions. Raw counts are misleading; look at bigrams (what follows what) and execution-pattern phrasing ("Running `tg ...`") for ground truth.

**What to take back:**  
Periodically mine your agent transcripts. You don't need a sophisticated tool — a simple regex scan for repeated patterns (the same file read multiple times, the same error message appearing, the same shell command retried) surfaces the highest-value friction points. The output is a prioritized list of workflow improvements that can be routed to skills, rules, or the utility belt.

---

## 4. Basic task tracking — when you need it, when you don't

**What worked:**  
Even without initiatives, projects, or multi-agent setups, a simple task table with `status`, `owner`, and `plan` columns gave useful visibility into what was in flight. The key value was not coordination overhead but **observability**: you could see which agent was working on what, which tasks were stale, and which were blocked.

The critical threshold: you need this mostly when you have **parallel or sequential agents** working across the same codebase. For a single-agent loop, a markdown checklist in the plan file is sufficient. Dolt added real value in multi-agent because tasks acted as a coordination channel (via `tg note`) and the task state was the source of truth for who had what in flight.

**What not to replicate:** Initiatives and cycle planning added ceremony without much payoff at this scale. The three-level hierarchy (initiative → project → task) is useful for roadmap visibility but not for day-to-day execution. Start with tasks and add projects only when you have multiple parallel workstreams.

**What to take back:**  
For solo development: a flat task list (even in a markdown file) with `todo/doing/done` states and a clear "what's in flight now" marker is enough. For multi-agent work: a structured store (even a SQLite file) with `owner` and `status` columns is the minimum viable coordination layer. Don't add the hierarchy until you feel the pain of not having it.

---

## 5. Dolt needs a cache and queue setup to be effective

**What happened:**  
The execa path (spawning a `dolt sql` subprocess per query) added ~150 ms per query. A `tg start` with ~9 queries = ~900 ms of pure spawn tax. Multi-agent setups made this worse: the noms storage layer doesn't support concurrent process access, so a semaphore serialized all queries, turning parallel agents into an effectively serial queue at the Dolt boundary.

The fix was a **server-first model** (`tg server start` → persistent `dolt sql-server` → mysql2 pool). Queries went from 150 ms/each to 5 ms/each. A **query result cache** (TTL-based, table-level invalidation) cut repeat reads. A **CQRS write queue** (planned but not yet implemented) would give agents eventual consistency for writes, eliminating blocking on commits.

The transcript analysis confirmed the downstream effect: 79% of sessions hit Dolt connection failures, leading to retry loops that burned 2–4 extra turns per session.

**What to take back:**  
If you use any persistent store with an agent feedback loop (any CLI that reads/writes state and is called repeatedly by agents), the pattern is:
1. **Server mode over subprocess**: a persistent connection is always faster than per-query process spawn
2. **TTL cache for reads**: agents read status far more than they write; a 1–2s cache eliminates most repeated reads
3. **Queue for writes**: agents don't need to wait for writes to commit; eventual consistency is fine for most coordination tasks
4. **Circuit breaker in agent templates**: when the store is down, stop retrying immediately and work from cached/injected context. Every retry is a wasted turn.

---

## 6. Sub-agents benefit from context injection and action focus (OOD/Act)

**What worked:**  
The transcript analysis showed implementers rarely call `tg context` themselves — because the orchestrator already injected it into their prompt. This is the right pattern: the **orchestrator does Observe/Orient/Decide; the sub-agent only Acts.**

The OOD/Act proposal (`reports/review-26-03-03_ood-act-proposal.md`) formalizes this:
- **Orchestrator/lead:** Gather context, understand scope, resolve conflicts, choose the concrete action and target file paths.
- **Sub-agent:** Receives a clear action directive ("In `src/cli/context.ts`: add function X that does Y"). Does not re-observe, re-orient, or re-decide. Executes and reports.

This is why the best sub-agent prompts look like: `{{ACTION_DIRECTIVE}} + {{TARGET_PATHS}} + minimal supporting context` rather than `{{INTENT}} + {{FILE_TREE}} + "figure it out"`. The latter forces the sub-agent to redo work the orchestrator already did; the former focuses the sub-agent's full context budget on execution.

**Pre-conditions matter:** If the sub-agent's action depends on something being true (e.g. "file F exists", "function G is present"), include `{{PRECONDITIONS}}` so the sub-agent can bail fast with `VERDICT: FAIL + SUGGESTED_FIX` rather than getting confused.

**What to take back:**  
When prompting any agent, think in three phases:
1. **You (the prompter) do OOD first**: read the relevant files, understand the scope, decide exactly what needs to happen.
2. **Write the action directive**: "In file F, do X. Return the result."
3. **Include only what the agent needs to act**: don't dump the entire codebase; include the file(s) it will touch, the relevant types, and the constraints.

The more of OOD you do before dispatching, the more focused and correct the agent's output. This is especially true with weaker models; stronger models can do more OOD themselves, but it still costs context tokens and turns.

---

## 7. Worktrees are messy to work with

**What happened:**  
Worktrees provided genuine parallelism for multi-agent execution (each agent in its own branch/directory, no file conflicts), but they introduced significant accidental complexity:

- **Silent data loss**: if `tg done` was called without `--merge`, commits became orphaned git objects. The plan branch had no commits ahead of main. Work was silently lost. This happened at least once (`reports/26-03-02_worktree_lifecycle_evolve.md`).
- **Contradictory instructions**: four independent passages in `subagent-dispatch.mdc` said different things about who runs `tg start --worktree` (orchestrator vs implementer). Agents followed the examples, not the prose.
- **Plan-merge was invisible**: the plan-merge step (landing all task branches onto main) was documented once in intro text but absent from every step-by-step completion checklist. It was added only after a plan completed with all work still on the plan branch.
- **Documenter changes lost**: documenters editing files in the main working tree without committing before `tg done` lost their changes at plan-merge time.
- **Pre-dispatch gate missing**: no check that the plan branch existed before dispatching Wave 1. Symptom: task worktrees (`tg-XXXXXX`) appeared but no matching `plan-p-*` worktree. Fix was manual recovery.

The core lesson: **worktrees are powerful but unforgiving. Any command that can silently discard commits must be in every completion checklist, in the example command, not just in prose.**

**What to take back:**  
If you use worktrees for parallel agents:
- Every template must have the commit + merge step as a copy-paste runnable command, not explained in prose.
- Add a pre-dispatch verification step: "does the plan branch exist?"
- Prefer the simpler pattern (one agent, one branch) until you have genuine parallelism needs. The overhead of worktree lifecycle management is real.
- If you do use them, test the full lifecycle (start → work → done → plan-merge → verify on main) with a trivial task before shipping real work.

---

## 8. Docs are the first-class context mechanism

**What worked:**  
The `docs/` directory with domain docs (one per bounded context: schema, testing, architecture, CLI, error handling, etc.) proved to be the most reliable way to give agents accurate, durable context. Agents that read the relevant domain doc before working in an area made fewer mistakes, followed existing patterns, and required less correction.

The doc-skill-registry (`triggers` frontmatter with file globs and keywords) enables automatic doc assignment: when a task touches `src/db/`, the schema and architecture docs are surfaced automatically without the orchestrator having to remember.

**What doesn't work:**  
- Code comments as primary documentation: agents don't find them reliably without knowing which file to read
- Memory as a primary knowledge store: it grows to 150+ lines and becomes noise; durable knowledge must migrate to docs
- Long prose docs: agents process structured content (tables, bullet lists, code blocks) better than paragraphs. Lead with structure.

**What to take back:**  
For any codebase you're going to work on with agents:
1. **Write a short domain doc for each major subsystem** before you start. Even 20 lines covering "what this owns, key entry points, gotchas, and decisions" is enough.
2. **Decisions inline, not in a separate ADR folder.** Agents lose context when they have to cross-reference. The decision belongs in the domain doc, next to the system it applies to.
3. **Related projects section.** At the bottom of each doc, list the recent changes that shaped it. This gives agents historical context for why things are the way they are.
4. **Evolve docs from work, not up front.** Write thin docs first; route learnings into them after each sprint. The doc grows from ground truth, not speculation.

---

## 9. Template precision — wrong example = wrong behavior at scale

**What happened:**  
The `--merge` flag issue (finding AP-1 in `reports/26-03-02_worktree_lifecycle_evolve.md`) showed that when a template's **example command** omits a required flag, agents follow the example, not the explanatory prose. A single wrong command example caused all implementers to call `tg done` without `--merge`, silently orphaning all their commits.

This was observed multiple times:
- `tg next` flag escalation (agents tried bare → `--json` → `--limit 20` → `--plan` because no canonical form was in the examples)
- Orchestrator pre-starting worktrees sequentially (four passages implied it even though `implementer.md` Step 1 had self-start)
- Terminal-file polling applied to Task tool calls (pattern bled in from shell-command monitoring docs by analogy)

**What to take back:**  
In any agent template or rule:
- **Command examples are canonical.** If the example shows `tg done`, agents will run exactly that. If it should be `tg done --merge`, the example must say `tg done --merge`.
- **One canonical form per command.** Don't show four variants; pick one and standardize. Multiple variants force the agent to choose; it will often choose wrong or escalate through them.
- **Contradiction resolution:** When two files say different things about the same procedure, agents will pick one inconsistently. Find contradictions early (the review skill catches them) and resolve to a single canonical source.

---

## 10. The evolve loop — mine completed work for anti-patterns

**What worked:**  
The `/evolve` skill runs after a plan completes, analyzes task diffs, and routes learnings to the right destination (utility belt, agent templates, docs). It found anti-patterns that weren't visible during implementation: contradictions between template files, missing flags in examples, patterns that worked locally but broke at scale.

The transcript-based variant (evolve-cli) ran without plan diffs, using only transcript text mining. It surfaced the Dolt retry loop pattern (79% of sessions) and the canonical `tg next` issue — neither of which was obvious from code review alone.

**What to take back:**  
After completing any significant feature or sprint, spend 20 minutes doing a lightweight evolve:
1. Read the git log for the sprint — what files were touched most? What errors appeared in commit messages?
2. Look at any agent transcripts — what did agents repeat? What did they get wrong?
3. Write 3–5 learnings and route them: codebase-specific patterns go to the relevant doc; cross-cutting patterns go to the utility belt; environment quirks go to memory.

The value compounds. A team that does this after every sprint has a codebase that agents understand better by default.

---

## 11. Parallel dispatch — same-turn emission is the key

**What worked:**  
Dispatching N sub-agents in a single response turn (not sequentially across turns) is the mechanism that enables genuine parallelism. Cursor runs them concurrently and surfaces the orchestration UI.

The most common anti-pattern was sequential dispatch: one agent per turn, waiting for each to complete before starting the next. This negated the parallelism benefit entirely and was 3–5x slower for a 4-agent wave.

The constraint: agents sharing mutable state (e.g. same git branch, same database row) cannot run in parallel without isolation. Worktrees solve this for git; the Dolt server + per-branch pools solve this for the DB.

**What to take back:**  
For any multi-step workflow where steps are independent (no shared mutable state), emit all sub-agent calls in the same turn. If you're doing this in a Cursor session, batch the Task tool calls. If you're building automation scripts, parallelize with `Promise.all` or similar.

The isolation requirement is the real constraint to design around: model "what mutable state do these agents share?" and provide isolation before parallelizing.

---

## 12. Breadcrumbs — committed, path-scoped context that survives sessions

**What worked:**  
Breadcrumbs (`.breadcrumbs.json`) are small committed JSON entries attached to file paths. Unlike code comments, they're readable without knowing which file to look in (agents filter by path prefix before editing). Unlike task notes, they survive plan closure and session end.

They're most valuable for: non-obvious workarounds, security-critical patterns, "this looks wrong but is intentional" code, and timing/timeout values that have been tuned by experience (e.g. the OpenTUI 3s import timeout that causes silent fallback if lowered).

**What to take back:**  
A committed metadata file (`breadcrumbs.json` or similar) is a simple and powerful pattern for any codebase with non-obvious constraints. It puts the "why" where agents will find it — before they touch the file — rather than in a commit message they'd have to know to search for.

---

## Summary table

| Pattern | Value at multi-agent scale | Value in solo dev | Transferability |
|---------|---------------------------|-------------------|-----------------|
| Skills (agent + teams) | Very high | High | Direct |
| Utility belt (shared learnings) | Very high | High | Direct |
| Transcript mining | High | Medium | Adapt (simpler regex scan) |
| Task tracking | High | Low-Medium | Use simple checklist solo |
| DB server + cache + queue | Critical | Medium | Use server mode always |
| OOD/Act sub-agent focus | Very high | High | Direct (applies to any prompt) |
| Worktrees | Risky/complex | Not needed | Avoid until forced |
| Domain docs as context | Very high | Very high | Direct |
| Template precision | Critical | High | Direct |
| Evolve loop (post-sprint mining) | Very high | High | Direct |
| Parallel same-turn dispatch | Very high | Low | Multi-agent only |
| Breadcrumbs (path-scoped context) | High | Medium | Simple to replicate |

---

## Top 5 patterns to act on immediately

1. **Domain docs before agent work.** Write thin docs for each subsystem before starting; route learnings into them after each sprint.
2. **OOD/Act discipline.** Do your Observe/Orient/Decide before dispatching any agent. The sub-agent prompt should be an action directive, not an exploration task.
3. **Utility belt.** Start a shared learnings document for your project. Inject it into every significant agent prompt.
4. **Template precision.** Every command example in a rule or template must be copy-paste correct. Prose explanations do not override wrong examples.
5. **Post-sprint evolve loop.** 20 minutes of "what did agents repeat or get wrong?" after each sprint routes high-value learnings before the next sprint starts.
