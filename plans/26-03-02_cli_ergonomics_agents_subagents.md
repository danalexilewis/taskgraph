---
name: CLI Ergonomics for Agents and Subagents
overview: Implement high-impact CLI ergonomics from the research report so agents and subagents need fewer round-trips and have a single documented entrypoint; worktree_path in start --json, Agent CLI entrypoint in AGENT.md, standardized JSON error envelope.
fileTree: |
  AGENT.md                    (modify)
  docs/
  ├── cli-reference.md        (modify)
  ├── agent-field-guide.md    (modify)
  src/cli/
  ├── start.ts                (modify)
  ├── utils.ts                (modify - or new error-json helper)
  __tests__/
  └── integration/
      └── start-worktree-json.test.ts  (create or extend)
risks:
  - description: Start JSON shape change could break parsers that assume only id/status
    severity: low
    mitigation: Additive fields (worktree_path, plan_branch, plan_worktree_path); existing consumers that ignore unknown keys keep working.
  - description: Standardized error envelope rollout might miss some CLI commands
    severity: low
    mitigation: Grep for status "error" and JSON.stringify error paths; use one helper so all commands emit the same shape.
tests:
  - "tg start <id> --agent A --worktree --json returns worktree_path (and plan fields when applicable)"
  - "All CLI commands that support --json emit the same error envelope on failure (status, code, message, optional retryable)"
todos:
  - id: agent-cli-entrypoint
    content: Document Agent CLI entrypoint subsection in AGENT.md
    agent: documenter
    changeType: modify
    intent: |
      Add a short subsection (e.g. under "Agent operating loop" or near "Multi-agent awareness") titled "Agent CLI entrypoint" that lists the exact agent-facing commands in one place:
      - Get runnable tasks: tg next --plan "<Plan>" --json --limit 20
      - Per-task context: tg context <taskId> --json
      - Start with worktree: tg start <taskId> --agent <name> --worktree (then cd to worktree_path from start --json or tg worktree list --json)
      - Complete: tg done <taskId> --evidence "..." from the worktree directory
      - Use short task ids (tg-XXXXXX) where supported
      Optionally add one line: "For hive sync use tg context --hive --json (when implemented; see plans/26-03-02_hive_context.md)." so the entrypoint stays accurate when hive ships.
      Single place to update when CLI renames happen. Do not duplicate long prose; keep it a scannable list.
    docs: [agent-contract, agent-strategy]

  - id: start-json-worktree-path
    content: Return worktree_path in tg start --worktree --json output
    agent: implementer
    changeType: modify
    intent: |
      When tg start is run with --worktree and --json, the CLI currently returns only [{"id":"...","status":"doing"}]. The worktree path (and when applicable plan_branch, plan_worktree_path) is already stored in the started event body but not in the CLI response.
      In src/cli/start.ts: extend the success type from startOne() to include optional worktree_path, plan_branch, plan_worktree_path. In the success path where the started event is written, these values already exist (worktreeInfo, plan_branch, plan_worktree_path); thread them into the returned object. In the start command action, when --json and success, include these fields in each result item when present (so implementers get the path in one round-trip).
      Update docs/cli-reference.md (tg start) to document the new JSON fields for the --worktree case. Add or extend an integration test that runs tg start <id> --agent A --worktree --json and asserts the response includes worktree_path (and optionally plan_branch / plan_worktree_path when a plan worktree exists).
      Follow docs/agent-field-guide.md CLI checklist and use query(repoPath) / no direct doltSql in CLI.
    docs: [cli-reference, schema]

  - id: standardize-error-envelope
    content: Standardize JSON error envelope for all CLI commands and document it
    agent: implementer
    changeType: modify
    intent: |
      When --json is used and an error occurs, use a single shape everywhere: { status: "error", code: string, message: string, retryable?: boolean }. Optionally include cause for debugging. Today context and agent-context omit code; next and others include code and cause.
      Add a small helper (e.g. in src/cli/utils.ts or new src/cli/error-json.ts) that takes AppError and optional retryable and returns this object. Grep src/cli for JSON.stringify with status "error" or similar and replace error branches to use the helper so every command that supports --json emits the same envelope on failure.
      Document the envelope in docs/cli-reference.md (e.g. under "Global options" or "JSON output") and in docs/agent-field-guide.md (Output Conventions / error JSON). Do not change AppError type; only the JSON output shape.
    docs: [cli-reference, error-handling, agent-field-guide]

  - id: add-tests-cli-ergonomics
    content: Add tests for start worktree JSON and error envelope
    agent: implementer
    changeType: test
    blockedBy: [start-json-worktree-path, standardize-error-envelope]
    intent: |
      Add or extend integration tests: (1) tg start <id> --worktree --json returns worktree_path (and plan fields when applicable). (2) Sample 2–3 CLI commands that support --json and assert on error they emit the standardized envelope (status, code, message). Prefer existing integration test patterns (describe.serial, shared Dolt context). See docs/testing.md and __tests__/integration/ patterns.
    docs: [testing]

  - id: run-full-suite-cli-ergonomics
    content: Run full test suite (pnpm gate:full) and record result in evidence
    agent: implementer
    changeType: test
    blockedBy: [add-tests-cli-ergonomics]
    intent: |
      Run pnpm gate:full from the plan worktree (or repo root if no worktree). Record the result in tg done evidence as "gate:full passed" or "gate:full failed: <summary>". If failed, add tg note with raw output and do not mark done until fixed or escalated.
    docs: [agent-contract]
