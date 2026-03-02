# Agent utility belt

Shared learnings for all agent personas and sub-agents. When building prompts or dispatching implementers, reviewers, fixers, investigators, or other sub-agents, ensure they have access to this doc (e.g. inject as `{{LEARNINGS}}` or instruct them to read it). Skills that invoke agents should reference it.

---

## Parallel sub-agent dispatch

- **Default: batch-in-one-turn.** When dispatching N sub-agents that do not share mutable state, emit **all N Task or mcp_task invocations in the same response turn**. Cursor runs them in parallel and surfaces the orchestration UI. Do not dispatch one per turn; that prevents parallel execution. See `.cursor/rules/subagent-dispatch.mdc` (TodoWrite protocol, Pattern 1).
- **When sub-agents share one resource (e.g. git repo):** Parallelism requires **isolated context per agent**. Otherwise one agent’s `git checkout` (or similar) overwrites another’s view and commits land on the wrong branch or "no changes" appear.
  - **Git:** Use **one worktree per agent** (e.g. `git worktree add <path> <branch>`). Give each sub-agent its own `{{WORKTREE_PATH}}`; they run all git commands in that path. After all complete, merge branches from the main repo and remove worktrees. Learned from commit-messages: branch-per-group with a **shared** working tree caused checkouts to conflict; worktrees fix it.
  - **Worktree setup:** Do **not** run `pnpm install`, `pnpm build`, or `pnpm typecheck` in the worktree unless the task explicitly added or changed a dependency. Otherwise never run them; the worktree already has deps and build from the branch it was created from.
  - **Other shared resources:** Same principle: give each parallel agent a distinct working directory, branch, or scope so they don’t overwrite each other.
- **When parallel isn’t possible:** If agents must share one mutable context (e.g. single branch, single DB state), dispatch **sequentially** (one at a time, wait for completion, then next). Document the constraint in the skill (e.g. "Sequential only: reason").
- **Skills that batch-dispatch:** work (implementers), review (reviewers), review-tests (scanners), audit-performance (scanners), commit-messages (committers). Each should either (a) ensure agents have isolated context (worktrees, tg worktrees, read-only), or (b) explicitly document sequential dispatch and why.

---

## Hive coordination

- **Context ping as impetus:** When you need to sync with other active agents, run `tg context --hive --json` (when available) to get a HiveSnapshot of all doing tasks (agents, phases, files in progress, recent notes). That call is the driver for coordination.
- **Bi-directional check:** (1) **Read the group** — consume the snapshot. (2) **Reflect on self** — is there anything in that context I should consider for my task? (3) **Reflect and give back** — given my local context, is there anything on _other_ tasks that should be updated? If yes, use `tg note <otherTaskId> --msg "..."` so the hive (and future context pings) see it.
- **Experiment and share:** There is no single mandated procedure. Try different timings (e.g. ping at start, before pre-done) and different rules for when to note on other tasks (e.g. same file touched, same domain). When something works, **append a short learning to this section** so other agents can adopt it. Example: _"[YYYY-MM-DD] Noting on sibling task when we touch the same file reduced duplicate work; pattern: if hive shows task B editing F and I'm editing F, tg note <B> --msg 'Also editing F; see my approach in commit X'."_

---

## Breadcrumbs

Path-scoped, committed clues in `.breadcrumbs.json`. Different from `tg note` (task-scoped) — breadcrumbs survive task closure and sessions.

**Before editing files:** Read `.breadcrumbs.json` (small file, parse it), filter entries whose `path` matches or is a prefix of the files you are about to edit. Factor any relevant entries into your approach.

**After a non-obvious fix, intentional workaround, security-critical pattern, or "this looks wrong but is intentional" code:** Add an entry to `.breadcrumbs.json` for that path. Use severity `"warn"` for things that must not be changed; `"info"` for context that is helpful but not safety-critical.

Entry format:
```json
{
  "id": "b_a1b2c3",
  "path": "src/db/query.ts",
  "message": "Short clue for future agents",
  "severity": "info",
  "added_by": { "agent_id": "implementer" },
  "added_at": "2026-03-02T10:00:00Z",
  "promoted": false
}
```
Use `b_` + 6 hex chars for the id (e.g. first 6 chars of `Date.now().toString(16)`).

**If a breadcrumb was critical to your decision:** Promote it — copy the message as a code comment at the relevant lines, then set `promoted: true` in the entry (or remove it). The comment is the durable form.

**Do not create breadcrumbs for obvious, well-documented, or already-commented code.** Signal-to-noise matters.

See `docs/breadcrumbs.md` for full format and guidance.

---

## Result / error handling

