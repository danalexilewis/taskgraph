---
name: debug
description: Systematic debugging for unclear root cause, failing tests with unknown cause, or when the user says /debug. Four-phase process: Root Cause Investigation, Pattern Analysis, Hypothesis and Testing, Implementation. Escalate after 3 failed fix attempts.
---

# Debug (systematic)

**Lead documentation:** See [docs/leads/debug.md](docs/leads/debug.md).

Use this skill when root cause is unclear: failing test with unknown cause, user says `/debug`, or tasks that require methodical diagnosis before any fix.

## When to use

- User says **/debug** or asks for systematic debugging.
- **Unclear root cause** — Task or bug where the cause is unknown (e.g. "fix the failing test" with no obvious failure reason).
- **Failing test with unknown cause** — Test fails and the failure is not yet understood; do not guess fixes.

## Architecture

- **You (orchestrator / debug lead)**: Run the four-phase process; may do investigation and fix in-session or dispatch investigator for Phase 1–2 and implementer for Phase 4. Escalate after 3 failed fix attempts.
- **Sub-agents** (optional, as needed):
  | Agent | Purpose | Permission |
  | ------------ | -------------------------------- | ------------- |
  | investigator | Root cause and pattern analysis | read-only |
  | implementer | Single-change fixes, verification| read+write |

**Constraint**: No fix (no code edit intended to fix the bug) until Phase 1 is complete. After 3 failed fix attempts, stop and report; orchestrator creates an investigate task or escalates to human.

## Permissions

- **Lead**: read-only in Phase 1–2; may write in Phase 3–4 only after hypothesis is formed.
- **Propagation**: Investigator readonly=true; implementer may edit only for the one-change-under-test in Phase 3–4.
- **Rule**: One change at a time when testing hypotheses; create failing test first in Phase 4, then implement fix.

## Decision tree

```mermaid
flowchart TD
    A[/debug or unclear root cause] --> B[Phase 1: Root Cause Investigation]
    B --> C{Cause clear?}
    C -->|No| D[Phase 2: Pattern Analysis]
    D --> E[Phase 3: Hypothesis and Testing]
    E --> F[Phase 4: Implementation]
    F --> G{Verify}
    G -->|Pass| H[Done]
    G -->|Fail| I{Fix attempts < 3?}
    I -->|Yes| E
    I -->|No| J[Stop and report; orchestrator escalates]
    C -->|Yes| E
```

## Workflow

### Phase 1 — Root Cause Investigation (no fix yet)

- **Read errors** — Stack traces, test output, log messages; note exact failure and location.
- **Reproduce** — Reproduce the failure (e.g. run the failing test or command) and confirm steps.
- **Check recent changes** — Recent commits, changed files, or task context that might have introduced the regression.
- **Trace data flow** — Follow data/call path from entry to failure site (e.g. CLI → domain → db).

**Exit condition**: Do not implement any fix until this phase is done. If cause is still unclear, continue to Phase 2.

### Phase 2 — Pattern Analysis

- **Find working examples** — Same or similar code paths that work (e.g. another test, another command).
- **Compare differences** — What differs between working and failing case (inputs, state, order, env).
- **Narrow scope** — Identify the minimal difference that could explain the failure.

### Phase 3 — Hypothesis and Testing

- **Form one hypothesis** — Single suspected cause (e.g. "missing null check", "wrong order of calls").
- **One change at a time** — Make exactly one change to test the hypothesis (code or test setup).
- **Verify** — Run the failing scenario again; confirm pass or fail and update hypothesis.

**Rule**: Do not batch multiple fixes. If the change does not fix the issue, revert it and try the next hypothesis.

### Phase 4 — Implementation

- **Failing test first** — If no test exists that captures the bug, add or adjust a test that fails in the current state.
- **Implement fix** — Apply the minimal fix that makes the new (or existing) test pass.
- **Verify** — Run the test and any related tests; confirm no regressions.

### Escalation

- **After 3 failed fix attempts** (hypotheses that did not resolve the issue): **Stop** and report to the orchestrator.
- **Report contents**: What was tried, what failed, current hypothesis or "unknown". Do not keep trying more fixes in-session.
- **Orchestrator**: Creates an investigate task (e.g. investigator sub-agent) or escalates to human.

## Output format

When debugging completes successfully:

- **Summary**: Root cause (1–2 sentences), fix applied, and how it was verified.
- **Evidence**: Commands run (e.g. test name), result (pass/fail).

When escalating after 3 failed attempts:

- **Summary**: "Escalating after 3 failed fix attempts."
- **What was tried**: List of hypotheses and what happened.
- **Current state**: Last hypothesis or "root cause still unknown."
- **Next step**: "Orchestrator: create investigate task or escalate to human."

## Reference

- **Lead doc**: [docs/leads/debug.md](docs/leads/debug.md)
- **Investigator** (optional): `.cursor/agents/investigator.md` for Phase 1–2 if delegated
- **Implementer** (optional): `.cursor/agents/implementer.md` for Phase 4 if delegated
- **Rules**: `.cursor/rules/taskgraph-workflow.mdc`, `.cursor/rules/subagent-dispatch.mdc`