---

# CLI Ergonomics for Agents and Subagents

## Analysis

The research report (`reports/26-03-02_cli_ergonomics_agents_subagents_research.md`) identified three high-impact, low-to-medium-effort improvements:

1. **Return worktree_path in `tg start --worktree --json`** — Implementers today run `tg start` then `tg worktree list --json` and match by branch to get their path. The path is already written to the started event body; returning it in the start response removes one round-trip.

2. **Document "Agent CLI entrypoint" in AGENT.md** — A single subsection listing the exact commands agents use (next, context, start, done, short ids) reduces backtracking and gives one place to update when the CLI is renamed.

3. **Standardize JSON error envelope** — When `--json` and an error occurs, use one shape (`status`, `code`, `message`, optional `retryable`) everywhere and document it so agents and scripts get consistent error handling.

The planner-analyst confirmed: worktree data is already available in the start flow; no schema changes. Error envelope can be introduced via a shared helper and grep-and-replace. Hive context (`tg context --hive`) is not duplicated here; it is specified in `plans/26-03-02_hive_context.md`. The Agent CLI entrypoint task can include a one-line pointer to hive so the entrypoint stays accurate when that plan ships.

## Dependency graph

```text
Parallel start (3 unblocked):
  ├── agent-cli-entrypoint   (AGENT.md subsection)
  ├── start-json-worktree-path
  └── standardize-error-envelope

After start-json-worktree-path and standardize-error-envelope:
  └── add-tests-cli-ergonomics

After add-tests-cli-ergonomics:
  └── run-full-suite-cli-ergonomics
```

## Proposed changes

- **start.ts**: Extend return type of the internal success path to include `worktree_path`, `plan_branch`, `plan_worktree_path` when a worktree was created; pass these into the action’s JSON output when `--json` and worktree was used.
- **utils.ts or error-json.ts**: New helper `formatErrorForJson(e: AppError, retryable?: boolean): object` returning `{ status: "error", code: e.code, message: e.message, retryable?, cause? }`. All CLI handlers that currently emit JSON on error use this helper.
- **AGENT.md**: New subsection "Agent CLI entrypoint" with a short bullet list of commands and optional hive line.
- **cli-reference.md**: Document start --json worktree fields; document standard error envelope for JSON output.
- **agent-field-guide.md**: In Output Conventions, document the standard error envelope and reference the Agent CLI entrypoint in AGENT.md.

## Open questions

- **retryable**: No `retryable` on `AppError` today. The envelope can add it as an optional field (e.g. derived from `ErrorCode` in the helper or left out initially). Decision: add optional `retryable` in the helper signature; callers can pass it when known (e.g. network errors); omit from envelope when not set.

## Related

- **Hive context**: `plans/26-03-02_hive_context.md` — do not duplicate; entrypoint task adds a one-line pointer.
- **Report**: `reports/26-03-02_cli_ergonomics_agents_subagents_research.md`

<original_prompt>
/plan for this — create a plan to implement the CLI ergonomics improvements from the research report (reports/26-03-02_cli_ergonomics_agents_subagents_research.md): worktree_path in tg start --json, Agent CLI entrypoint in AGENT.md, standardized JSON error envelope. Do not duplicate the hive context plan; reference it from the entrypoint.
</original_prompt>
