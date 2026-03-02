---
name: Report Follow-up Integration Tests done-force Stash
overview: "Address three recommendations from the Initiative-Project-Task Hierarchy execution report (integration test DB and migrations, tg done --force silent failure, stash conflict in agent-contract)."
fileTree: |
  __tests__/integration/
  ├── global-setup.ts
  └── test-utils.ts
  src/cli/
  └── done.ts
  docs/
  ├── testing.md
  └── agent-contract.md
  scripts/
  └── cheap-gate.sh
risks:
  - description: Broad try/catch in done.ts could hide programming errors
    severity: low
    mitigation: Catch only around known throwing calls (realpathSync, path resolution); convert to AppError and push to results
  - description: gate:full or other entry points might not run global-setup
    severity: medium
    mitigation: Explicitly verify and document which scripts run global-setup; add or fix wiring so integration tests always get a migrated template
tests:
  - "Integration test entry points run global-setup before __tests__ (assigned to task 1)"
  - "tg done with invalid worktree path reports error to results and stderr (assigned to task 2)"
todos:
  - id: integration-test-migrations
    content: "Decide and document integration test DB and migrations; ensure global-setup runs before integration tests"
    agent: implementer
    intent: |
      Implement recommendation 1 from reports/initiative-project-task-hierarchy-execution-2026-03-02.md.
      Decision: Integration tests get project/initiative schema by running migrations in setup. Golden template is built in global-setup with applyMigrations + ensureMigrations; setupIntegrationTest() runs ensureMigrations on the per-test copy; CLI calls use TG_SKIP_MIGRATE so the CLI does not run migrations again. Document in docs/testing.md that (1) any entry point that runs integration tests MUST run global-setup first so the golden template is current, and (2) TG_SKIP_MIGRATE means "CLI skips migrations because test setup already ran them." Verify scripts/cheap-gate.sh and package.json test:integration (and gate:full path) always invoke global-setup before running __tests__. Add or fix wiring if needed. Domain docs/testing.md, docs/infra.md.
    suggestedChanges: |
      docs/testing.md: add section "Integration test DB and migrations" with the contract above; list which scripts must run global-setup.
      scripts/cheap-gate.sh and package.json: confirm integration test commands run global-setup (e.g. bun test __tests__ with preload or test script that runs setup).
    changeType: modify
    docs: [testing.md, infra.md]
  - id: done-force-error-path
    content: "Fix silent exit for tg done --force when task has worktree; push errors to results and log"
    agent: implementer
    intent: |
      Implement recommendation 2 from the report. In src/cli/done.ts the worktree/branch block uses fs.realpathSync(path.resolve(worktrunkRepoRoot)) and similar sync path logic with no try/catch. If the worktree path is missing or invalid, that throws and the process exits with code 1 without pushing to results or stderr. Wrap the worktree/branch block (or at least realpathSync and any other throwing path logic) in try/catch; map thrown errors to AppError (e.g. UNKNOWN_ERROR or a new code for worktree path invalid); push { id: taskId, error: message } and set anyFailed = true. Optionally add a narrow try/catch around the per-task loop body so any unexpected throw is turned into a result entry and logged. Ensure every exit(1) path goes through the final result-printing loop so the user always sees an error message. Domain docs/error-handling.md, docs/agent-field-guide.md (worktree workflow).
    suggestedChanges: |
      done.ts: around the block that uses worktrunkRepoRoot and realpathSync, add try/catch; on catch push to results with taskId and error message, set anyFailed = true; do not rethrow. Ensure the final "if (anyFailed)" block is the only place that calls process.exit(1) after printing.
    changeType: modify
    docs: [error-handling.md]
  - id: stash-agent-contract
    content: "Resolve stash conflict in docs/agent-contract.md and drop stash"
    agent: implementer
    intent: |
      Implement recommendation 3. git stash pop left conflict markers in docs/agent-contract.md (lines 60-92 per analyst). Remove conflict markers; keep the "Stashed changes" content (Execution loop reference and rules for tg done from repo root, gate:full from plan worktree, WORKTREE_PATH). Verify the file is coherent and matches AGENT.md where relevant. Then run git stash drop to clear the stash. Domain docs/agent-contract.md.
    suggestedChanges: |
      docs/agent-contract.md: delete <<<<<<< Updated upstream, =======, >>>>>>> Stashed changes; keep the Stashed changes side (Execution loop and rules). Then git stash drop.
    changeType: modify
    docs: [agent-contract.md]
isProject: false
---

## Analysis

The plan addresses the three recommendations from `reports/initiative-project-task-hierarchy-execution-2026-03-02.md`. The planner-analyst confirmed that (1) the intended design is already "migrations in setup" — golden template is built with migrations in global-setup, and setupIntegrationTest runs ensureMigrations on the copy; the failure mode is tests running without global-setup or with an outdated template. The fix is to document the contract and ensure gate:full and any integration-test entry point run global-setup first. (2) Silent exit in `tg done --force` for worktree tasks is caused by uncaught throws (e.g. `fs.realpathSync`) in the worktree block in done.ts; fix by capturing those errors and pushing to results. (3) Stash conflict is a straightforward edit and stash drop.

Dependency minimization: all three tasks are independent and can run in parallel.

## Dependency graph

```
Parallel start (3 unblocked):
  ├── integration-test-migrations
  ├── done-force-error-path
  └── stash-agent-contract
```

No downstream tasks; each deliverable is self-contained.

## Proposed changes

- **Task 1:** Add a "Integration test DB and migrations" section to docs/testing.md stating that entry points that run integration tests must run global-setup first and that TG_SKIP_MIGRATE means the CLI skips migrations because setup already ran them. Audit scripts/cheap-gate.sh and package.json (test:integration, gate:full) to ensure they run global-setup before `bun test __tests__`; fix if not.
- **Task 2:** In done.ts, wrap the worktree/branch block (or the synchronous path-resolution calls within it) in try/catch; on throw, push `{ id: taskId, error: message }` to results, set anyFailed = true; ensure process.exit(1) is only called from the final block after printing errors.
- **Task 3:** Edit docs/agent-contract.md to remove conflict markers and keep the stashed "Execution loop" and rules; run `git stash drop`.

## Open questions

None. Decision for task 1 is made in the intent (always run global-setup before integration tests; document the contract).

## Original prompt

<original_prompt>
/plan @reports/initiative-project-task-hierarchy-execution-2026-03-02.md

Create a plan that addresses the report's three recommendations:

1. Integration test DB and migrations (how tests get project/initiative schema; document in docs/testing.md).
2. tg done --force with worktree (debug silent failure; add error path to results and log).
3. Stash conflict in docs/agent-contract.md (resolve and drop stash).
   </original_prompt>