- **[2026-03-01]** Empty early-return inside a `.andThen()` chain — do not use `Promise.resolve({ isOk: () => true, value: [] }) as unknown as ResultAsync<T, E>`; that bypasses neverthrow's interface and will not chain. Use `okAsync(value)` (or `okAsync([])`) for trivially-known early returns inside `ResultAsync` chains.
- **[2026-03-01]** `Result.map()` / `ResultAsync.map()` used with a void callback (side-effects only, no return) — this is a forEach misuse and triggers biome `lint/suspicious/useIterableCallbackReturn`. At a boundary where you only want to act on success, use `.isOk()` + direct property access: `if (r.isOk() && r.value.length > 0) { ... }`. Only use `.map()` when transforming the inner value.
- **[2026-03-01]** `ResultAsync.fromPromise` error mapper written as `(e) => e as AppError` — unsafe cast; runtime exceptions are silently miscast. Instead: `(e) => buildError(ErrorCode.UNKNOWN_ERROR, e instanceof Error ? e.message : String(e), e)`.
- **[2026-03-01]** In `ResultAsync.fromPromise` and catch blocks, do not use `(e as Error).message` — non-Error rejections can throw. Use `e instanceof Error ? e.message : String(e)` for the message and pass the rejection as the third argument to `buildError`.
- **[2026-03-01]** When building `AppError` from script or subprocess output (e.g. `out.error`), pass the raw output or parsed object as the third argument (cause) to `buildError` so logs and tools can inspect it.
- **[2026-03-01]** Async IIFE + `throw result.error` inside `ResultAsync.fromPromise((async () => {})(), ...)` — hybrid paradigm that tempts the unsafe error mapper. Prefer `.andThen()` chains; only use the IIFE when sequential logic is genuinely too complex to chain.

## SQL / DB

- **[2026-03-01]** Batch CLI multi-ID pattern: use `parseIdList(ids)` from `src/cli/utils.ts`, resolve config explicitly before the loop, accumulate per-ID results into `{ id, status } | { id, error }` array, set `anyFailed` flag and `process.exit(1)` after reporting all. Do NOT nest a `for` loop inside `asyncAndThen` — partial-failure accumulation is impossible inside a monadic chain.
- **[2026-03-01]** 2+ independent queries should not be nested `.andThen()` chains — that runs them serially. Use `ResultAsync.combine([q.raw(sql1), q.raw(sql2)])` for parallel execution. Nested `.andThen()` is correct only when one query depends on the previous result.
- **[2026-03-01]** Dolt does NOT auto-create secondary indexes for FK declarations (unlike MySQL InnoDB). Every FK column and every high-frequency filter column (WHERE, JOIN subquery) needs an explicit `CREATE INDEX idx_<table>_<col>` in the same migration.
- **[2026-03-01]** `ensureMigrations` probes spawn a dolt subprocess each. When adding a migration, batch `tableExists`/`columnExists`/`viewExists` checks into as few probes as possible. Every new probe adds to every CLI command cold-start.
- **[2026-03-01]** `execa dolt` without `DOLT_DISABLE_UPDATE_CHECK: "1"` makes a ~16s blocking network call on every invocation to check for updates — this causes `tg status`, `tg done`, and every other CLI command to appear to hang. Always include `DOLT_DISABLE_UPDATE_CHECK: "1"` in the `env` object for every `execa dolt` call, alongside `DOLT_READ_ONLY: "false"`. (Fixed in connection.ts, branch.ts, commit.ts, sync.ts on 2026-03-01.)
- **[2026-03-01]** Migration calling `doltCommit` unconditionally creates spurious empty Dolt commits on idempotent re-runs. Guard: `let changed = false; if (!exists) { runDDL(); changed = true; } if (changed) { doltCommit(...); }`.
- **[2026-03-01]** `dolt sql-server` spawned with `stdio: "ignore"` — startup panics invisible; only signal was "did not become ready after 50 attempts". Add an `"exit"` event listener in the polling loop: if `child.exitCode !== null`, throw immediately. Prefer `stdio: "pipe"` in test infra setup.

## Refactoring / scope discipline

- **[2026-03-02]** Rename-triggered collateral deletion: during a terminology-rename task touching a large file, implementers can silently delete functions that contain none of the renamed identifiers. Before committing any file modified during a rename, verify that every deleted function or constant contained the renamed identifier or was explicitly listed in the task's stated change list — if a deletion cannot be traced to either, revert it.
- **[2026-03-02]** Misleading "legacy" comment as deletion invitation: a JSDoc comment `/** legacy; prefer X */` on function A means A is the candidate for removal — not X. Never delete the function that a "legacy" comment explicitly names as preferred; delete the function that carries the "legacy" label.
- **[2026-03-02]** "Clean while you're here" helper and type deletion: do not remove supporting types, helper functions, or constants from a file unless the task intent explicitly states their removal or their removal is forced by a type error that was itself caused by the stated task change. When in doubt, leave them in place and note the potential cleanup for the orchestrator via `tg note`.
- **[2026-03-02]** Squash commit scope verification: before calling `tg done` on a task that squashes multiple sub-commits, run `git diff HEAD~1 --stat` and verify every changed file maps to a stated todo item; flag and revert any deletion that cannot be mapped to the task's intent.

