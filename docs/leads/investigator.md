# Lead: Investigator (Hunter-Killer)

## Purpose

Active debug-and-fix lead. Dispatched by the **work** skill when `gate:full` fails at the end of a plan. The orchestrator groups failures into clusters, then dispatches one investigator per cluster. Investigators are read-write: they investigate **and** fix. They do not return findings for a human to act on — they drive failures to zero (or escalate with a precise diagnosis).

**Not the research agent** — if you need read-only research to understand the codebase or plan next steps, use the **reviewer in research mode** (dispatched by the `/investigate` skill).

## Agent file

- `.cursor/agents/investigator.md` — prompt template for the hunter-killer sub-agent

## When to use

- `gate:full` fails at the end of a plan (the dedicated `run-full-suite` task fails).
- The orchestrator needs targeted debug+fix rather than just research.
- Multiple failure clusters exist → dispatch one investigator per cluster in parallel.

## Pattern

```
gate:full fails
    ↓
Orchestrator clusters failures by test suite / area
    ↓
Dispatch N investigators in parallel (one per cluster)
    ↓
Each investigator:
    1. Reproduce the failing tests
    2. Trace root cause
    3. Apply targeted fix (max 3 attempts)
    4. Verify fix
    5. Return STATUS report
    ↓
Orchestrator reviews reports:
    - FIXED: continue (re-run gate:full after all clusters report)
    - PARTIAL/ESCALATE: create fix tasks or escalate to human
```

## Input (to investigator)

- `{{FAILURE_CLUSTER}}` — Test suite(s) / test names that failed
- `{{STACK_TRACES}}` — Error output from gate:full
- `{{PLAN_CONTEXT}}` — What the plan implemented (one line)
- `{{CHANGED_FILES}}` — Key files changed in this plan

## Output (from investigator)

Structured report with: `STATUS` (FIXED / PARTIAL / ESCALATE), `ROOT_CAUSE`, `FIX_APPLIED`, `VERIFICATION`, `REMAINING_FAILURES`, `ESCALATION_REASON`.

## Orchestrator protocol after investigators complete

1. Collect all investigator reports.
2. Re-run `pnpm gate:full` (or targeted subset) to verify combined fixes.
3. If gate:full now passes → plan complete, proceed to dolt commit.
4. If gate:full still fails after investigator fixes:
   - For ESCALATE reports: create fix tasks in the task graph (`tg task new`) and re-enter the work loop.
   - For persistent failures: escalate to human with a summary of what was attempted and what remains.

## Contrast with other agents

| Agent                    | Read/Write | Dispatched when                        | Output                                |
| ------------------------ | ---------- | -------------------------------------- | ------------------------------------- |
| **investigator**         | read-write | gate:full fails (end of plan)          | STATUS report + fix applied           |
| **reviewer (research)**  | read-only  | /investigate skill                     | Structured findings + suggested tasks |
| **reviewer (PASS/FAIL)** | read-only  | After implementer completes task       | PASS or FAIL verdict                  |
| **debugger**             | read-write | Single debugging task in task graph    | tg done with evidence                 |
| **fixer**                | read-write | After 2 implementer failures on a task | tg done with evidence                 |

## See also

- `.cursor/skills/work/SKILL.md` — work skill (dispatches investigator on gate:full failure)
- `.cursor/agents/reviewer.md` — research mode template (used by /investigate skill)
- `docs/leads/execution.md` — full execution lead doc
