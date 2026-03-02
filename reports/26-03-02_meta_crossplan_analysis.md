# Meta: Cross-Plan Enrichment Analysis

**Date:** 2026-03-02  
**Source:** `pnpm tg crossplan summary --json` + `tg status --projects` / `tg status --tasks`  
**Scope:** Cross-plan (current project). **Applied 2026-03-02:** Option A (3 relates edges) + 3 task notes (see bottom).

---

## 1. Active and draft projects (outstanding work)

Filtered to projects with todo, doing, or blocked tasks (relevant for enrichment):

| Project                                                        | Status | Todo | Doing | Blocked | Done |
| -------------------------------------------------------------- | ------ | ---- | ----- | ------- | ---- |
| Integration Test Isolation Improvements                        | active | 2    | 0     | 4       | 3    |
| Per-plan Worktree Model                                        | active | 0    | 0     | 1       | 9    |
| Performance Intelligence                                       | active | 0    | 0     | 1       | 11   |
| Gate Full Triage                                               | active | 2    | 0     | 0       | 2    |
| Perf Audit Remediation — Test Infra, Schema Indexes, CLI Speed | active | 1    | 0     | 5       | 5    |
| Benchmark Schema and Import                                    | active | 0    | 0     | 1       | 3    |
| AgentDex and Agents (discovered)                               | draft  | 3    | 0     | 3       | 0    |
| CLI Smoke Benchmark                                            | draft  | 1    | 0     | 2       | 0    |
| Custom Benchmark Suite (Option C)                              | draft  | 1    | 0     | 5       | 0    |
| Default Daily Initiative                                       | draft  | 2    | 0     | 6       | 0    |
| Doc Review Benchmark                                           | draft  | 3    | 0     | 0       | 0    |

---

## 2. Domain clusters (cross-plan)

Domains shared across many plans (from crossplan summary). High overlap suggests coordination or sequential execution to avoid merge conflicts.

| Domain                    | Plan count | Task count | Notes                                                                                             |
| ------------------------- | ---------- | ---------- | ------------------------------------------------------------------------------------------------- |
| testing                   | 11         | 18         | Integration Test Isolation, Gate Full\*, Perf Audit, Benchmark plans all touch tests.             |
| schema                    | 9          | 23         | Benchmark Schema and Import, DAL Query Cache, Initiative-Aware, Hivemind, Per-plan Worktree, etc. |
| cli-reference             | 7          | 13         | CLI Smoke, Doc Review, Hivemind, Performance Intelligence, tg server, etc.                        |
| infra                     | 5          | 10         | DAL Query Cache, Gate Full Remediation, Git Workflow, Sub-Agent Execution Performance             |
| multi-agent               | 4          | 11         | Git Workflow, Per-plan Worktree, Performance Intelligence, tg server                              |
| plan-import / plan-format | 4 each     | 10 / 8     | Initiative-Aware, Hivemind, Benchmark Schema, Strategic Planning                                  |

**Recommendation:** For any two active/draft plans that share a domain (e.g. schema, testing), consider adding a **relates** edge between one representative task in each plan, or a **task note** on one task: “Coordinate with [other plan] — same domain (schema/testing/…).”

---

## 3. File overlaps (conflict risk)

Files touched by multiple plans (from crossplan summary; tree prefixes stripped where obvious):

| File / area               | Plans (count) | Plans                                                                            |
| ------------------------- | ------------- | -------------------------------------------------------------------------------- |
| SKILL.md                  | 5             | AgentDex, Default Daily, Hivemind, Initiative-scoped analyst, Strategic Planning |
| import.ts                 | 3             | Initiative-Aware, Strategic Planning, Benchmark Schema and Import                |
| parser.ts                 | 2 each        | Initiative-Aware / Strategic Planning; Hivemind / Benchmark Schema               |
| importer.ts               | 2             | Initiative-Aware, Strategic Planning                                             |
| plan-format.md, schema.md | 2–3           | Initiative-Aware, Hivemind, Benchmark Schema, Strategic Planning                 |
| global-setup.ts           | 2             | Report Follow-up…, Integration Test Isolation                                    |
| cli-reference.md          | 2             | Hivemind, tg server                                                              |

**Recommendation:** Tasks that touch `parser.ts`, `importer.ts`, or `import.ts` across Initiative-Aware, Strategic Planning, and Benchmark Schema should be ordered or coordinated (relates or blocks) to avoid conflicting edits. Same for SKILL.md across the five listed plans.

---

## 4. Execution tier ordering (recommended)

Suggested ordering for execution to reduce noise and conflicts:

- **Tier 1 — Gate health:** Gate Full Triage, Integration Test Isolation Improvements, Gate Full Remediation (fix tests / isolation first).
- **Tier 2 — Gate:full verifications:** Any plan whose last task is “Run gate:full” should run after Tier 1 so the suite is green.
- **Tier 3 — Schema / CLI / core refactors:** Benchmark Schema and Import, Default Daily Initiative, Initiative-Aware Plan Ingestion, Per-plan Worktree Model, DAL Query Cache, Performance Intelligence, tg server.
- **Tier 4 — Validators:** Doc Review Benchmark, CLI Smoke Benchmark, Custom Benchmark Suite (Option C) (assert on docs, CLI, and benchmarks after Tier 3 stabilizes).

