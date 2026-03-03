---
name: Dashboard Improvements
overview: Improve dashboard reliability and UX with refresh backpressure, clearer error display, complete cache invalidation on writes, project cleanup on load (auto-complete plans with all tasks done), and documentation for Dolt loading strategy.
fileTree: |
  src/
  ├── domain/
  │   └── plan-completion.ts    (modify - completeAllPlansThatAreDone; done)
  ├── cli/
  │   ├── dashboard.ts           (modify - fallback backpressure, load cleanup call; done for cleanup)
  │   ├── status-cache.ts       (no change - audit only)
  │   ├── cancel.ts             (modify - add cache clear on success)
  │   ├── task.ts               (modify - add cache clear on success)
  │   ├── split.ts              (modify - add cache clear on success)
  │   ├── crossplan.ts          (modify - add cache clear on success)
  │   ├── gate.ts               (modify - add cache clear on success)
  │   ├── recover.ts            (modify - add cache clear on success)
  │   ├── plan.ts               (modify - add cache clear on success if mutates)
  │   ├── edge.ts               (modify - add cache clear on success)
  │   └── tui/
  │       └── live-opentui.ts    (modify - backpressure, error visibility)
  docs/
  └── performance.md            (modify - dashboard Dolt loading subsection)
  __tests__/
  ├── cli/
  │   └── dashboard-format.test.ts   (modify - error display if needed)
  ├── integration/
  │   └── status-live.test.ts       (modify - backpressure or error behavior)
  └── domain/
      └── plan-completion.test.ts    (optional - completeAllPlansThatAreDone)
risks:
  - description: Dolt Service Hardening plan also touches live-opentui.ts and dashboard.ts; merge conflicts possible
    severity: medium
    mitigation: Read current file before each edit; keep changes small and focused; coordinate if both plans active
  - description: Changing refresh or error behavior can affect existing integration tests (status-live, dashboard)
    severity: low
    mitigation: Update test expectations to match new behavior; add explicit assertions for backpressure and error banner
tests:
  - "Dashboard fallback and OpenTUI refresh do not start a new fetch while previous fetch is in flight"
  - "On fetch error, dashboard shows last good content with error banner or footer (not full-screen replacement)"
  - "tg cancel, task new, split, crossplan, gate, recover (and any other write commands missing clear) invalidate status cache on success"
  - "docs/performance.md documents dashboard Dolt path (server vs execa), cache TTL, and refresh interval"
  - "On dashboard load, projects with all tasks done are marked done in the background and excluded from Active Projects on next refresh"
