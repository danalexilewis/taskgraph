# Lead: Debug

## Purpose

Systematic debugging lead for unclear root cause, failing tests with unknown cause, or when the user invokes **/debug**. The skill runs a four-phase process (investigate → pattern analysis → hypothesis and test → implement) and escalates after 3 failed fix attempts.

## Skill and agents

- **Skill:** `/debug` (`.cursor/skills/debug/SKILL.md`)
- **Agent files** (workers, optional):
  - `.cursor/agents/investigator.md` — root cause and pattern analysis (Phase 1–2)
  - `.cursor/agents/implementer.md` — single-change fixes and verification (Phase 4)

## Pattern

1. **Phase 1 — Root Cause Investigation** — Read errors, reproduce, check recent changes, trace data flow. No fix until done.
2. **Phase 2 — Pattern Analysis** — Find working examples, compare differences, narrow scope.
3. **Phase 3 — Hypothesis and Testing** — One hypothesis at a time, one change at a time, verify.
4. **Phase 4 — Implementation** — Failing test first (if needed), implement fix, verify.
5. **Escalation** — After 3 failed fix attempts, stop and report; orchestrator creates investigate task or escalates to human.

## Input

- User says `/debug` or task/bug with unclear root cause (e.g. failing test with unknown cause).
- Optional: stack trace, test output, recent changes, or task context.

## Output

- **Success**: Root cause summary, fix applied, verification (commands run, pass/fail).
- **Escalation**: What was tried, current state, request for investigate task or human escalation.

## When to use

- User says **/debug** or asks for systematic debugging.
- **Unclear root cause** — Bug or task where the cause is not known.
- **Failing test with unknown cause** — Do not guess fixes; run the four-phase process and escalate after 3 failed attempts.
