# Lead: Test Review

## Purpose

Audit the project's testing approach, coverage, quality, and infrastructure. Created when the **/test-review** skill runs. The skill dispatches three scanner sub-agents in parallel; the orchestrator synthesizes their findings into a report and a Cursor-format plan with tasks (each task has an `agent` field for execution dispatch).

## Skill and agents

- **Skill:** `/test-review` (`.cursor/skills/review-tests/SKILL.md`)
- **Agent files** (workers; prompt templates for sub-agents):
  - `.cursor/agents/test-quality-auditor.md` — evaluates test quality patterns
  - `.cursor/agents/test-infra-mapper.md` — maps test infrastructure and structural issues
  - `.cursor/agents/test-coverage-scanner.md` — finds untested code and coverage gaps

## Pattern

1. **Dispatch** — Launch all three scanner sub-agents in **parallel** (Task tool, `model="fast"`, readonly). Each returns a structured report.
2. **Synthesize** — Orchestrator merges reports: corroborating signals, conflicts (quality judgement preferred), and priority ranking (P0–P3).
3. **Report** — Write full report to `reports/test-review-YYYY-MM-DD.md` (health score, P0–P3 findings, recommended next steps).
4. **Plan** — Create a Cursor-format plan at `plans/yy-mm-dd_test_review_<scope>.md` with `todos`; each task includes `agent` (one of the three scanners or `implementer`), `blockedBy` if needed, and `changeType`. At least two tasks have no `blockedBy` for parallel execution.

## Input

- **User request** to review tests, audit test coverage, improve testing strategy, or assess test health.
- **Scope** (optional) — e.g. path like `packages/db`; can limit to one scanner ("review test coverage" → coverage scanner only).

## Output

- **Report** — `reports/test-review-YYYY-MM-DD.md` (summary, health score, P0–P3 findings, recommended next steps).
- **Plan** — Cursor-format plan file with tasks; each task has an `agent` field so the execution loop can run `pnpm tg start <taskId> --agent <agent>`.

## When to use

- User says **review tests**, **audit test coverage**, **improve testing strategy**, or **assess test health**.
- User invokes the **/test-review** skill.
