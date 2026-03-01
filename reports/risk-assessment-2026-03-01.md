# Risk Assessment Report

**Date:** 2026-03-01  
**Scope:** All active/proposed work based on this session's findings:

1. **Integration Test Isolation Fixes** — The 9 recommended fixes from the investigator's report (`reports/review-integration-test-isolation-2026-03-01.md`). Not yet a plan; proposed changes.
2. **Integration Test Harness Improvements** — Plan `5555005d` (done). Executed today: gate setup/teardown, pilot runTgCli reduction, docs update. Gate:full failed (pre-existing integration test failures).
3. **Standardize Skills as Agentic Leads** — Plan `78881d03` (draft). Restructures `.cursor/skills/` to standard anatomy, creates lead docs, deletes duplicates.

---

## Summary

| Plan / Scope                                | Entropy | Surface Area | Backwards Compat | Reversibility        | Complexity Concentration | Testing Surface | Performance Risk | Blast Radius | Overall         |
| ------------------------------------------- | ------- | ------------ | ---------------- | -------------------- | ------------------------ | --------------- | ---------------- | ------------ | --------------- |
| Integration Test Isolation Fixes (proposed) | Medium  | Medium       | Low              | High (easy rollback) | **High**                 | **High**        | Medium           | Medium       | **Medium-High** |
| Integration Test Harness (done)             | Low     | Low          | Low              | High                 | Low                      | Medium          | Low              | Low          | **Low**         |
| Standardize Skills (draft)                  | Medium  | Low          | Low              | High                 | Low                      | Low             | Low              | Low          | **Low**         |

---

## Per-Scope Analysis

### 1. Integration Test Isolation Fixes (proposed, not yet a plan)

These are the 9 recommendations from the investigator's report. They range from trivial (clean eventsData) to structural (skip ensureMigrations, batch SQL, cap concurrency).

| Metric                       | Rating   | Rationale                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Entropy**                  | Medium   | Touches `bunfig.toml`, `src/db/migrate.ts`, `src/cli/index.ts`, `__tests__/integration/test-utils.ts`, `package.json`, and 3-5 individual test files. Spread across test infra, CLI core, and DB layer.                                                                                                                             |
| **Surface Area**             | Medium   | `ensureMigrations` is called by every CLI command (preAction hook). Changes to it or its skip-flag affect every `tg` invocation. `bunfig.toml` affects all test runs.                                                                                                                                                               |
| **Backwards Compat**         | Low      | All changes are additive or internal. `TG_SKIP_MIGRATE` is opt-in; migration batching is a refactor with identical behavior; concurrency cap is config-only. No external API changes.                                                                                                                                               |
| **Reversibility**            | High     | Every change is easily reverted: env flags removed, `bunfig.toml` restored, migration functions restored. No data migrations or schema changes.                                                                                                                                                                                     |
| **Complexity Concentration** | **High** | `src/db/migrate.ts` and `src/cli/index.ts` are both critical-path files. `migrate.ts` is called on every CLI invocation and during test setup. Batching 9 migration checks into one SQL query is a meaningful refactor of a fragile chain. If the batched query misses a case, migrations silently don't run.                       |
| **Testing Surface**          | **High** | Ironic: the changes that fix test infrastructure are themselves hard to test. There's no test for "ensureMigrations spawns fewer processes." Validation is empirical: run gate:full and observe. The `TG_SKIP_MIGRATE` flag bypasses safety checks — if used outside tests (e.g. accidentally in production), migrations won't run. |
| **Performance Risk**         | Medium   | The entire purpose is performance improvement. Positive risk: if changes work, integration suite drops from >180s to <60s. Negative risk: if migration skip flag leaks or batched query is wrong, users hit stale schema.                                                                                                           |
| **Blast Radius**             | Medium   | Failure in `ensureMigrations` affects every CLI command. Failure in `bunfig.toml` affects test suite (but not production). Cleaning `~/.dolt/eventsData/` is machine-local, no blast.                                                                                                                                               |

### 2. Integration Test Harness Improvements (done plan)

Already executed. Gate setup/teardown, pilot runTgCli→doltSql, docs update.

| Metric                       | Rating | Rationale                                                                                                                                       |
| ---------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Entropy**                  | Low    | 4 files: `cheap-gate.sh`, `package.json`, one test file, `docs/testing.md`. Well-scoped.                                                        |
| **Surface Area**             | Low    | Scripts and docs. No production code.                                                                                                           |
| **Backwards Compat**         | Low    | Additive: new teardown script, conditional setup in gate.                                                                                       |
| **Reversibility**            | High   | Revert the script changes, remove teardown script.                                                                                              |
| **Complexity Concentration** | Low    | No critical-path code modified.                                                                                                                 |
| **Testing Surface**          | Medium | The gate:full task ran and failed — but failures are pre-existing (plan-completion, query.test mocks, etc.), not caused by this plan's changes. |
| **Performance Risk**         | Low    | No perf-critical changes.                                                                                                                       |
| **Blast Radius**             | Low    | Only affects test infrastructure.                                                                                                               |

### 3. Standardize Skills as Agentic Leads (draft)

Restructures `.cursor/skills/` SKILL.md files and creates `docs/leads/` entries. No code changes.

| Metric                       | Rating | Rationale                                                                                                                    |
| ---------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **Entropy**                  | Medium | 10+ SKILL.md files touched, 4+ lead docs created, 2 dirs deleted. Many files but all in `.cursor/skills/` and `docs/leads/`. |
| **Surface Area**             | Low    | Skills and docs are consumed by the AI agent, not by runtime code. No API surface.                                           |
| **Backwards Compat**         | Low    | Preserves all existing workflow content within new structure. Deletions are duplicates (risk/ is a copy of assess-risk/).    |
| **Reversibility**            | High   | Git revert restores all files. No data changes.                                                                              |
| **Complexity Concentration** | Low    | Each file is independent. No file overlap between tasks.                                                                     |
| **Testing Surface**          | Low    | No code to test. Validation is structural (check sections exist).                                                            |
| **Performance Risk**         | Low    | No runtime impact.                                                                                                           |
| **Blast Radius**             | Low    | Only affects AI agent behavior.                                                                                              |

