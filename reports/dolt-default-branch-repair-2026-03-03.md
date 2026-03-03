# Dolt Default Branch Repair

**Date:** 2026-03-03  
**Scope:** Root cause and fix for Dolt errors "cannot resolve default branch head for database 'dolt': 'main'" and "unexpectedly received non-string column in 'SELECT active_branch()': %!s(<nil>)" when using the taskgraph Dolt repo.  
**Produced by:** Orchestrator analysis and implementation.

---

## Scope

The taskgraph Dolt repo at `.taskgraph/dolt` can end up in a state where:

- Running `dolt --data-dir .taskgraph/dolt status` prints:  
  `unexpectedly received non-string column in 'SELECT active_branch()': %!s(<nil>)`
- Running `tg` commands (e.g. import, status) fails with:  
  `cannot resolve default branch head for database 'dolt': 'main'`

Both indicate that the default branch (`main`) is missing or unresolved; Dolt’s `active_branch()` then returns nil and the CLI or SQL path fails.

---

## Files examined

| File | Role |
|------|------|
| `src/db/connection.ts` | Execa path for `doltSql()`; error handling and retry. |
| `src/db/branch.ts` | Branch helpers (checkout, create, merge); no `active_branch()` usage. |
| `src/cli/init.ts` | Runs `dolt init` with `cwd: doltRepoPath` when repo does not exist. |
| `src/cli/sync.ts` | Uses `dolt branch --show-current` (not `dolt status`). |

No taskgraph code runs `SELECT active_branch()` or `dolt status`; the failure is from Dolt’s own resolution of the default branch when the repo refs are missing or broken.

---

## Root cause

- Dolt expects a resolvable default branch (e.g. `main`). If refs/HEAD or the branch ref is missing or corrupted, `active_branch()` returns nil.
- The Dolt CLI then prints the "non-string column … active_branch() … nil" message when the user runs `dolt status`.
- Our code path uses `dolt sql -q ...` and hits the same underlying problem, surfacing as "cannot resolve default branch head for database 'dolt': 'main'".

Common causes: repo created or touched in a way that left no valid default branch (e.g. old Dolt version, partial copy, or ref corruption).

---

## Fix applied

**Location:** `src/db/connection.ts` (execa path only).

1. **`isUnresolvedBranchError(e)`**  
   Detects this class of failure by checking the error (and `AppError.cause`) for:
   - `cannot resolve default branch`
   - `active_branch` + `nil` or `non-string column` + `active_branch`

2. **`repairMainBranch(repoPath)`**  
   Runs:
   - `dolt --data-dir <repoPath> checkout -b main`  
   Idempotent if `main` already exists.

3. **Retry after repair**  
   When an execa-path query fails and `isUnresolvedBranchError` is true:
   - run `repairMainBranch(repoPath)` once;
   - retry the same query once.  
   If repair fails, return a clear error suggesting:  
   `cd .taskgraph/dolt && dolt checkout -b main`.

Effect: the first `tg` command that hits the broken state will trigger repair and retry; subsequent commands and manual `dolt status` then work. Server path (mysql2 pool) is unchanged.

---

## Gaps

- **No commits:** If the repo has no commits, `dolt checkout -b main` may still fail; the user then needs to run the suggested command or re-run `tg init` for a fresh repo.
- **Manual `dolt status`:** The repair runs only when our code runs a query. If the user runs only `dolt status` manually, they must run a `tg` command first (or the suggested `dolt checkout -b main`) to fix the repo.

---

## Recommendations

1. **Use the fix as-is** — Keep the automatic repair + retry for the execa path; it resolves the common case without extra UX.
2. **Document in infra** — In `docs/infra.md` (or a Dolt troubleshooting section), add a short note: "If you see 'cannot resolve default branch' or 'active_branch() nil', run `cd .taskgraph/dolt && dolt checkout -b main` or run any `tg` command to trigger automatic repair."
3. **Dashboard plan import** — The Dashboard Improvements plan (`plans/26-03-03_dashboard_improvements.md`) failed to import earlier in the session due to this same Dolt state. After the repair runs (e.g. via `tg status`), re-run:  
   `pnpm tg import plans/26-03-03_dashboard_improvements.md --plan "Dashboard Improvements" --format cursor`.

---

## Summary

The Dolt repo can end up with no resolvable default branch, causing "active_branch() nil" and "cannot resolve default branch" errors. A repair step was added in `src/db/connection.ts`: on detecting that error in the execa path, we run `dolt checkout -b main` and retry the query once. This fixes both `tg` commands and, after one successful `tg` run, manual `dolt status`. Follow-up: document the error and repair in docs, and re-import the dashboard plan once the repo is healthy.
