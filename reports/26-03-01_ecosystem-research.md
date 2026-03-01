# Ecosystem Research: Task-Graph vs. Reference Projects and Vendor Patterns

**Date:** 2026-03-01
**Scope:** Compare Task-Graph's agent orchestration, planning, and execution patterns against Gastown, Beads, Superpowers, and Anthropic vendor guidance to identify actionable improvements.
**Produced by:** Orchestrator research skill — web fetch of 6 reference projects/docs, analysis against current AGENT.md, agent-strategy.md, skills, and existing reports.

---

## 1. Sources Examined

| Source                                                                                                          | Type                           | Stars | Key relevance                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| [Superpowers](https://github.com/obra/superpowers)                                                              | Skills framework               | 66K   | Mandatory brainstorm→plan→implement→review workflow; two-stage review; systematic debugging                                   |
| [Gastown](https://github.com/steveyegge/gastown)                                                                | Multi-agent workspace manager  | 10.6K | Persistent agent identity; convoys (work batching); activity feed with stuck-agent detection; formulas (repeatable workflows) |
| [Beads](https://github.com/steveyegge/beads)                                                                    | Git-backed graph issue tracker | 17.7K | Compaction (semantic memory decay); richer graph links; hierarchical IDs                                                      |
| [Anthropic: Context Engineering](https://anthropic.com/engineering/effective-context-engineering-for-ai-agents) | Vendor guidance (Sep 2025)     | —     | Context as finite resource; just-in-time retrieval; compaction; structured note-taking                                        |
| [Anthropic: Multi-Agent Research System](https://anthropic.com/engineering/multi-agent-research-system)         | Vendor guidance (Jun 2025)     | —     | Token usage explains 80% of performance; effort scaling; delegation quality; self-improvement                                 |
| [DoltHub: Agentic Workflows](https://dolthub.com/blog/2025-03-17-dolt-agentic-workflows/)                       | Vendor guidance (Mar 2025)     | —     | Branch-per-agent isolation; diff-based review; FAFO over YOLO                                                                 |

---

## 2. Per-Source Findings

### Superpowers

**What it is**: Methodology-as-code — composable SKILL.md files that enforce brainstorm → plan → implement → review. 53K+ installs. Most adopted Claude Code plugin.

**Patterns worth extracting**:

| Pattern                    | Description                                                                                                                                  | Task-Graph status                                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mandatory brainstorming    | Socratic questioning before any plan: one question at a time, propose 2-3 approaches with tradeoffs, present design in sections for approval | **Missing.** We jump from user request → planner-analyst → plan. No structured design-refinement phase.                                                          |
| Two-stage review           | Separate spec-compliance pass then code-quality pass, sequentially                                                                           | **Partially present.** We have `spec-reviewer` and `quality-reviewer` agents defined but the work skill dispatches a single "reviewer" — two-stage not enforced. |
| Fresh subagent per task    | Clean context window per task, no pollution from prior tasks                                                                                 | **Present.** Each Task tool call is a fresh subagent.                                                                                                            |
| Bite-sized tasks (2-5 min) | Steps like "write failing test", "run it", "write minimal code"                                                                              | **Deliberate difference.** Our tasks are ~90 min. Coarser grain means implementers need more autonomy.                                                           |
| Systematic debugging       | 4-phase process: Root Cause → Pattern Analysis → Hypothesis → Implementation. "3 failures = question architecture" escalation.               | **Missing.** Our escalation ladder (re-dispatch → direct → fixer → human) is mechanical, not investigative.                                                      |
| Execution with checkpoints | Batch 3 tasks, report, get feedback, continue                                                                                                | **Present differently.** Our work skill dispatches all runnable tasks in parallel; no batch-and-checkpoint pattern.                                              |

### Gastown

**What it is**: Multi-agent workspace manager for Claude Code. Mayor (coordinator) + Polecats (persistent-identity workers) + Hooks (git worktree persistence) + Convoys (work batching).

**Patterns worth extracting**:

| Pattern                         | Description                                                                                                                                        | Task-Graph status                                                                                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistent agent identity       | Workers have identity that survives session restarts; work history persists                                                                        | **Missing.** Agent names via `--agent` are session-scoped strings with no cross-session continuity.                                                                                            |
| Convoys (work batching)         | Bundle multiple issues assigned to agents as a unit, with own lifecycle (create, add, show, refresh)                                               | **Present as plans.** `tg next --plan` is our equivalent. Convoys are more flexible (span projects, have lifecycle).                                                                           |
| Activity feed + problems view   | Real-time TUI: agent tree, convoy panel, event stream. Problems view classifies agents by health (GUPP Violation, Stalled, Zombie, Working, Idle). | **Missing.** `tg status` is a point-in-time snapshot with no real-time monitoring or stuck-agent detection.                                                                                    |
| Formulas (repeatable workflows) | TOML-defined step sequences with dependency chains and variables, instantiated with parameters                                                     | **Missing.** We have plan files but no template/formula system for repeatable workflows. `docs/templates/` has YAML templates but they're for plan structure, not parameterized instantiation. |
| Hook-based persistence          | Agent work state persists in git worktrees, surviving crashes                                                                                      | **Partially present.** Dolt stores task state; but agent work-in-progress (code changes) relies on IDE session.                                                                                |
| Mail/messaging between agents   | Agents communicate via mailboxes, not just shared state                                                                                            | **Missing.** Agents communicate only through `tg note` and task state. No direct messaging.                                                                                                    |

### Beads

**What it is**: Distributed, git-backed graph issue tracker. Dolt-powered. Hash IDs, compaction, graph links, messaging.

**Patterns worth extracting**:

| Pattern                   | Description                                            | Task-Graph status                                                                                            |
| ------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Compaction (memory decay) | Old closed tasks summarized to save context window     | **Missing.** `tg context` returns full details regardless of age. Context will bloat as projects grow.       |
| Rich graph links          | `relates_to`, `duplicates`, `supersedes`, `replies_to` | **Partial.** Only `blocks` edges. The meta/pattern-tasks skill tries cross-plan edges but types are limited. |
| Hierarchical IDs          | `bd-a3f8.1.1` for epic → task → subtask                | **Missing.** Flat task IDs with plan grouping. No hierarchical decomposition within a plan.                  |
| Stealth mode              | Use tracker locally without committing to main repo    | **Not relevant** to current use case.                                                                        |

### Anthropic: Context Engineering

**Key principles**:

| Principle                      | Description                                                                                      | Task-Graph status                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Context as finite resource     | Diminishing returns as token count increases (context rot). Find smallest high-signal token set. | **Acknowledged but not actively managed.** `tg context` doesn't prune or prioritize.                                       |
| Just-in-time retrieval         | Maintain lightweight references; load data dynamically rather than pre-loading everything        | **Partial.** `tg context` pre-loads task details, plan info, related done tasks, docs. Related done tasks are often noise. |
| Compaction                     | Summarize completed phases; preserve decisions and unresolved bugs; discard redundant outputs    | **Missing.** No compaction in `tg context` or conversation management.                                                     |
| Structured note-taking         | Agents write notes persisted outside context window, pulled back in later                        | **Present.** `tg note` does this. But notes aren't surfaced cross-task — they're per-task only.                            |
| Sub-agent output to filesystem | Subagents write to files, pass references back; avoids "game of telephone" information loss      | **Missing.** Subagents return text through Task tool. No filesystem persistence of intermediate results.                   |

### Anthropic: Multi-Agent Research System

**Key findings**:

| Finding                                   | Description                                                                                                            | Task-Graph status                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Token usage = 80% of performance variance | Multi-agent works because it spends enough tokens. Parallel subagents > single sequential agent.                       | **Aligned.** We dispatch parallel subagents.                                                                          |
| Scale effort to complexity                | Simple: 1 agent, 3-10 tool calls. Complex: 10+ subagents. Explicit scaling rules in prompts.                           | **Missing.** Every task gets same implementer dispatch regardless of complexity.                                      |
| Delegation quality                        | Each subagent needs: objective, output format, tool guidance, clear boundaries. Without this, agents duplicate work.   | **Strong.** Our "Evidence-Grounded Scoped Planning" pattern and intent fields serve this purpose well.                |
| Let agents improve themselves             | Claude 4 models can diagnose prompt failures and suggest improvements. Tool-testing agent reduced completion time 40%. | **Missing.** No self-improvement feedback loop.                                                                       |
| End-state evaluation                      | Evaluate final state, not process steps                                                                                | **Partial.** Reviewer checks diff (process-oriented). No end-state validation ("does the system work as specified?"). |

### DoltHub: Agentic Workflows

**Key insight**: Version control (diff, revert, branch, merge) as fundamental building blocks of agentic workflows. "FAFO over YOLO" — branch-per-agent makes dangerous operations safe experiments.

| Pattern                     | Description                                                     | Task-Graph status                                                      |
| --------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Branch-per-agent            | Agents work on Dolt branches; diffs reviewed before merge       | **Not used.** Single Dolt working set. All agents write to same state. |
| Consensus by diff agreement | Multiple agents on separate branches; merge when majority agree | **Not applicable** at current scale (<3 concurrent agents).            |

---

## 3. Gap Analysis

### Gaps ranked by frequency across sources

| Gap                                      | Sources that identify it      | Current impact                                                                                 |
| ---------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| No context compaction                    | Beads, Anthropic Context Eng. | Low now; will grow as project ages and `tg context` output bloats                              |
| No brainstorming/design-refinement phase | Superpowers                   | Medium — plans sometimes address the wrong problem or miss scope alternatives                  |
| Two-stage review not enforced            | Superpowers                   | Medium — single reviewer conflates spec compliance and code quality                            |
| No systematic debugging skill            | Superpowers                   | Medium — failures handled mechanically (re-dispatch) not investigatively                       |
| No effort scaling per task               | Anthropic Research            | Low-Medium — simple tasks get same overhead as complex ones                                    |
| No cross-task note surfacing             | Anthropic Context Eng.        | Low-Medium — notes from related tasks invisible to current implementer                         |
| No stuck-agent detection                 | Gastown                       | Low — only relevant with 2+ concurrent agents                                                  |
| No repeatable plan templates             | Gastown                       | Low — plans are authored fresh each time; common patterns (bugfix, feature) could be templated |

### What Task-Graph already does well (confirmed by research)

- **Fresh subagent per task** — matches Superpowers and Anthropic guidance
- **Parallel dispatch** — matches Anthropic's "token usage drives performance" finding
- **Structured delegation via intent fields** — matches Anthropic's delegation quality principle
- **Dolt as version-controlled storage** — matches DoltHub's thesis; we have the foundation for branch-per-agent even if we don't use it yet
- **`tg note` for structured note-taking** — matches Anthropic's recommendation
- **Evidence-Grounded Scoped Planning** — our named pattern aligns with Superpowers' emphasis on plans as complete specifications

---

## 4. Recommendations (ranked by impact/effort)

| #   | Improvement                                                    | Primary source         | Impact              | Effort | Rationale                                                                                                                                               |
| --- | -------------------------------------------------------------- | ---------------------- | ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Enforce two-stage review** (spec then quality) in work skill | Superpowers            | High                | Low    | Both agents exist (`spec-reviewer`, `quality-reviewer`). Wire them sequentially in subagent-dispatch. Catches spec drift and quality issues separately. |
| 2   | **Add brainstorming/design-refinement skill**                  | Superpowers            | High                | Medium | New skill before `/plan`: Socratic questioning, 2-3 approaches, incremental approval. Prevents planning the wrong thing.                                |
| 3   | **Context compaction in `tg context`**                         | Beads, Anthropic       | High                | Medium | Summarize old done tasks; prune redundant fields; keep context tight. Critical as project grows.                                                        |
| 4   | **Add systematic debugging skill**                             | Superpowers            | Medium              | Low    | New SKILL.md: 4-phase root-cause process. Integrates with existing escalation ladder — adds investigation before mechanical re-dispatch.                |
| 5   | **Effort scaling per task complexity**                         | Anthropic Research     | Medium              | Low    | Prompt/rule change in implementer.md and subagent-dispatch: simple tasks get constrained tool budget; complex tasks get exploration budget.             |
| 6   | **Cross-task note surfacing**                                  | Anthropic Context Eng. | Medium              | Medium | `tg context` surfaces notes from related tasks (same plan, same files), not just current task. Prevents repeated mistakes.                              |
| 7   | **Stuck-agent detection**                                      | Gastown                | Medium              | Medium | `tg status` flag: tasks in `doing` for >N minutes with no recent events. Useful when running 2+ agents.                                                 |
| 8   | **Repeatable plan templates**                                  | Gastown Formulas       | Medium              | High   | Parameterized YAML/TOML templates instantiated as plans. Common patterns (bugfix, feature, refactor) already have `docs/templates/` stubs.              |
| 9   | **Richer edge types**                                          | Beads                  | Low                 | Medium | Add `relates_to`, `duplicates`, `supersedes` to edge schema. Useful for cross-plan analysis in meta skill.                                              |
| 10  | **Dolt branch isolation for multi-agent**                      | DoltHub                | Low (current scale) | High   | Branch-per-task or branch-per-agent; merge on completion. Investment for when running 3+ concurrent agents.                                             |

---

## Summary

Task-Graph's core architecture (fresh subagents, parallel dispatch, Dolt-backed state, structured delegation via intent fields) is well-aligned with ecosystem best practices. The three highest-impact gaps are: (1) enforcing two-stage review, which requires only wiring existing agents sequentially; (2) adding a brainstorming skill to prevent planning the wrong thing; and (3) context compaction to manage the growing `tg context` output. All three are adoptable without new dependencies or schema changes. The research suggests a follow-up plan covering items 1-6.
