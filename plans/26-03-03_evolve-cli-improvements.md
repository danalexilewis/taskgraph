---
name: Evolve-CLI Improvements
overview: Implement high-impact CLI and agent-template improvements from the evolve-cli transcript analysis and online research so agents need fewer tg calls and stop retrying when Dolt is down.
fileTree: |
  src/cli/
  ├── index.ts              (modify — register health)
  ├── status.ts             (modify — runnable column/flag)
  ├── health.ts             (create — health/ping command)
  docs/
  ├── cli-reference.md       (modify)
  ├── transcript-schema.md   (modify — verify)
  docs/agent-field-guide.md (modify — health, circuit breaker)
  .cursor/rules/
  ├── session-start.mdc     (modify)
  ├── subagent-dispatch.mdc (modify)
  ├── tg-usage.mdc          (modify)
risks:
  - description: status --runnable changes TaskRow and JSON shape; parsers or tests may assume current columns
    severity: low
    mitigation: Add runnable as optional field; document in cli-reference; grep for TaskRow consumers
  - description: tg health runs before migrations; health may pass while migrations fail later
    severity: low
    mitigation: Document that health means "DB reachable + one query"; migration failures remain separate
tests:
  - "Integration test: tg health exits 0 when Dolt reachable, non-zero when connection refused"
  - "Status --tasks --json with --runnable includes runnable boolean per task; one task runnable when todo and no blockers"
todos:
  - id: tg-health-ping
    content: Add tg health (or ping) subcommand that checks Dolt reachability
    agent: implementer
    intent: |
      Add a subcommand `tg health` (or `tg ping`) that verifies Dolt/DB is reachable. Use SELECT 1 via existing doltSql/connection path (src/db/connection.ts) with a short timeout, or when TG_DOLT_SERVER_PORT is set reuse probePort from src/cli/server.ts. Exit 0 if reachable, non-zero with clear message if connection refused / timeout. Register in src/cli/index.ts. Do not run migrations in health; health answers "can we talk to the DB?" only. Document in docs/cli-reference.md and add a short "Health check" note in docs/agent-field-guide.md (when to call it, that agents should not retry other tg commands if health fails).
    suggestedChanges: |
      New file src/cli/health.ts with handler that calls doltSql("SELECT 1", repoPath) or probePort; map connection/timeout errors to exit code and message. In index.ts add .command('health') or .command('ping') and wire handler.
    changeType: create
    docs: cli-reference, agent-field-guide, infra
  - id: status-runnable
    content: Add --runnable flag to tg status --tasks so agents get runnable info in one call
    agent: implementer
    intent: |
      Add optional --runnable flag to status command. When --runnable is set with --tasks (and optionally --json), include a runnable boolean per task. Runnable = status = 'todo' AND no blockers (same condition as next7Sql in src/cli/status.ts lines 368-376: todo + zero unmet blocks from edge type 'blocks'). Extend TaskRow in status.ts with optional runnable?: boolean. In fetchTasksTableData, when options.runnable is true, add a subquery or expression to the tasks SQL so each row gets runnable (e.g. EXISTS or scalar subquery matching next condition). Update status --tasks table output and status --tasks --json to include the column/field when --runnable. Document in docs/cli-reference.md; if table layout changes, note in docs/cli-tables.md.
    suggestedChanges: |
      status.ts: StatusOptions type add runnable?: boolean. TaskRow add optional runnable?: boolean. In fetchTasksTableData build SQL that computes runnable per row (same predicate as next7Sql). Formatting paths that consume TaskRow[] (table and JSON) must emit runnable when present.
    changeType: modify
    docs: cli-reference, schema, agent-field-guide, cli-tables
  - id: circuit-breaker-templates
    content: Add circuit-breaker guidance to rules so agents stop retrying tg when Dolt is down
    agent: implementer
    intent: |
      Add a single source of truth for "when any tg command fails with connection refused, timeout, or read-only, do not retry other tg commands this session." Implementer template already has a 2026-03-03 note. Add the same guidance to .cursor/rules/session-start.mdc, .cursor/rules/subagent-dispatch.mdc, and .cursor/rules/tg-usage.mdc. Prefer one short paragraph that can be referenced (e.g. "If tg fails with connection refused, timeout, or database read-only, assume Dolt is down; do not retry other tg commands. See taskgraph-workflow or agent-contract.") so we don't duplicate long text. Optionally add one sentence to planner-analyst and sitrep-analyst prompts if they run tg status/next.
    suggestedChanges: |
      In one rule file (e.g. taskgraph-workflow.mdc or a new "When blocked" subsection in tg-usage.mdc) add the circuit-breaker paragraph. In session-start, subagent-dispatch, tg-usage add one line that references it (e.g. "On tg connection/timeout/read-only failure: do not retry; see [ref].").
    changeType: modify
    docs: agent-contract, agent-strategy
  - id: canonical-tg-next-templates
    content: Standardize all agent templates and rules on tg next --plan "<Plan>" --json --limit 20
    agent: implementer
    intent: |
      Standardize the canonical invocation for "get runnable tasks" everywhere: `tg next --plan "<Plan>" --json --limit 20` (or pnpm tg next ...). Update .cursor/rules/subagent-dispatch.mdc, .cursor/rules/tg-usage.mdc, .cursor/agents/README.md, .cursor/agents/sitrep-analyst.md, and any reprioritise or work skill that shows tg next examples. Remove or replace bare `tg next` and inconsistent limits (e.g. limit 8 vs 20). Use 20 as the default limit in all templates unless a specific flow requires a different number. Grep for "tg next" and "next --json" across .cursor to find all occurrences.
    suggestedChanges: |
      Grep: rg "tg next|next --json" .cursor --glob "*.md" --glob "*.mdc". Replace with single form: pnpm tg next --plan "<Plan>" --json --limit 20. Document in cli-reference that this is the canonical agent invocation.
    changeType: modify
    docs: cli-reference, agent-contract
  - id: transcript-schema-verify
    content: Verify transcript-schema.md matches evolve-cli report and add Schema status note
    agent: implementer
    intent: |
      Verify docs/transcript-schema.md already documents (1) current reality: text-only content blocks, no tool_use/tool_call in exports, (2) text-mining fallback with regex patterns, (3) filter to assistant role. If anything from reports/26-03-03_evolve-cli-transcript-analysis.md is missing, add it. Add a short "Schema status" subsection stating that structured tool_use/tool_call are not present in Cursor IDE transcript exports; for structured tool-call data, use Cursor CLI with --output-format stream-json when running agents from the terminal. Reference the evolve-cli report for methodology.
    suggestedChanges: |
      Read transcript-schema.md and the report; diff. Add "Schema status" if absent; ensure "Current reality" and "Text-mining fallback" match report; add one line about CLI stream-json for structured tool data.
    changeType: modify
    docs: transcript-schema
  - id: auto-json-non-tty
    content: Default to --json for status, next, context when stdout is not a TTY
    agent: implementer
    intent: |
      When stdout is not a TTY (e.g. piped or agent environment), default to JSON output for commands that support --json: status, next, context. Check with process.stdout.isTTY or similar in the command handler (or in a shared preAction). If !isTTY and the user did not explicitly pass --json, set json: true so agents do not need to remember --json. When user explicitly passes --no-json or similar, respect it. Document in docs/cli-reference.md and docs/agent-field-guide.md.
    suggestedChanges: |
      src/cli/utils.ts or per-command: before parsing, if !process.stdout.isTTY and no explicit --json/--no-json, set json true for status, next, context. Ensure existing --json flags still work. cli-reference: note "When stdout is not a TTY, status/next/context default to JSON output."
    changeType: modify
    docs: cli-reference, agent-field-guide