## CLI conventions

- **[2026-03-01]** CLI command renames must be immediately followed by a grep sweep of `.cursor/agents/*.md` and `.cursor/rules/*.mdc` for stale references. Treat a CLI rename the same as a public API rename.
- **[2026-03-02]** Visual regression with no type-system protection: functions in `src/cli/status.ts` and `src/cli/tui/boxen.ts` that render styled dashboard output (borders, colour grids, section titles) are called only internally — removing them causes zero TypeScript errors but destroys the dashboard UI. Before committing changes to these files, grep for every function in the "Key styling functions (do not remove)" table in `docs/cli-tables.md` and confirm each is still present and called.
- **[2026-03-02]** Rendering regression detection: when modifying any formatting or rendering function in `status.ts`, verify `__tests__/cli/dashboard-format.test.ts` asserts the modified function's structural output (section titles, Stats heading, box chars); if not, add the assertion in the same commit.
- **[2026-03-01]** New CLI flags on `tg done`/`tg start` won't be used by agents until they appear in agent templates. When new flags are added to task-graph CLI commands, update all agent templates that call those commands immediately.
- **[2026-03-01]** Extract domain-style logic (e.g. group-by agent, sort, latest-per-key) from command handlers into pure functions; keep handlers to config read, call pure fn, then format/output. Do not put large aggregation blocks inside `.match()` callbacks.
- **[2026-03-01]** When multiple subcommands share the same sequence (readConfig → isErr exit → path resolution → operation → .match err handling), deduplicate via a shared helper (e.g. `withConfig(cmd, fn)`) so each action only supplies the operation.
- **[2026-03-01]** Double `readConfig()` in one action handler — when a pre-step (e.g. auto-recovery) also needs config, extract it once: `const config = readConfig(); if (config.isOk()) { preStep(config.value); }` then thread `config.asyncAndThen(...)` into the main chain. Do not call `readConfig()` a second time for the main query.

## Test infrastructure

- **[2026-03-01]** Sending SIGTERM to the bare PID of a `detached: true` process leaves children alive. Kill the entire process group: `process.kill(-pid, "SIGTERM")`. Add SIGKILL fallback after ~200 ms.
- **[2026-03-01]** Post-spawn setup steps (migrations, env vars, port reservation) without try/finally can orphan server processes. Enter a try block immediately after receiving the PID; kill the process group in the `finally`/`catch` before re-throwing.
- **[2026-03-01]** Spawned server PIDs stored only in-memory are lost on force-kill. Write PID to file immediately after spawn; teardown reads and cleans up that file, not just the JS variable.
- **[2026-03-01]** Test suites starting external processes need OS-level leak assertions: `pgrep -c dolt` before and after the full suite. 80 orphaned dolt processes accumulated with no reporter signal.
- **[2026-03-01]** `process.env.VAR = value` in `beforeAll`/`beforeEach` without matching `delete process.env.VAR` in teardown — Bun runs files in the same process; stale env vars leaked between test files and caused `ECONNREFUSED`.
- **[2026-03-01]** `gate:full` run on a plan branch without a baseline on `main` — ~80% of failures were pre-existing, wasting investigator cycles. Cross-check against base branch first or note "pre-existing" in evidence for failures in unchanged code.

## Types

- **[2026-03-01]** Script/output interfaces that represent a fixed JSON contract (e.g. query script stdout) should list only the known optional fields; avoid `[key: string]: unknown` if the shape is fixed so the type documents the contract.

## Worktree / execution

- **[2026-03-01]** `tg start --force` attempted when an aborted sub-agent's task branch already existed — failed with "Worktrunk worktree create failed". `--force` overrides the claim check but not branch creation. When a sub-agent is aborted and a live worktree exists: `tg worktree list --json`, find the entry, `cd` to its `path`, continue directly without re-running `tg start`.
- **[2026-03-01]** Env-var activation function set only one of two required vars. `getServerPool()` guards on both `TG_DOLT_SERVER_PORT` and `TG_DOLT_SERVER_DATABASE`; setting only one returns `null` silently. Before writing an env-var activation function, read the consumer's entry guard to enumerate every required var; set them all atomically.
