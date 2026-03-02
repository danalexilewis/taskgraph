# Evolve: Plan "Hivemind Initiative" — 2026-03-02

**Plan:** Hivemind Initiative (7 tasks). No plan branch — task merges went to main. Diff base: `66e6ef2..main` for plan-touched files.

## Findings

| Category       | Pattern                                                              | File(s)              | Routed to                            |
| -------------- | -------------------------------------------------------------------- | -------------------- | ------------------------------------ |
| Other          | Duplicate resolveInitiativeId (import vs status); divergent ID/title | import.ts, status.ts | implementer.md + quality-reviewer.md |
| Error handling | Import CLI `--initiative` stored raw without resolution              | import.ts            | implementer.md + quality-reviewer.md |
| Other (DRY)    | Repeated initiative WHERE fragment in each crossplan run\*           | crossplan.ts         | implementer.md                       |
| Error handling | UUID `--initiative` accepted without existence check (silent empty)  | status.ts            | quality-reviewer.md                  |
| Other          | process.exit inside value-returning helper (getInitiativeId)         | crossplan.ts         | implementer.md                       |

## Learnings written

- **implementer.md ## Learnings:** 4 entries added (shared resolver, resolve before assign, extract initiativeWhereClause, CLI boundary pattern).
- **quality-reviewer.md ## Learnings:** 3 entries added (flag duplicate resolvers, flag raw option stored, flag UUID without existence check).

## Durable patterns (suggest doc update)

- **Optional:** When adding optional filters (e.g. `--initiative`) to CLI commands that write or filter by a foreign key, document in `docs/cli-reference.md` or a skill that (1) resolution (ID or title → FK) should use a single shared helper, and (2) raw option values must not be persisted without resolution.