No edges are proposed here; this is an ordering recommendation only. You can encode it with **blocks** edges (e.g. “fix task in Gate Full Triage blocks gate:full task in Default Daily Initiative”) if you want the graph to enforce it.

---

## 5. Proposed edges (curated; require your approval)

The crossplan summary produced **302** mechanical `relates` proposals (domain/file overlap). Per lead doc, we do **not** propose all of them. Below is a **small, high-signal subset** you can apply if you approve. Task IDs are **UUIDs**; the CLI accepts both UUID and short id (`tg-xxxxxx`). Resolve with `tg show <uuid>` if you want short ids.

**Option A — Add a few cross-plan relates (domain clusters)**  
Pick 3–5 pairs from the same domain that span different plans (e.g. schema, testing). Example form:

```bash
pnpm tg edge add <from_task_id> relates <to_task_id> --reason "domain: schema"
```

Example (from summary; confirm task titles with `tg show` before applying):

| From (UUID)                          | Type    | To (UUID)                            | Reason                |
| ------------------------------------ | ------- | ------------------------------------ | --------------------- |
| 026907ee-df55-4c80-8b11-24fcf476e463 | relates | 03d120c7-b1c1-4dc5-815e-2b934e1c6f7f | domain: schema        |
| 03d120c7-b1c1-4dc5-815e-2b934e1c6f7f | relates | 0b187e11-ee51-4e9c-8968-c29cd05306d9 | domain: cli-reference |
| 05e62674-8b66-43e6-be3d-9294541f2626 | relates | 17201786-ab9a-401b-8203-80cd23f5015f | domain: testing       |

**Option B — Gate:full readiness (blocks)**  
If you have a “Run gate:full” task in one plan and a “fix tests” task in Gate Full Triage (or Integration Test Isolation), add:

```bash
pnpm tg edge add <fix_task_id> blocks <gate_full_task_id> --reason "gate must be green before final gate:full run"
```

(Resolve task IDs from `tg status --tasks` or `tg next --plan "Default Daily Initiative" --json` etc.)

---

## 6. Proposed task notes (require your approval)

Suggested notes to add with `pnpm tg note <taskId> --msg "..."` for coordination. Replace `<taskId>` with the concrete task (e.g. from `tg next --plan "..." --json`).

- On one **Benchmark Schema and Import** task that touches schema/parser:  
  `Consider sequential execution with Initiative-Aware Plan Ingestion / Strategic Planning — shared parser/import surface.`
- On one **Integration Test Isolation** task that touches `global-setup.ts`:  
  `Shared file with Report Follow-up plan; coordinate to avoid merge conflicts.`
- On one **Doc Review Benchmark** or **CLI Smoke Benchmark** task:  
  `Run after CLI/schema-heavy plans (Default Daily, Hivemind, tg server) so docs and smoke tests assert current behavior.`

---

## 7. Applied (2026-03-02)

**Edges added (Option A):**

- `026907ee-df55-4c80-8b11-24fcf476e463` relates `03d120c7-b1c1-4dc5-815e-2b934e1c6f7f` (domain: schema)
- `03d120c7-b1c1-4dc5-815e-2b934e1c6f7f` relates `0b187e11-ee51-4e9c-8968-c29cd05306d9` (domain: cli-reference)
- `05e62674-8b66-43e6-be3d-9294541f2626` relates `17201786-ab9a-401b-8203-80cd23f5015f` (domain: testing)

**Blocks added (gate:full readiness):**  
Fix task **tg-95e850** (Gate Full Triage — "Fix 4 pre-existing failing assertions in status.test.ts") now **blocks** these gate:full / run-full-suite tasks so the suite is green before their final run:

- **tg-d65da1** (Default Daily Initiative — Run gate:full and verify all changes pass)
- **tg-dfc66b** (Benchmark Schema and Import — Run full test suite (pnpm gate:full))
- **tg-c92ff5** (Per-plan Worktree Model — Run full test suite (gate:full) to validate)
- **tg-5393bb** (Initiative-Aware Plan Ingestion — Run full test suite (pnpm gate:full))
- **tg-ff2572** (Git Workflow Tidy-Up — Run gate:full from plan worktree)

**Notes added:**

- **tg-8dc9f1** (Benchmark Schema and Import — Parser and import set): "Consider sequential execution with Initiative-Aware Plan Ingestion / Strategic Planning — shared parser/import surface."
- **tg-b65436** (Integration Test Isolation — Log warning when migrations are skipped): "Shared file with Report Follow-up plan; coordinate to avoid merge conflicts."
- **tg-76a9dc** (Doc Review Benchmark — Review docs/cli-reference.md): "Run after CLI/schema-heavy plans (Default Daily, Hivemind, tg server) so docs and smoke tests assert current behavior."
