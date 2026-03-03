# Evolve-CLI: Transcript-Based Pattern Mining

**Date:** 2026-03-03
**Scope:** All agent transcripts (94 sessions, 424 transcript files — parent + subagent)
**Produced by:** Orchestrator, evolve-cli skill

---

## Executive Summary

Transcript analysis reveals **five actionable patterns** of CLI chatter that waste agent turns and tokens. The dominant issue is not redundant `tg context` calls (the original hypothesis) but rather:

1. **`tg status` + `tg next` are almost always called together** (68% of sessions with `status --tasks` also call `next`) — they should be a single call.
2. **Dolt/DB failures cause 79% of sessions to hit retry loops** — agents retry `tg status`, `tg next`, and `tg context` after connection failures, burning 2–4 extra turns per session.
3. **`tg next` is called with escalating flag variants** (no flags → `--json` → `--json --limit 20` → `--plan "<name>" --json --limit 20`) — agents don't know the right invocation upfront.
4. **Subagent implementers rarely call `tg context`** — only 2 of the top 15 implementer sequences include `context`, suggesting the orchestrator's prompt already provides sufficient context or implementers skip it.
5. **Template echo inflates apparent `context` repetition** — many `tg context --hive` mentions are the implementer prompt template being echoed, not actual re-execution.

## Critical Finding: Transcript Schema Drift

**All 424 transcript files contain only `text`-type content blocks.** Zero `tool_use` or `tool_call` structured blocks were found. The Cursor transcript export does not capture structured tool invocations — only the assistant's text narrative about what it did.

This means:
- The `docs/transcript-schema.md` assumed schema (with `tool_use`/`tool_call` blocks) **does not match reality**.
- Any scanner relying on structured tool-call detection will find nothing.
- Analysis must use **text mining** (regex extraction from assistant text blocks) instead.

**Recommendation:** Update `docs/transcript-schema.md` to document the actual format (text-only blocks) and provide regex patterns for extracting tg commands from text. Add a "Schema status" section noting that structured tool calls are not currently exported.

---

## Quantitative Findings

### Overall CLI Command Frequency

| Command | Mentions | % of Total |
|---------|----------|-----------|
| `tg next` | 4,448 | 28.0% |
| `tg done` | 2,870 | 18.0% |
| `tg status` | 2,578 | 16.2% |
| `tg start` | 1,816 | 11.4% |
| `tg note` | 1,304 | 8.2% |
| `tg context` | 1,160 | 7.3% |
| `tg task` | 742 | 4.7% |
| `tg import` | 478 | 3.0% |
| `tg worktree` | 261 | 1.6% |
| Other | 247 | 1.6% |
| **Total** | **15,904** | |

### Top Command Variants

| Variant | Count |
|---------|-------|
| `tg next --json --limit 20` | 730 |
| `tg status --json` | 561 |
| `tg status --tasks` | 425 |
| `tg next --plan <plan> --json --limit 20` | 359 |
| `tg next` (bare) | 315 |
| `tg context --hive --json` | 227 |
| `tg next --json` | 222 |

### Command Bigrams (What Follows What)

| Sequence | Count | Signal |
|----------|-------|--------|
| `done → done` | 91 | Batch completion (expected) |
| `next → next` | 52 | **Retry/escalation pattern** |
| `status → next` | 41 | **Info gap: status doesn't show runnable** |
| `start → start` | 38 | Batch start (expected) |
| `next → status` | 36 | **Reverse info gap: next doesn't show overview** |
| `start → done` | 35 | Fast task completion (expected) |
| `done → next` | 32 | Normal loop (expected) |
| `status → status` | 31 | **Retry or escalation** |
| `context → context` | 22 | **Template echo + retry** |

### Dolt/DB Failure Rate

- **79% of sessions** (95/120) mention Dolt/DB failures (connection refused, timeout, read-only, hang).
- Most common failure: `connection refused on 127.0.0.1:3307` (Dolt server not running).
- Second: `database is read only` (Dolt lock or permissions).
- Third: `timed out` (Dolt metadata query blocking for 30s+).

### Sliding Window Violations

Using a window of 5 assistant messages and threshold of ≥3 context/status/next commands:
- **89 sessions** triggered the pattern (74% of all sessions with tg commands).
- Heaviest session: 45fa043a with 963 tg command mentions across 18 assistant messages.

---

## Pattern Analysis

### Pattern 1: Status + Next Information Gap

**Frequency:** 68% of sessions calling `tg status --tasks` also call `tg next`.

**Root cause:** `tg status --tasks` shows all tasks with their status, plan, and owner — but does **not** indicate which tasks are **runnable** (unblocked, todo, with satisfied dependencies). Agents must then call `tg next` to get the runnable set.

**Improvement:** Add a `Runnable` column or marker to `tg status --tasks` output, or create a combined `tg status --tasks --runnable` flag that annotates which tasks are next-eligible. Alternatively, `tg next` could include a brief status summary header.

