# Evolve: From transcript analysis report — 2026-03-03

**Source:** [reports/26-03-03_evolve-cli-transcript-analysis.md](26-03-03_evolve-cli-transcript-analysis.md) (evolve-cli skill output).  
**Trigger:** User requested "run evolve based on" that report. No plan diff was used; findings were routed from the transcript-analysis recommendations.

---

## State Documentation

### Metrics

| Field          | Value | Description |
|----------------|-------|-------------|
| sample_size    | 94 sessions, 424 transcript files | Corpus used in the source report. |
| diff_lines     | — | No plan diff; source was transcript analysis. |
| files_changed  | — | N/A. |
| confidence    | high | Findings are from quantitative transcript mining and explicit recommendations. |
| recurrence    | 5 patterns | Status+next gap, Dolt retry loops, tg next escalation, implementers skip context, template echo. |

### What was done

- **Input:** Evolve-cli transcript analysis (94 sessions, 15,904 tg command mentions, bigrams, failure rate 79% for Dolt/DB).
- **Routed:** Three learnings to utility belt (Dolt-down circuit breaker, canonical tg next, orchestrator-provided context); one to implementer (Dolt down → do not retry tg commands).
- **Docs:** `docs/transcript-schema.md` already contained the "Current reality" and text-mining fallback (no change needed).

---

## Pattern Learnings

### Findings (from transcript report)

| Category         | Pattern | Source finding | Routed to |
|------------------|---------|----------------|-----------|
| Process/tooling  | Dolt failure retry loops | 79% of sessions retry status/next/context after connection refused/timeout | utility belt + implementer |
| Process/tooling  | tg next flag escalation | Agents try bare → --json → --limit 20 → --plan; no single canonical form | utility belt |
| Process/tooling  | Implementers skip tg context | Orchestrator already provides context in prompt; implementers rarely call context | utility belt |
| Schema/docs      | Transcript schema drift | Text-only blocks; no tool_use/tool_call in export | Already in docs/transcript-schema.md |

### Learnings written

- **`.cursor/agent-utility-belt.md`** — New section "tg CLI and Dolt (from transcript analysis 2026-03-03)": (1) When tg fails with connection refused/timeout/read only, treat Dolt as down; do not retry other tg commands. (2) Canonical tg next: `tg next --plan "<plan>" --json --limit 20`. (3) Orchestrator injects context; implementers typically don't need to call tg context again.
- **`.cursor/agents/implementer.md`** — One learning: If tg fails with connection refused/timeout/database read only, assume Dolt unavailable; do not retry status/next/context; work from prompt context and escalate via tg note if blocked.
- **`docs/transcript-schema.md`** — No change; already documents text-only reality and regex fallback (see "Current reality" and "Text-mining fallback").

### Durable patterns (suggest doc update)

- **docs/cli-reference.md** (or agent-contract): Consider documenting the canonical `tg next --plan "<plan>" --json --limit 20` as the recommended form for agents. Optional: add `tg health` / `tg ping` in a future plan to allow a single startup check before running other tg commands.
- **Status + next info gap:** Report recommends `tg status --tasks --runnable` or runnable markers; that is a product/CLI change, not a learning route. Left for a future plan.

---

## Summary

Evolve was run using the evolve-cli transcript analysis report as input. Four findings were routed: three to the utility belt (Dolt-down circuit breaker, canonical tg next, orchestrator-provided context) and one to the implementer (do not retry tg commands when Dolt is down). Transcript schema doc was already up to date. CLI improvements (status --runnable, tg ping) remain as recommendations in the source report for future work.
