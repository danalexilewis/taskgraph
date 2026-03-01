---
name: Import pre-flight and duplicate prevention
overview: Add a pre-flight check when re-importing a plan that already has tasks; require --force to proceed when existing tasks would be unmatched (e.g. todo ids changed), or --replace to cancel those tasks first.
fileTree: |
  src/
  ├── cli/
  │   ├── import.ts              (modify)
  │   └── cancel.ts              (modify — export cancelOne)
  ├── plan-import/
  │   └── importer.ts            (modify)
  __tests__/
  └── integration/
      └── cursor-import.test.ts  (modify)
  docs/
  ├── plan-import.md             (modify)
  └── cli-reference.md          (modify)
risks:
  - description: Multiple commits when using --replace (one per canceled task plus upsert)
    severity: low
    mitigation: Accept for v1; document; optional follow-up to batch cancels into one commit.
  - description: Template apply has same duplicate scenario but is out of scope
    severity: low
    mitigation: Document as follow-up; optionally add same pre-flight to template apply later.
tests:
  - "Re-import with changed todo ids: no flag → exit non-zero and message (cursor-import.test.ts)"
  - "Re-import with --force → exit 0, duplicate tasks present (cursor-import.test.ts)"
  - "Re-import with --replace → exit 0, unmatched tasks canceled, new keys only (cursor-import.test.ts)"
todos:
  - id: preflight-helper
    content: Add computeUnmatchedExistingTasks in plan-import/importer.ts
    agent: implementer
    intent: |
      Add a pre-flight helper that reuses the same load and normalization logic as upsertTasksAndEdges.
      - In src/plan-import/importer.ts, implement computeUnmatchedExistingTasks(planId, parsedTasks, repoPath, externalKeyPrefix): ResultAsync<{ unmatchedTaskIds: string[]; unmatchedExternalKeys?: string[] }, AppError>.
      - Load existing tasks for plan_id (same select as upsert path). Normalize external_key identically: strip -[0-9a-f]{6} suffix, then if externalKeyPrefix and key starts with prefix-, strip that to get stableKey. Build parsedStableKeys = new Set(parsedTasks.map(t => t.stableKey)).
      - Unmatched = existing tasks whose normalized stableKey is not in parsedStableKeys. Return unmatchedTaskIds and optionally unmatchedExternalKeys (for error message). No DB writes; pure read + in-memory comparison.
      - Reuse types (Task) and PLAN_HASH_SUFFIX / prefix logic from existing upsert so behavior stays in sync. Export the new function.
    changeType: create

  - id: import-force-replace
    content: Add --force and --replace to tg import and run pre-flight
    agent: implementer
    blockedBy: [preflight-helper]
    intent: |
      In src/cli/import.ts: add options --force and --replace. After plan resolution (and optional plan create), if the plan already has at least one task, call computeUnmatchedExistingTasks. If unmatchedTaskIds.length > 0 and neither --force nor --replace: exit with clear error (list unmatched keys or count) and hint "use --force to import anyway (may create duplicates) or --replace to cancel existing tasks that won't be matched". If --replace: for each unmatched task_id, call cancelOne. cancelOne is currently internal in src/cli/cancel.ts — export it (or a wrapper that takes id, config, options, cmd) so import can call it with the same cmd so noCommit is respected. Then call upsertTasksAndEdges. If --force: call upsertTasksAndEdges only. Skip pre-flight when plan was just created (no existing tasks).
    changeType: modify

  - id: import-preflight-tests
    content: Integration tests for re-import with changed ids and flags
    agent: implementer
    blockedBy: [import-force-replace]
    intent: |
      In __tests__/integration/cursor-import.test.ts (serial describe): Add tests (a) Re-import same plan with changed todo ids (e.g. overwrite plan file so cursor-task-a -> cursor-task-a-renamed): run import without flag, expect non-zero exit and stderr containing the warning message. (b) Same changed-ids file with --force: expect exit 0, task count increases (duplicates). (c) Same with --replace: expect exit 0, number of non-canceled tasks for the plan equals parsed count, canceled tasks have old external_keys. Reuse existing plan title and temp dir; keep tests in the same serial describe to avoid DB concurrency issues.
    changeType: test

  - id: import-preflight-docs
    content: Document re-import, --force, and --replace in plan-import and cli-reference
    agent: implementer
    blockedBy: [import-force-replace]
    intent: |
      Update docs/plan-import.md: add section on re-import and id stability; explain that changing todo ids between imports creates unmatched existing tasks and that the command will fail unless --force or --replace is used; describe --force (proceed, may create duplicates) and --replace (cancel unmatched then upsert). Update docs/cli-reference.md: document tg import options --force and --replace in the import command section. Match actual CLI behavior.
    changeType: document

  - id: template-apply-preflight
    content: "(Optional) Add same pre-flight and --force/--replace to template apply"
    agent: implementer
    blockedBy: [import-force-replace]
    intent: |
      Only if time permits. In src/cli/template.ts, when applying to an existing plan that already has tasks, call computeUnmatchedExistingTasks before upsertTasksAndEdges; add --force and --replace options and mirror import behavior (fail when unmatched and no flag; cancel then upsert on --replace). Document in cli-reference and plan-import. If skipped, add a short "Follow-up" note in plan-import.md.
    changeType: modify
isProject: false
---

## Analysis

Duplicate tasks on re-import occur when the user changes todo `id`s in the plan file between runs (e.g. `wt-config-detection` → `wt-cfg-detect`). The upsert logic matches by stableKey; when the id in the file no longer matches any existing normalized external_key, the importer inserts a new task instead of updating. Option B adds a pre-flight check: when the plan already has tasks and some would be unmatched by the current parsed stableKeys, the command fails unless the user passes `--force` (proceed anyway, accepting possible duplicates) or `--replace` (cancel unmatched tasks then upsert). This keeps the default safe and makes re-import with changed ids an explicit choice.

**Dependency graph**

```
Parallel start:
  └── preflight-helper

After preflight-helper:
  └── import-force-replace

After import-force-replace:
  ├── import-preflight-tests
  ├── import-preflight-docs
  └── template-apply-preflight (optional)
```

**Out of scope**

- Batching cancel commits into one (v1 uses one commit per cancel when not --no-commit).
- Template apply pre-flight is optional and can be a follow-up.

**Original prompt**

User chose Option B (pre-flight check with --force/--replace) and requested a plan. Analyst gathered context; this plan implements the pre-flight helper, CLI flags, tests, and docs.

<original_prompt>
lets go with b /plan

Option B: Pre-flight check when re-importing a plan that already has tasks; require --force to proceed (may create duplicates) or --replace to cancel unmatched existing tasks before inserting.
</original_prompt>
