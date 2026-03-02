---
name: Review Recommendations Execution
overview: Execute the three review recommendations from 2026-03-02 (gate green, config extraction, blocked-task triage) to improve gate reliability, layering, and task graph actionability.
fileTree: |
  src/
  ├── config.ts                    (create)
  ├── cli/
  │   ├── index.ts                 (modify - exit race fix)
  │   └── utils.ts                 (modify - re-export config)
  └── export/
  ├── graph-data.ts                (modify - import from config)
  └── markdown.ts                  (modify - import from config)
  docs/
  └── testing.md                   (modify - document exit rule)
  reports/
  └── blocked-task-triage-*.md     (create - triage output)
risks:
  - description: Config extraction touches many import sites; one missed re-export could break build
    severity: low
    mitigation: utils.ts re-exports so all existing cli/mcp imports unchanged; only export/ switches to config
  - description: process.exitCode = 0 may behave differently in some runtimes
    severity: low
    mitigation: Standard Node behavior; document and run status-live tests in gate:full
tests:
  - "Existing status-live --json integration tests should pass after exit fix"
  - "pnpm gate:full after config extraction"
todos:
  - id: fix-exit-race
    content: "Fix CLI exit race (process.exitCode = 0) and document in docs/testing.md"
    agent: implementer
    changeType: fix
    intent: |
      In src/cli/index.ts the main entrypoint calls process.exit(0) after parseAsync and closeAllServerPools(), which can exit before stdout is flushed when output is piped (e.g. status --tasks --json). This causes the three failing status-live integration tests in gate:full.
      1. Replace the success-path process.exit(0) with process.exitCode = 0 and allow the process to exit naturally (remove the .then(() => process.exit(0)) so that after closeAllServerPools() the process just ends with exit code 0).
      2. Ensure no other success path in the same entrypoint calls process.exit(0) for the main CLI (catch can still process.exit(1)).
      3. In docs/testing.md add a short "CLI and piped output" or "Process exit" subsection documenting that we must not use process.exit(0) on the success path when stdout may be piped; use process.exitCode = 0 and natural drain instead. Reference this from agent-field-guide or memory if appropriate.
    suggestedChanges: |
      src/cli/index.ts (around line 127-132):
      - Change: .then(() => process.exit(0)) to .then(() => { process.exitCode = 0; }) or similar so the process exits naturally.
      - Keep .catch(() => process.exit(1)) for error path.
  - id: extract-config
    content: "Extract Config and readConfig to src/config.ts; re-export from cli/utils; export imports from config"
    agent: implementer
    changeType: refactor
    intent: |
      Create src/config.ts as the single source for configuration reading. Move from src/cli/utils.ts into src/config.ts: Config interface, readConfig(basePath?), writeConfig(config, basePath?), and the CONFIG_FILE / TASKGRAPH_DIR path logic needed for them. Then (1) in cli/utils.ts re-export Config, readConfig, writeConfig from '../config' so all existing cli/* and mcp/* imports remain valid. (2) In src/export/graph-data.ts and src/export/markdown.ts change the import from '../cli/utils' to '../config' for Config and readConfig only. This removes the export-depends-on-cli layering inversion and gives one place for config for future env overrides or multi-repo config.
    suggestedChanges: |
      src/config.ts: New file. Move Config interface, readConfig, writeConfig, and path constants (TASKGRAPH_DIR, CONFIG_FILE) from cli/utils.ts. Use path.join(process.cwd(), ...) or basePath for paths; keep same Result/AppError types.
      src/cli/utils.ts: Remove Config, readConfig, writeConfig, CONFIG_FILE definitions. Add: export { Config, readConfig, writeConfig } from '../config'; (and re-export any type used by init.ts for writeConfig).
      src/export/graph-data.ts: Change import { type Config, readConfig } from '../cli/utils' to import { type Config, readConfig } from '../config'.
      src/export/markdown.ts: Same change.
  - id: blocked-triage
    content: "Produce blocked-task triage report with recommended unblock/cancel actions"
    agent: implementer
    changeType: document
    intent: |
      Run tg status --tasks (and optionally --projects) to list all tasks. Filter to blocked tasks. For each blocked task, identify the blocker(s) and classify: blocker still valid, blocker can be canceled, or recommend creating an unblock task. Write a report to reports/blocked-task-triage-26-03-02.md with (1) summary counts, (2) per-blocked-task line with task id, title, project, blocker id(s), and recommendation (keep/cancel/unblock), (3) suggested next actions (tg block --unblock, tg cancel, or create human task). No changes to the task graph required; output is the report file only. Use tg status --tasks --json if available for machine-readable input.
  - id: run-full-suite
    content: "Run pnpm gate:full and record result in evidence"
    agent: implementer
    changeType: test
    blockedBy: [fix-exit-race, extract-config]
    intent: |
      From the plan worktree (or repo root if no worktree), run pnpm gate:full. Record the result in the task evidence: "gate:full passed" or "gate:full failed: <summary>". If it fails, add tg note with the failure output and do not mark done until fixed or escalated.
---
# Review Recommendations Execution

Execute the three improvements from reports/review-2026-03-02.md.

## Dependency graph

Parallel start (3 unblocked):
  ├── fix-exit-race
  ├── extract-config
  └── blocked-triage

After fix-exit-race + extract-config:
  └── run-full-suite

## Notes

- fix-exit-race and extract-config have no file overlap; can run in parallel.
- blocked-triage is report-only; does not block run-full-suite.
- run-full-suite must run after the two code changes so gate:full validates them.

<original_prompt>Execute the 3 review recommendations: (1) Make gate:full reliably green - fix CLI exit race; (2) Extract config and fix export/cli layering; (3) Blocked-task triage pass - produce report with recommended actions.</original_prompt>