isProject: false
---

# Evolve-CLI Improvements

## Analysis

The evolve-cli transcript analysis (reports/26-03-03_evolve-cli-transcript-analysis.md) identified five patterns: (1) **status + next** called together in 68% of sessions because status does not show runnable; (2) **Dolt retry loops** in 79% of sessions when DB is down; (3) **tg next flag escalation** (bare → --json → --limit 20 → --plan); (4) implementers rarely call tg context (orchestrator provides it); (5) template echo inflates counts. Online research (fast sub-agent) confirmed: SELECT 1 for health, circuit breaker + fail-fast after N failures, single "agent bootstrap" call (status + runnable in one), and that Cursor IDE transcripts are text-only (CLI stream-json has structured tool_call).

Planner-analyst identified: status already has nextTasks/next7RunnableTasks in fetchStatusData; what’s missing is runnable **per task** in the tasks table. TaskRow and fetchTasksTableData in src/cli/status.ts need an optional runnable field using the same condition as next7Sql. tg health can use doltSql("SELECT 1") or probePort. Implementer template already has circuit-breaker note; we propagate it to other rules. Transcript-schema.md was already updated; this task verifies and adds Schema status.

## Dependency graph

```
Parallel start (5 unblocked):
  ├── tg-health-ping
  ├── status-runnable
  ├── circuit-breaker-templates
  ├── canonical-tg-next-templates
  └── transcript-schema-verify

Parallel (independent):
  └── auto-json-non-tty
```

All tasks are independent; no blockedBy. auto-json-non-tty can run in parallel with the first five.

## Proposed changes

- **tg health:** New command in src/cli/health.ts; SELECT 1 via doltSql or probePort; exit 0/1 with clear message. No migrations.
- **status --runnable:** StatusOptions.runnable; TaskRow.runnable optional; SQL in fetchTasksTableData adds runnable expression (same predicate as next7Sql). Table and JSON formatters emit runnable when set.
- **Circuit breaker:** One paragraph in a central rule; one-line reference in session-start, subagent-dispatch, tg-usage.
- **Canonical next:** Single form `pnpm tg next --plan "<Plan>" --json --limit 20` everywhere; grep and replace in .cursor.
- **Transcript-schema:** Verify "Current reality" and "Text-mining fallback"; add "Schema status" and CLI stream-json note.
- **Auto-JSON:** In status/next/context handlers, if !stdout.isTTY and no explicit --json/--no-json, default to json output.

## Open questions

- None; analyst and report are aligned. Stale cache for offline mode is deferred to a future plan (medium effort).

## Original prompt

<original_prompt>
/plan based on reports/26-03-03_evolve-cli-transcript-analysis.md and docs/transcript-schema.md to develop a plan of improvement. Send off a 'fast' sub agent to research online as well.
</original_prompt>
