---
name: Dolt Data Loss Hardening
overview: Harden Dolt repo against data loss from git merge/stash and concurrent access by adding gitattributes, cross-process lock, serialized repair, noms health check in init, and recovery docs.
fileTree: |
  .gitattributes
  src/db/connection.ts
  src/cli/init.ts
  docs/infra.md
risks:
  - description: Cross-process lock may block if a process crashes without releasing
    severity: medium
    mitigation: Use advisory lock with PID in lockfile or short timeout; document manual removal of stale lock if needed
  - description: Noms health check could false-positive on a freshly inited empty repo
    severity: low
    mitigation: Treat "empty but valid" (e.g. manifest exists, journal 0 bytes after fresh init) as OK; only warn when manifest is missing or manifest has all-zero hashes
tests:
  - "Unit or integration test for repair path (optional; analyst noted no tests today)"
  - "Manual verification: tg init on existing repo with corrupt noms shows warning and suggests restore"
todos:
  - id: gitattributes-dolt-noms
    content: Add .gitattributes so Dolt noms files are binary and never merged as text
    agent: implementer
    intent: |
      Add rules to .gitattributes so that .taskgraph/dolt/.dolt/noms/* (manifest, journal.idx, and the journal file) are treated as binary with -diff -merge. This prevents git from running text merge on these files when branches with different Dolt states are merged or when worktrunk stash is applied. Use the pattern that marks them as binary (e.g. *.taskgraph/dolt/.dolt/noms/* binary -diff -merge or explicit paths). Reference: investigation findings and reports/dolt-default-branch-repair-2026-03-03.md.
    changeType: create
  - id: cross-process-lock-execa
    content: Add cross-process file lock for execa path in connection.ts
    agent: implementer
    intent: |
      In src/db/connection.ts, add a cross-process lock so only one process can run dolt sql (execa path) against the same repo at a time. Acquire the lock before running the execa dolt sql command (in the same region where acquireExecaSlot is used) and release in finally. Use a lockfile under .taskgraph/dolt/.dolt/noms/ (e.g. LOCK or a dedicated .tg-execa.lock). Prefer Node built-in or a small dependency (e.g. proper-lockfile, or fs.open with exclusive flag + PID in file for stale detection). Document in code that the in-process semaphore does not protect across processes; this lock does. See docs/infra.md and reports/dolt-default-branch-repair for context.
    changeType: modify
  - id: repair-via-semaphore
    content: Run repairMainBranch through the execa semaphore
    agent: implementer
    intent: |
      In src/db/connection.ts, ensure repairMainBranch runs while holding the same execa slot as queries so repair and queries are serialized in-process. Currently repair is called in the orElse retry without going through acquireExecaSlot. Change the retry path so that: acquire slot, run repairMainBranch, release slot, then retry runOnce(). This prevents a concurrent in-process doltSql from running during repair. No new APIs; internal refactor only.
    changeType: modify
  - id: noms-health-check-init
    content: Add noms health check in tg init when repo already exists
    agent: implementer
    intent: |
      In src/cli/init.ts, after the branch that logs "Dolt repository already exists" and before applyMigrations, add a lightweight read-only noms health check. Verify (1) .taskgraph/dolt/.dolt/noms/manifest exists and is readable, (2) the manifest does not contain all-zero root/table hashes (corrupt state), (3) optionally that the noms journal file exists and has non-zero size (or allow 0 for a freshly inited repo). If corrupt (e.g. manifest missing, or manifest has 0000... hashes), log a warning and suggest restoring from git: "Noms store appears corrupt. Restore with: git checkout <commit> -- .taskgraph/dolt/.dolt/noms/ then run tg status." Do not overwrite or re-run dolt init. See docs/infra.md and reports/dolt-default-branch-repair.
    changeType: modify
  - id: doc-recovery-infra
    content: Document Dolt recovery in docs/infra.md
    agent: implementer
    intent: |
      In docs/infra.md, add a "Recovery" or "Troubleshooting" subsection under the Dolt section. Describe: if the user sees "cannot resolve default branch head for database 'dolt': 'main'" or "active_branch() nil" or corrupt noms, they can restore from a known-good git commit with git checkout <commit> -- .taskgraph/dolt/.dolt/noms/manifest .taskgraph/dolt/.dolt/noms/journal.idx ".taskgraph/dolt/.dolt/noms/vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv" (and stats if present), then run tg status. Reference reports/dolt-default-branch-repair-2026-03-03.md. Keep the section short and scannable.
    changeType: modify
isProject: true
---

# Dolt Data Loss Hardening

## Analysis

The recent investigation into Dolt database data loss identified two main causes: (1) git overwriting live noms files when stash is applied or when branches with different Dolt states are merged (no binary/merge attributes), and (2) concurrent access to the noms store from multiple processes (in-process semaphore only). This plan implements mitigations and recovery documentation without changing the decision to track Dolt data in git.

- **.gitattributes:** Prevents git from ever merging noms files as text; low risk, single-file change.
- **Cross-process lock:** Ensures only one process runs `dolt sql` against a given repo at a time on the execa path; reduces corruption from multiple agents or CLI invocations.
- **Repair via semaphore:** Closes the in-process race where repair and a retry could overlap with another caller.
- **Noms health check:** Gives users an immediate, actionable message when init finds an existing but corrupt repo instead of failing later on the first query.
- **Recovery docs:** Makes restore-from-git a documented, repeatable procedure.

## Dependency graph

```
Parallel start (5 unblocked):
  ├── gitattributes-dolt-noms
  ├── cross-process-lock-execa
  ├── repair-via-semaphore
  ├── noms-health-check-init
  └── doc-recovery-infra
```

No task blocks another. All can run in parallel.

## Proposed changes

- **.gitattributes:** Add lines such as:
  `.taskgraph/dolt/.dolt/noms/* binary -diff -merge`
  (or one line per critical path: manifest, journal.idx, and the v* journal file if a single glob does not match.)

- **connection.ts lock:** Wrap the execa path (inside `runQuery`, around the same scope as `acquireExecaSlot`) with a file-based lock acquire/release. Use a lockfile path derived from `repoPath` (e.g. `pathJoin(repoPath, '.dolt', 'noms', 'LOCK')` or a dedicated `.tg-execa.lock`). On failure to acquire (e.g. timeout), return a clear error suggesting the user ensure no other tg/dolt process is using the repo.

- **repairMainBranch:** In the `doltSql` orElse branch that calls `repairMainBranch`, acquire the execa slot before calling `repairMainBranch`, then release, then retry `runOnce()`. No change to repair's implementation.

- **init.ts health check:** After `existsSync(doltRepoPath)` is true and "Dolt repository already exists" is logged, before `applyMigrations`, read the noms manifest (and optionally check journal file size). If manifest is missing or contains all-zero hashes in the root/table hash fields, log warning with restore instructions and exit or throw so migrations do not run against corrupt store.

- **infra.md:** New subsection "Recovery" under "Dolt" with bullet or short paragraph: symptom (cannot resolve default branch / corrupt noms), then command to restore noms from git and run `tg status`.

## Open questions

- None. Stale lock handling for the cross-process lock can be minimal (e.g. PID in file + document manual remove); we can refine in a follow-up if needed.

<original_prompt>
/plan then /work — create a plan for the Dolt data loss hardening tasks from the investigation, then execute it.
</original_prompt>