todos:
  - id: refresh-backpressure
    content: "Add refresh backpressure so dashboard does not overlap fetches"
    agent: implementer
    changeType: modify
    docs: [cli-tables, performance]
    intent: |
      Prevent overlapping fetchStatusData (and fetchTasksTableData where used) when the 2s timer fires before the previous fetch completes. Today both the fallback loop (dashboard.ts) and all OpenTUI interval callbacks (live-opentui.ts) can start a new fetch every 2s regardless of in-flight state.

      In src/cli/dashboard.ts runLiveFallbackDashboard: introduce a guard (e.g. fetchInFlight boolean or a single promise chain). On each timer tick, if a fetch is already in flight, skip this tick (do not call fetchStatusData). Only start the next fetch after the previous one completes.

      In src/cli/tui/live-opentui.ts: there are multiple setInterval blocks (default view, --tasks, --projects, etc.). For each, use the same pattern: before calling fetchStatusData/fetchTasksTableData, check if a fetch is in progress; if so, skip the tick. Use a module-level or closure guard (e.g. let fetchInFlight = false; set to true before await fetch..., set to false in finally). Ensure renderer.isDestroyed check still runs so cleanup is unchanged.

      Result: at most one fetch in flight per dashboard instance; no stacking when Dolt is slow.
    suggestedChanges: |
      // Pattern: in interval callback
      if (fetchInFlight) return;
      fetchInFlight = true;
      try {
        const result = await fetchStatusData(...);
        // ... render
      } finally {
        fetchInFlight = false;
      }
  - id: error-visibility
    content: "Show dashboard errors in banner or footer while keeping last good content"
    agent: implementer
    changeType: modify
    docs: [cli-tables, error-handling]
    intent: |
      Today on fetch error the dashboard replaces the entire root with a single error box ("[tg] DB refresh error: ..."), losing the last good view. Improve UX by keeping the last successful content and showing the error in a persistent banner or footer so the user still sees data and can tell what failed.

      In src/cli/tui/live-opentui.ts: For each refresh path that currently calls replaceRootWithNewBox(renderer, Box, ..., msg) on error, change to (1) keep the existing root content (last good data), and (2) add or update a small error section (e.g. a footer Box with Text content "[tg] DB refresh error: ..." or use updateRootTextContent to set an error line in a dedicated node). Ensure the error is visible (e.g. at bottom of layout). If no "last good" content exists yet (first fetch failed), keep current behavior (full replacement) so user sees something.

      In src/cli/dashboard.ts runLiveFallbackDashboard: on error in the interval callback, consider writing the error on a separate line (e.g. after the main content) instead of replacing the whole write(), so last good output remains above.

      Do not add retry button or automatic retry logic in this task; only change where/how the error is displayed.
    suggestedChanges: |
      // Option: add an error Box as last child of root when error occurs; clear it on next success.
      // buildDefaultDashboardRoot could accept optional errorMessage; when set, add a fourth Box with error text.
  - id: audit-cache-invalidation
    content: "Add getStatusCache().clear() to all write commands that mutate status-relevant data"
    agent: implementer
    changeType: modify
    docs: [schema, architecture]
    intent: |
      Status and Dashboard Cache already wires getStatusCache().clear() in done, start, block, note, import. Other CLI commands that mutate plan/task/event/edge/project must also clear the cache on success so the next status/dashboard fetch sees fresh data.

      Audit and add clear() in the success path for:
      - cancel.ts (task/plan/project status updates)
      - task.ts (task new)
      - split.ts
      - crossplan.ts
      - gate.ts (unblock)
      - recover.ts (stale task recovery)
      - plan.ts (if it mutates project/plan rows on create/update)
      - edge.ts (add edge)

      For each file: after the write succeeds (in the same place where we might log or return), call getStatusCache().clear(). Match the pattern used in done.ts and start.ts (e.g. only on success, not on partial failure). If a command has multiple exit paths, add clear() to each success path.
    suggestedChanges: |
      import { getStatusCache } from "./status-cache";
      // In success branch after write:
      getStatusCache().clear();
  - id: dolt-loading-docs
    content: "Document dashboard Dolt loading strategy in docs/performance.md"
    agent: documenter
    changeType: modify
    docs: [performance, infra]
    intent: |
      Add a short subsection to docs/performance.md (or under the existing "Dolt sql-server Mode" section) that explains how the dashboard gets its data and how to make it fast and reliable.

      Include: (1) Server vs execa path — when TG_DOLT_SERVER_PORT and TG_DOLT_SERVER_DATABASE are set, dashboard uses mysql2 pool (concurrent, ~5ms/query); otherwise execa (serialized, ~150ms/query). (2) Status cache — TTL (TG_STATUS_CACHE_TTL_MS, default 2.5s) and that dashboard refresh is 2s so repeat ticks within TTL hit cache. (3) Recommendation: run tg server start (or dolt sql-server) and set the env vars for fast dashboard; without that, execa serialization and cache still prevent overlapping load. (4) Fallback: if server probe fails, CLI clears port/database and uses execa for the rest of the process.

      Keep the subsection concise; link to existing "Dolt sql-server Mode" and "Query Result Cache" sections.
  - id: dashboard-improvements-tests
    content: "Add or extend tests for backpressure, error display, and cache invalidation"
    agent: implementer
    changeType: modify
    blockedBy: [refresh-backpressure, error-visibility, audit-cache-invalidation]
    docs: [testing, cli-reference]
    intent: |
      Assign and implement the plan-level tests.

      1. Backpressure: In __tests__/integration/status-live.test.ts or a dedicated dashboard test, add a test that mocks or slows fetchStatusData so that a second tick would fire before the first completes; assert that only one fetch runs at a time (e.g. by counting calls or with a slow stub). Alternatively, unit-test the guard logic in isolation if the interval is extracted to a testable function.

      2. Error display: In __tests__/cli/dashboard-format.test.ts or integration test, trigger a fetch error (e.g. invalid config or mock that returns err) and assert that the output contains both last good content (or placeholder) and the error message in a banner/footer, not only the error.

      3. Cache invalidation: In __tests__/integration/status-cache.test.ts (or equivalent), add cases that after tg cancel, tg task new, tg split, tg gate (or a subset), the next fetchStatusData call bypasses cache (e.g. cache was cleared). Use existing patterns (runTgCli, getStatusCache().reset for isolation).

      Update any existing tests that assumed full-screen error replacement so they expect the new error banner behavior.

      4. Load cleanup: Add a test that when the dashboard runs (or when completeAllPlansThatAreDone is invoked), projects with all tasks done are updated to status = done and the next status fetch excludes them from active plans (or unit-test completeAllPlansThatAreDone in isolation with a test DB).
  - id: run-full-suite
    content: "Run gate:full and verify full suite passes"
    agent: implementer
    changeType: modify
    blockedBy: [dashboard-improvements-tests]
    docs: [testing, infra]
    intent: |
      Run pnpm build then pnpm gate:full (or bash scripts/cheap-gate.sh --full). Record result in task evidence (e.g. "gate:full passed" or "gate:full failed: <summary>"). On failure, add tg note with failure reason and do not mark done until fixed or escalated.
