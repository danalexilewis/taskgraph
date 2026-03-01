# Meta: Cross-Plan Enrichment (Draft Plans Only)

**Scope:** Plans with `status = draft` only.  
**Date:** 2026-03-01.  
**Skill:** /meta.

---

## Draft plans (10)

| Plan title                                    | plan_id                              |
| --------------------------------------------- | ------------------------------------ |
| Test Plan                                     | a1b2c3d4-e5f6-7890-abcd-ef1234567890 |
| Initiative-Project-Task Hierarchy             | 9c4e5030-e0b4-4bdb-bd45-59efff7b8b46 |
| Integration Test Speed - Process Elimination  | 907dc256-f759-405a-93d8-891a5fe3a4b3 |
| Integration Test Isolation Improvements       | e3cd8e2a-c286-4857-9f65-f1607c3a9000 |
| Cheap Gate Typecheck Hygiene                  | e8472a8a-f41c-479e-a60d-fbeaa9f98179 |
| Agent field and domain-to-docs rename (draft) | 20b0e6b3-46a3-4281-9389-c50c50356573 |
| run_dolt_backed_tests                         | 11346993-213e-4264-9908-f221ff87489a |
| Query builder audit                           | 44e81d81-9df7-46e6-ae0c-917e209f090f |
| Fix Test File Errors                          | 6371c7f8-01ed-4c4b-a702-f94cef3f6029 |
| update docs                                   | 5cbf50e9-e7c1-40fc-adc2-78470dc6a3e3 |

---

## 1. File conflicts (draft ↔ draft)

| File            | Draft plans touching it                                                               | Proposal                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **bunfig.toml** | Integration Test Speed - Process Elimination, Integration Test Isolation Improvements | **blocks or ordering:** Run one plan before the other, or add a `blocks` edge between a task in one plan and a task in the other that touches `bunfig.toml`, to avoid concurrent edits. Alternatively treat as shared area and coordinate (e.g. same owner). |

No other files are touched by more than one _draft_ plan in the crossplan files output (other overlaps involve done/abandoned plans).

---

## 2. Domain clusters (draft-only)

- **Initiative-Project-Task Hierarchy** is the only draft plan that appears in cross-plan domain lists (domains **cli** and **schema**); it shares those domains with many _done_ plans.
- No domain is shared by **multiple draft** plans, so there are no draft-only domain clusters to link with `relates`.

**Proposal:** None for draft↔draft. Optional: if you later run Initiative-Project-Task Hierarchy, you could add `relates` to relevant tasks in done plans that share cli/schema for visibility only (low priority).

---

## 3. Architectural opportunities

- **Integration test drafts:** "Integration Test Speed - Process Elimination" and "Integration Test Isolation Improvements" both touch integration test harness/config (`bunfig.toml`). Consider: (1) run **Integration Test Isolation Improvements** first, then **Integration Test Speed**, or (2) merge into one plan if they are the same initiative.
- **Agent field and domain-to-docs rename:** A plan with the same title exists and is **done** (e.g. `f28e4d6a-e919-4d07-b894-d37ed67d4c32`). The **draft** (20b0e6b3-...) may be duplicate or stale. **Proposal:** Confirm intent; if duplicate, `tg cancel <draftPlanId> --reason "Duplicate of completed plan"`.

---

## 4. Ordering (execution)

Suggested order if you run draft plans:

1. **Integration Test Isolation Improvements** (isolation first).
2. **Integration Test Speed - Process Elimination** (then process-elimination/speed).
3. **Cheap Gate Typecheck Hygiene** (typecheck/gate — may touch scripts/config).
4. **Initiative-Project-Task Hierarchy** (schema/cli — can run in parallel with test plans if no file overlap).
5. **Agent field and domain-to-docs rename** — only if you confirm the draft is not duplicate; otherwise cancel.
6. **Fix Test File Errors**, **Query builder audit**, **run_dolt_backed_tests**, **update docs**, **Test Plan** — order by dependency or priority as needed.

No `blocks` edges are proposed here; add them only if you want to enforce order in the graph.

---

## 5. Proposed edges and notes (do not apply without approval)

- **No edges** are proposed in this run. The only draft↔draft conflict is **bunfig.toml** (Integration Test Speed vs Integration Test Isolation). If you want to encode order, say "apply blocks" and specify which plan should block the other (e.g. "Integration Test Isolation blocks Integration Test Speed on bunfig.toml").
- **Suggested note (optional):** On one task in **Integration Test Speed - Process Elimination** or **Integration Test Isolation Improvements**: _"Shared file bunfig.toml with plan 'Integration Test Isolation Improvements' / 'Integration Test Speed - Process Elimination'; coordinate or run one plan before the other."_

---

## 6. Summary

| Pattern         | Among draft plans                                                       | Action                                                                   |
| --------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| File conflicts  | 1 file (bunfig.toml) shared by 2 draft plans                            | Optional `blocks` or explicit ordering; optional task note               |
| Domain clusters | None (only one draft in multi-plan domains)                             | None                                                                     |
| Architectural   | Integration test plans overlap; draft "Agent field..." may be duplicate | Order or merge integration test plans; confirm or cancel duplicate draft |
| Ordering        | Suggested sequence above                                                | Optional; no edges written unless you approve                            |

**Next step:** Reply with "apply" and what to add (e.g. one `blocks` edge, one note), or "cancel draft X" to soft-cancel a plan. Nothing will be written to the task graph without your approval.