### Pattern 2: Dolt Failure Retry Loops

**Frequency:** 79% of sessions, ~59 retry mentions across sessions.

**Root cause:** Agents don't detect "Dolt is down" as a persistent condition. After a `tg status` failure, they retry `tg next`, then `tg context`, each failing independently. No circuit-breaker exists.

**Improvement options:**
1. **CLI-level:** Add a `tg health` or `tg ping` command that quickly checks Dolt connectivity. Agent templates could call this once at startup; if it fails, skip all tg commands and work from cached/prompt context.
2. **Agent-level:** Add guidance to agent templates: "If any tg command fails with connection refused or timeout, assume Dolt is down for this session. Do not retry other tg commands. Work from the context provided in your prompt."
3. **CLI-level:** Cache the last successful `tg status --tasks --json` and `tg next --json` output to a local file. When Dolt is unreachable, serve stale data with a warning.

### Pattern 3: `tg next` Flag Escalation

**Frequency:** 52 `next → next` bigrams.

**Root cause:** Agents try `tg next` bare, then add `--json`, then `--limit 20`, then `--plan "<name>"`. The agent templates and rules mention multiple variants without a single canonical invocation.

**Improvement:** Standardize on one canonical form in all agent templates and rules: `tg next --plan <focus_plan> --json --limit 20`. Remove bare `tg next` from examples. The CLI could also default to `--json` when stdout is not a TTY (agent detection).

### Pattern 4: Implementers Skip `tg context`

**Frequency:** Only 2 of top 15 implementer subagent sequences include `context`.

**Root cause:** The orchestrator's prompt to the implementer already includes task context (from `tg context` output embedded in the prompt). The implementer doesn't need to call it again. This is actually **good** — the orchestrator pre-loads context.

**Implication:** The `tg context` call is primarily an orchestrator concern, not an implementer concern. Agent templates for implementers can remove the "run `tg context`" instruction if the orchestrator always provides it.

### Pattern 5: Template Echo Inflation

**Frequency:** ~5 messages with template echo vs ~7 with actual execution.

**Root cause:** When the orchestrator builds an implementer prompt, it includes text like "run `tg context --hive --json`". This text appears in the transcript as a `tg context` mention even though the implementer may never execute it.

**Implication:** Raw command counts overestimate actual execution by ~40% for `tg context`. Text-mining analysis should filter out user-role messages and template-like patterns. Not a CLI improvement — a scanner calibration issue.

---

## Recommendations

### High Impact (address first)

| # | Recommendation | Effort | Impact |
|---|---------------|--------|--------|
| 1 | **Combine status + next:** Add `--runnable` flag to `tg status --tasks` or include runnable markers, so agents don't need a separate `tg next` call | Medium | Eliminates ~41 bigram occurrences per corpus; saves 1 turn per session |
| 2 | **Dolt health check + circuit breaker:** Add `tg ping` and agent-template guidance to stop retrying when Dolt is down | Low | Eliminates retry loops in 79% of sessions |
| 3 | **Canonical `tg next` invocation:** Standardize all templates on `tg next --plan <plan> --json --limit 20`; remove bare `tg next` from examples | Low | Eliminates flag-escalation pattern (52 bigrams) |

### Medium Impact

| # | Recommendation | Effort | Impact |
|---|---------------|--------|--------|
| 4 | **Auto-JSON for non-TTY:** CLI detects piped/non-TTY stdout and defaults to `--json` output | Low | Removes need for agents to remember `--json` flag |
| 5 | **Stale cache for offline mode:** Cache last `tg status` and `tg next` output; serve when Dolt unreachable | Medium | Agents can orient even when DB is down |
| 6 | **Remove `tg context` from implementer templates:** Orchestrator already provides context in the prompt | Low | Reduces confusion; implementers don't call it anyway |

### Documentation / Schema

| # | Recommendation | Effort | Impact |
|---|---------------|--------|--------|
| 7 | **Update `docs/transcript-schema.md`:** Document that transcripts are text-only (no structured tool_use blocks); provide regex patterns for text mining | Low | Enables future evolve-cli runs to work correctly |
| 8 | **Request structured tool-call export from Cursor:** File a feature request for Cursor to include `tool_use`/`tool_call` blocks in transcript exports | N/A | Would enable precise tool-call analysis |

---

## Methodology Notes

- **Text mining approach:** Since transcripts contain only `text`-type content blocks (no structured `tool_use`/`tool_call`), all tg command detection used regex extraction from assistant text. This captures both actual executions and discussions/references.
- **Execution vs reference:** Attempted to distinguish "Running `tg ...`" (execution) from template/discussion mentions. Execution-pattern detection found ~586 confirmed executions vs ~15,904 total mentions, suggesting ~96% of mentions are references/discussion.
- **Sliding window:** Used 5-message windows with ≥3 context/status/next threshold. 89/120 sessions (74%) triggered, indicating the pattern is pervasive.
- **Deduplication:** Overlapping violation windows were merged, keeping the highest-count window.