isProject: false
---

## Analysis

The dashboard (tg dashboard and tg status --dashboard) uses fetchStatusData every 2s. Cache and schema flags are already wired; execa path is serialized per repo to avoid Dolt lock contention.

**Implemented:** On dashboard load, a background cleanup runs: `completeAllPlansThatAreDone` (domain/plan-completion.ts) finds projects that are not done/abandoned and have every task done or canceled (with at least one done), sets those projects to status = done, commits, then clears the status cache so the next refresh excludes them from the Active Projects table. Dashboard.ts calls `runDashboardCleanup(config)` once before entering the default/--tasks/--projects branches.

Remaining improvements are (1) avoid overlapping fetches when DB is slow (backpressure), (2) show errors without wiping the last good view (error visibility), (3) ensure every write command invalidates the status cache so dashboard never serves stale data after tg cancel / task / split / crossplan / gate / recover / edge / plan, and (4) document when to use server vs execa and how cache/refresh interact.

No new schema or event capture is required. Overlap with Dolt Service Hardening (live-opentui, dashboard.ts) is mitigated by small, targeted edits and reading current file state before editing.

## Dependency graph

```
Parallel start (4 unblocked):
  ├── refresh-backpressure    (dashboard + live-opentui)
  ├── error-visibility         (live-opentui + fallback)
  ├── audit-cache-invalidation (cancel, task, split, crossplan, gate, recover, plan, edge)
  └── dolt-loading-docs        (docs/performance.md)

After refresh-backpressure, error-visibility, audit-cache-invalidation:
  └── dashboard-improvements-tests

After dashboard-improvements-tests:
  └── run-full-suite
```

## Proposed changes

- **Project cleanup on load (done):** On dashboard load, run `completeAllPlansThatAreDone(doltRepoPath)` in the background; on success clear status cache so the next refresh shows completed plans out of Active. Implemented in domain/plan-completion.ts and dashboard.ts.
- **Backpressure:** Single guard (fetchInFlight or promise chain) in dashboard.ts fallback and in each live-opentui setInterval callback; skip tick if fetch already in progress.
- **Error visibility:** Add error banner/footer to dashboard root when fetch fails; keep last good content; only full-screen replace when there is no last good content (e.g. first fetch failed).
- **Cache invalidation:** Add getStatusCache().clear() on success in cancel, task, split, crossplan, gate, recover, plan (if mutates), edge.
- **Docs:** One subsection in performance.md covering server vs execa, cache TTL, refresh interval, and recommendation to run server for fast dashboard.

## Open questions

- None; scope is bounded to the four areas above.

<original_prompt>
/plan for improvements for dashboard
</original_prompt>
