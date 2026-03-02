---
name: Default Daily Initiative
overview: Auto-create and auto-associate a daily default initiative when projects are created without an explicit initiative; add initiative update command; add day-summary skill for end-of-day narrative generation.
fileTree: |
  src/
  ├── db/
  │   └── migrate.ts                   (modify — add is_default migration + index)
  ├── cli/
  │   └── initiative.ts                (modify — add today + update subcommands)
  └── cli/
      └── import.ts                    (modify — auto-daily fallback)
  __tests__/
  └── integration/
      ├── initiative.test.ts           (modify — add update + today + import tests)
  docs/
  ├── schema.md                        (modify — is_default column)
  └── cli-reference.md                 (modify — tg initiative today, tg initiative update)
  .cursor/
  └── skills/
      └── day-summary/
          └── SKILL.md                 (create)
risks:
  - description: tg import behavioral change breaks existing tests that assert initiative_id = UNASSIGNED after import without --initiative
    severity: medium
    mitigation: Add --no-daily-initiative flag to preserve old behavior; update integration tests explicitly
  - description: Migration chain invalidation causes all deployed instances to re-probe on next tg invocation
    severity: low
    mitigation: Expected and acceptable; ensure new migrations are fast
  - description: Daily initiative created at import time may generate spurious Dolt commits if changed guard is omitted
    severity: low
    mitigation: Use changed flag pattern from existing migrations; only doltCommit if a new row was inserted
tests:
  - "tg import without --initiative creates daily initiative on first run for today"
  - "tg import without --initiative reuses same daily initiative on second run same day"
  - "tg import --no-daily-initiative falls back to Unassigned sentinel"
  - "tg initiative today returns existing daily initiative id (idempotent)"
  - "tg initiative update --description sets description and persists"
  - "tg initiative update --title renames initiative"
  - "tg initiative update with unknown id exits with non-zero and useful message"