---

## Cross-Plan Interactions

- **File overlaps**: The harness plan (done) and the proposed isolation fixes both touch `bunfig.toml`, `__tests__/integration/test-utils.ts`, and `scripts/cheap-gate.sh`. The harness changes are already committed; the isolation fixes would build on top. No conflict if done sequentially.
- **Domain cluster**: Both the harness plan and isolation fixes are in the `testing` domain. The isolation fixes should be a follow-up plan that assumes the harness changes are in place (they are).
- **Skills plan**: No file overlap with testing work. Fully independent. Can run in any order.
- **Impact on Complexity Concentration**: The isolation fixes modify `src/db/migrate.ts` (ensureMigrations batching + caching) and `src/cli/index.ts` (skip-migrate flag). These are production-path files that no other active plan touches. Concentration risk is contained to that one scope.

---

## Overall Risk

**Medium.** The done harness plan and the skills plan are both low risk. The proposed isolation fixes carry **medium-high risk** because they touch critical-path production code (`migrate.ts`, `cli/index.ts`) and their "testing surface" is itself the test infrastructure — a circular dependency that makes validation harder. However, all changes are highly reversible (env flags, config, refactors with no schema changes), which brings overall risk down.

The main risk driver is **Complexity Concentration in `ensureMigrations`**: batching 9 migration checks into one SQL query is correct in principle but is easy to get subtly wrong (a missed column check means a migration doesn't fire for a fresh repo). The **TG_SKIP_MIGRATE flag** is safe if scoped to tests but dangerous if it leaks into production usage.

---

## Mitigation Strategies

| Risk                                     | Mitigation                                                                                                                                                                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TG_SKIP_MIGRATE leaks to production**  | Only set in `runTgCli` env within test-utils.ts. Add a log warning in the CLI preAction: `if (process.env.TG_SKIP_MIGRATE) console.warn("[tg] Skipping migrations (TG_SKIP_MIGRATE set)")` so it's visible. Document in testing.md that this flag is test-only. |
| **Batched migration SQL misses a check** | Write unit test: seed a Dolt repo with partial migrations (missing one column), run `ensureMigrations`, verify the column is added. This validates the batched query detects gaps correctly.                                                                    |
| **Concurrency cap too aggressive**       | Start with removing integration from `concurrentTestGlob` (sequential). Measure. If total time is acceptable (<90s), keep it. If too slow, re-add with `--concurrency 4`.                                                                                       |
| **eventsData cleanup is machine-local**  | Add `rm -rf ~/.dolt/eventsData/*` to global-setup or document as a manual step. Set `DOLT_ROOT_PATH` per test run so it doesn't accumulate again.                                                                                                               |
| **Harness plan gate:full failed**        | Failures are pre-existing (plan-completion.test.ts, query.test.ts mocks). Create a separate "fix failing tests" plan to address those. Do not conflate with isolation fixes.                                                                                    |

---

## Key Risks to Monitor

1. **`TG_SKIP_MIGRATE` scope creep** — Monitor that it stays in test env only. If it appears in CI scripts or user docs without the "test-only" qualifier, flag immediately.
2. **Batched `ensureMigrations` correctness** — After implementing, run against a fresh `dolt init` repo (no golden template) to confirm all 9 migrations still apply correctly.
3. **Integration test timing after fixes** — Measure wall-clock time before and after. Target: full integration suite in <60s (down from >180s). If still >90s, investigate remaining bottlenecks.
4. **`~/.dolt/eventsData/` re-accumulation** — If `DOLT_ROOT_PATH` per-run is not implemented, eventsData will re-grow. Add a periodic cleanup or cron, or set `DOLT_ROOT_PATH` in global-setup.
5. **Pre-existing test failures** — The gate:full failure (plan-completion, query.test mocks, etc.) must be addressed separately. These failures predate all changes in this session and will continue to cause false negatives in gate runs.

---

## Prioritized Risk Summary and Recommended Execution Order

1. **Standardize Skills (draft)** — Execute first or in parallel with anything. Zero risk, no code changes, no overlap. Gets it out of the way.

2. **Clean `~/.dolt/eventsData/` + set `DOLT_ROOT_PATH`** — Execute next. Immediate, high-impact, zero-code-risk fix. Just env config and a directory cleanup. Reduces I/O contention for all subsequent work.

3. **Limit file-level concurrency** (remove integration from `concurrentTestGlob`) — Execute next. One-line config change in `bunfig.toml`. Eliminates the primary cause of flakiness. Low risk.

4. **Add `TG_SKIP_MIGRATE` env flag** — Execute after concurrency cap. Modifies `src/cli/index.ts` (preAction) and `__tests__/integration/test-utils.ts`. Medium risk (production-path code); mitigate with warning log and test-only documentation.

5. **Batch SQL in `ensureMigrations`** — Execute after skip-migrate. Modifies `src/db/migrate.ts`. Highest complexity-concentration risk. Requires a unit test against a fresh repo to validate correctness.

6. **Remaining test file consolidation** (plan-completion beforeEach→beforeAll, status-live consolidation, more `--no-commit`) — Execute last. Low risk per change but many files; benefits compound with the concurrency and process-count reductions above.

7. **Fix pre-existing test failures** (query.test mocks, plan-completion) — Separate plan. Not part of the isolation work but required for gate:full to pass clean.
