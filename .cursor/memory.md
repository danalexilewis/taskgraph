# Persistent Memory

Transient dev context. Durable knowledge belongs in `docs/`.
See `.cursor/rules/memory.mdc` for the learnings routing system.

## Active quirks

- **`status-live --json` tests (3) failing in gate:full** — `parseAsync + closeAllServerPools + process.exit(0)` in `src/cli/index.ts` may race with stdout flush when output is piped. Investigate before declaring gate green. Try `process.exitCode = 0` + natural drain instead of `process.exit(0)`.
- **`pnpm test:all` diverges from `gate:full` isolation** — `test:all` runs `bun test __tests__ --concurrent` without db/mcp isolation. mock.module bleed will return for anyone using it. Either fix or remove the script.
- **Terminal-file polling pattern** (long-running shell commands): when a shell command backgrounds, Cursor streams output to `.cursor/projects/.../terminals/<pid>.txt`. Poll with incremental sleeps + tail; stop when `exit_code:` footer appears. Full pattern in `docs/agent-field-guide.md § Shell / Long-Running Commands`. Never chain `sleep N && tail` in one shell call.
- **Orchestrator must never run `pnpm gate:full` directly on `main`** — implementers' changes live in task branches in the plan worktree. Orchestrator dispatches `run-full-suite` as a task to an implementer; that implementer runs gate:full from _inside_ the plan worktree. See docs/agent-contract.md § gate:full Orchestration Rules.
- **Verify plan branch exists before dispatching Wave 1** — after the first `tg start --worktree` for a new plan, run `tg worktree list --json` and confirm a `plan-p-XXXXXX` entry is present. If it's missing, the plan branch was not created; sub-agents' `tg done` calls will clean up the task worktrees without merging, silently destroying all commits. Symptom: task worktrees (tg-XXXXXX) appear but no matching plan-p-* worktree. Fix: investigate why `plan_worktree` row was not written, or create the plan branch manually before dispatching.