todos:
  - id: schema-is-default
    content: "Add is_default column to initiative table and index"
    agent: implementer
    changeType: modify
    intent: |
      Add `is_default TINYINT(1) NOT NULL DEFAULT 0` column to the `initiative` table via a new
      idempotent migration `applyInitiativeIsDefaultMigration` in `src/db/migrate.ts`.

      Migration steps:
      1. `columnExists('initiative', 'is_default')` guard — skip if already present.
      2. `ALTER TABLE initiative ADD COLUMN is_default TINYINT(1) NOT NULL DEFAULT 0`
      3. Add `CREATE INDEX idx_initiative_is_default ON initiative(is_default)` — either inline in
         this migration or added to `applyIndexMigration`. Prefer inline since Dolt does not
         auto-create secondary indexes.
      4. Guard `doltCommit` with a `changed` flag — only commit if the ALTER ran.
      5. Append the new migration to `MIGRATION_CHAIN` after `applyIndexMigration`.

      Also update `docs/schema.md` to document the new column.

      Patterns to follow:
      - `applyInitiativeCycleIdMigration` — same structure for column-add migrations.
      - `applyIndexMigration` — pattern for batched index creation.
      - `tableExists` / `columnExists` guard pattern — copy exactly.

  - id: initiative-update-cmd
    content: "Add tg initiative update subcommand"
    agent: implementer
    changeType: modify
    intent: |
      Add a new `update` subcommand to `src/cli/initiative.ts` that updates one or more fields
      on an existing initiative row.

      Interface:
      ```
      tg initiative update <initiativeId> [--description <text>] [--title <text>] [--status <str>]
      ```
      - At least one flag required; exit with a useful error if none provided.
      - Build a dynamic SET clause from provided flags; only update supplied fields.
      - Run UPDATE + doltCommit (guard with rowsAffected > 0 check for commit).
      - Output JSON: `{ initiativeId, updated: { description?, title?, status? } }` on success.
      - If initiativeId not found, exit non-zero with a clear message.

      Follow the same Commander + readConfig + andThen + .match() at boundary pattern used by
      existing initiative subcommands (e.g. `assign-project`). Extract the DB mutation into a
      pure `updateInitiative(q, id, patch)` helper in the same file.

      Update `docs/cli-reference.md` with the new subcommand, flags, and example output.

  - id: initiative-today-cmd
    content: "Add tg initiative today subcommand and findOrCreateDailyInitiative helper"
    agent: implementer
    blockedBy: [schema-is-default]
    changeType: modify
    intent: |
      Add a `today` subcommand to `src/cli/initiative.ts` plus an exported
      `findOrCreateDailyInitiative(q, config)` helper function that other CLI commands can call.

      `tg initiative today`:
      - Idempotent: if an initiative with `is_default = 1` AND `DATE(created_at) = CURDATE()`
        exists, return it.
      - If not found, INSERT a new initiative with:
        - `title = 'Daily YYYY-MM-DD'` (formatted from today's date)
        - `description = ''`
        - `is_default = 1`
        - `status = 'active'`
      - Guard `doltCommit` — only commit if a new row was inserted.
      - Output: `{ initiativeId, title, created: boolean }`.

      `findOrCreateDailyInitiative(q, config)`:
      - Same logic as above, extracted as a `ResultAsync<string, AppError>` function
        (returns the initiative_id).
      - Exported from `initiative.ts` so `import.ts` can call it directly without shelling out.

      SQL convention: use `CURDATE()` (already proven in status.ts) for date comparison.
      Follow `okAsync(value)` for early-return on found path inside ResultAsync chain.

  - id: import-auto-daily
    content: "Modify tg import to auto-assign daily initiative when --initiative is omitted"
    agent: implementer
    blockedBy: [initiative-today-cmd]
    changeType: modify
    intent: |
      Modify `src/cli/import.ts` lines ~146-163 (the Unassigned fallback block) to instead
      call `findOrCreateDailyInitiative(q, config)` when `--initiative` is not provided.

      Add an opt-out flag: `--no-daily-initiative` — when set, restore old behavior (assign to
      the Unassigned sentinel initiative).

      The change must be inside the existing ResultAsync chain:
      - `if (initiativeFlag) { use provided id } else if (noDailyInitiative) { use Unassigned }
         else { return findOrCreateDailyInitiative(q, config) }`
      - Chain with `.andThen()` — do NOT call readConfig() a second time.

      Update `docs/plan-import.md` to document the new auto-daily behaviour and the
      `--no-daily-initiative` escape hatch.

  - id: initiative-update-tests
    content: "Integration tests for tg initiative update and tg initiative today"
    agent: implementer
    blockedBy: [schema-is-default, initiative-update-cmd, initiative-today-cmd]
    changeType: modify
    intent: |
      Add tests to `__tests__/integration/initiative.test.ts`:

      For `tg initiative update`:
      - Update description: create initiative, update --description, tg initiative show verifies
      - Update title: same pattern
      - Unknown ID exits non-zero with message
      - No flags provided exits non-zero with message

      For `tg initiative today`:
      - First call inserts and returns `created: true`
      - Second call on same day returns same id with `created: false`
      - Verify `is_default = 1` on the returned initiative (via tg initiative show --json)

      Follow the existing test structure in `initiative.test.ts` — each test uses an isolated
      temp DB (the test harness provides this). Use `runCLI(['initiative', 'update', ...])`.

  - id: import-auto-daily-tests
    content: "Integration tests for tg import auto-daily initiative behavior"
    agent: implementer
    blockedBy: [import-auto-daily]
    changeType: modify
    intent: |
      Add tests to `__tests__/integration/initiative.test.ts` (or a new
      `__tests__/integration/import-auto-daily.test.ts` if the file gets unwieldy):

      - Import without --initiative: project.initiative_id matches today's daily initiative id
      - Import without --initiative twice same day: both projects get the same daily initiative id
      - Import with --no-daily-initiative: project.initiative_id = UNASSIGNED sentinel
      - Import with explicit --initiative: unaffected by new logic

      Use the existing import test harness pattern from `__tests__/integration/` (load a plan
      fixture, run import, query the DB to check initiative_id).

  - id: day-summary-skill
    content: "Create .cursor/skills/day-summary/SKILL.md"
    agent: implementer
    blockedBy: [initiative-update-cmd]
    changeType: create
    intent: |
      Create a new skill file at `.cursor/skills/day-summary/SKILL.md`.

      The skill guides an agent to:
      1. Identify the daily default initiative for the target date (default: today).
         Query: `tg initiative list --json` then filter for `is_default = 1` matching the date,
         OR call `tg initiative today` to get/create it.
      2. Enumerate projects under that initiative:
         `tg initiative show <id> --json` — returns the projects array.
      3. For each project, pull done events:
         Run `pnpm tg status --tasks` or a raw SQL query to find completed tasks in those projects
         with their evidence strings, agent names, and areas touched.
      4. Generate a mood-and-summary paragraph:
         - Which areas/domains were touched (from task.area, task_doc.doc slugs)
         - Which agents were active (from event.body.agent)
         - Volume of work (N tasks completed across M projects)
         - Tone/mood derived from evidence strings (e.g. "clean run", "gate failures", "refactor")
         - Keep it concise: 2-4 sentences
      5. Persist: `tg initiative update <id> --description "<summary>"`
         - Only write if description is currently empty or if the user explicitly asks to overwrite.

      The skill should also handle the case where no daily initiative exists for the target date —
      output a note that no work was tracked via the daily initiative for that day.

      Format: follow the structure of `.cursor/skills/clean-up-shop/SKILL.md` as a model
      (trigger phrases, phase list, commands used, guardrails).

  - id: gate-full
    content: "Run gate:full and verify all changes pass"
    agent: implementer
    blockedBy:
      [initiative-update-tests, import-auto-daily-tests, day-summary-skill]
    changeType: modify
    intent: |
      Run `pnpm gate:full` from inside the plan worktree. Record the full result as evidence.
      If any failures are found, note them with `tg note` and return ESCALATE in evidence.
      Do not fix failures in this task — the orchestrator will dispatch an investigator.

isProject: true
---

## Analysis

The "default daily initiative" concept plugs a usability gap: ad-hoc work that goes into the task graph without a curated plan currently ends up in the "Unassigned" sentinel, which is a dead-end bucket with no narrative. The daily initiative gives that work a home, a date-stamped identity, and a surface for the day-summary skill to write to.

The design reuses the existing `is_default = 1 AND CURDATE()` pattern — proven via `CURDATE()` already in `status.ts` — rather than a naming convention alone, to avoid collisions with user-named initiatives. The naming convention (`Daily YYYY-MM-DD`) is the _secondary_ human-readable signal; `is_default` is the primary programmatic signal.

The `tg initiative update` command is a prerequisite for the cleanup skill and is also a long-overdue gap in the initiative CLI surface. The `findOrCreateDailyInitiative` helper is extracted as a shared function so both the `today` subcommand and `import.ts` use the same logic without duplication.

## Dependency Graph

```
Parallel start (2 unblocked):
  ├── schema-is-default        (migration: is_default column + index)
  └── initiative-update-cmd    (tg initiative update subcommand)

After schema-is-default:
  └── initiative-today-cmd     (tg initiative today + findOrCreateDailyInitiative helper)

After initiative-today-cmd:
  └── import-auto-daily        (tg import auto-daily fallback)

After schema-is-default + initiative-update-cmd + initiative-today-cmd:
  └── initiative-update-tests  (tests for update + today subcommands)

After import-auto-daily:
  └── import-auto-daily-tests  (tests for import auto-daily behavior)

After initiative-update-cmd:
  └── day-summary-skill        (SKILL.md for day narrative generation)

After all above:
  └── gate-full                (pnpm gate:full)
```

## Proposed Changes

### Schema (`src/db/migrate.ts`)

```ts
async function applyInitiativeIsDefaultMigration(
  q: QueryRunner,
  config: Config,
) {
  const exists = await columnExists(q, "initiative", "is_default");
  if (exists) return;
  await q.raw(
    `ALTER TABLE initiative ADD COLUMN is_default TINYINT(1) NOT NULL DEFAULT 0`,
  );
  await q.raw(
    `CREATE INDEX idx_initiative_is_default ON initiative(is_default)`,
  );
  await doltCommit(config, q, "add is_default column to initiative");
}
```

### `findOrCreateDailyInitiative` helper

```ts
export function findOrCreateDailyInitiative(
  q: QueryRunner,
  config: Config,
): ResultAsync<string, AppError> {
  return q
    .raw<
      { initiative_id: string }[]
    >(`SELECT initiative_id FROM initiative WHERE is_default = 1 AND DATE(created_at) = CURDATE() LIMIT 1`)
    .andThen((rows) => {
      if (rows.length > 0) return okAsync(rows[0].initiative_id);
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const id = generateId();
      return q
        .raw(
          `INSERT INTO initiative (initiative_id, title, description, status, is_default, created_at, updated_at)
       VALUES (?, ?, '', 'active', 1, NOW(), NOW())`,
          [id, `Daily ${today}`],
        )
        .andThen(() =>
          doltCommit(config, q, `create daily initiative for ${today}`),
        )
        .map(() => id);
    });
}
```

### `tg import` auto-daily fallback (conceptual)

```ts
// in the initiative-resolution block:
const resolveInitiative = initiativeFlag
  ? okAsync(initiativeFlag)
  : noDailyInitiative
    ? okAsync(UNASSIGNED_INITIATIVE_ID)
    : findOrCreateDailyInitiative(q, config);
```

## Open Questions

1. Should the `tg initiative today` output include the list of projects already assigned to the daily initiative (like `tg initiative show`)? Likely no — keep it a minimal find-or-create that returns only `{ initiativeId, title, created }`.
2. Should `is_default = 1` be enforced as unique per day at the DB level (a partial unique index)? Dolt may not support partial unique indexes. Rely on application-level idempotency instead (the `DATE(created_at) = CURDATE()` check before insert).
3. For the day-summary skill, should "mood" detection be a heuristic on evidence strings (keyword scan) or delegated to the LLM freely? The skill should leave this to the agent; just specify what data to feed in.

<original_prompt>
default initiative.

if you are going to create a project in tg without an initiative look for a default one for the day. if its not there, create it, if it is associate with it.

At the end of the day, or rather at a later date. there will be a cleanup agent that we run to go throgh day initiatives, look at the projects that had no plans and then give the day default initiative a description that summarises the work and the mood of the agents.

/plan
</original_prompt>
