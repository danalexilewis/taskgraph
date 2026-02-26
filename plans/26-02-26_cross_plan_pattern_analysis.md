---
name: Cross-Plan Pattern Analysis
overview: |
  Pattern-tasks analysis of cross-plan file conflicts, domain clusters, and execution ordering. Proposes blocks/relates edges and task notes; apply only with explicit user approval.
fileTree: |
  plans/26-02-26_cross_plan_pattern_analysis.md   (create)
risks:
  - description: Applying edges without approval can create incorrect dependencies
    severity: medium
    mitigation: Never write to Dolt without user approval; present proposals first
tests: []
todos:
  - id: apply-approved-edges
    content: Apply approved cross-plan edges and notes (tg edge add / tg note per user approval)
    intent: |
      After user approves specific proposals from this analysis, run tg edge add for blocks/relates and tg note for task notes. Do not apply any proposal without explicit approval.
    domain: cli
    skill: cli-command-implementation
    changeType: document
    status: pending
isProject: false
---

## 1. File conflicts (blocks edges)

Tasks from different plans touch the same files; ordering matters.

### A. `src/cli/start.ts` + `src/cli/done.ts` — 3 plans

| Plan                       | Task ID    | What it does to start/done                                        |
| -------------------------- | ---------- | ----------------------------------------------------------------- |
| **Short Hash Task IDs**    | `1c993f01` | Create hash-id generation module — changes ID resolution          |
| **Dolt Branch Per Agent**  | `8ec38869` | Create Dolt branch management module — changes commit target      |
| **Git Worktree Isolation** | `c904638b` | Create git worktree management module — changes working directory |

Short Hash changes how IDs are parsed; Branch and Worktree layer on top. So Short Hash should land first.

**Proposed blocks:**

| #   | From (first)                          | To (blocked)                             | Rationale                                                       |
| --- | ------------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| 1   | `1c993f01` Short Hash: hash-id module | `8ec38869` Dolt Branch: branch module    | ID resolution must land before branch management in start/done  |
| 2   | `1c993f01` Short Hash: hash-id module | `c904638b` Git Worktree: worktree module | ID resolution must land before worktree isolation in start/done |

### B. `src/db/migrate.ts` + `src/domain/types.ts` — 2 plans

| Plan                    | Task ID    | Change                                      |
| ----------------------- | ---------- | ------------------------------------------- |
| **External Gates**      | `f2e49f41` | Add gate table migration                    |
| **Short Hash Task IDs** | `1c993f01` | Hash-id column on task (via hash-id module) |

Both add to migrate.ts and types.ts. Independent features but avoid parallelizing.

**Proposed relates + notes:**

| #   | Type    | From                                 | To                                    | Rationale                           |
| --- | ------- | ------------------------------------ | ------------------------------------- | ----------------------------------- |
| 3   | relates | `f2e49f41` External Gates: migration | `1c993f01` Short Hash: hash-id module | Both add to migrate.ts and types.ts |

**Proposed notes:**

- On `f2e49f41`: "Relates to Short Hash (1c993f01) — both add to src/db/migrate.ts and src/domain/types.ts. Do not run these two tasks in parallel."
- On `1c993f01`: "Relates to External Gates (f2e49f41) — both add to src/db/migrate.ts. Do not run these two tasks in parallel."

---

## 2. Domain clusters (relates edges)

### C. `.taskgraph/config.json` — 3 plans

| Plan                      | Task ID    | Config change            |
| ------------------------- | ---------- | ------------------------ |
| **Context Budget**        | `adc8c532` | Add context_token_budget |
| **Dolt Branch Per Agent** | `6c05f293` | Add useDoltBranches      |
| **Dolt Replication**      | `883e644d` | Add remote configuration |

| #   | Type    | From                              | To                                  | Rationale                      |
| --- | ------- | --------------------------------- | ----------------------------------- | ------------------------------ |
| 4   | relates | `adc8c532` Context Budget: config | `6c05f293` Dolt Branch: config      | Both modify config.json schema |
| 5   | relates | `6c05f293` Dolt Branch: config    | `883e644d` Dolt Replication: config | Both modify config.json schema |

### D. `docs/architecture.md` — 2 plans

| #   | Type    | From                                      | To                                             | Rationale                                               |
| --- | ------- | ----------------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| 6   | relates | `eb0ea94a` Dolt Branch: architecture docs | `e1ce67ec` Dolt Replication: architecture docs | Both add to docs/architecture.md; related Dolt concepts |

### E. `docs/schema.md` — 2 plans

| #   | Type    | From                                   | To                                 | Rationale                  |
| --- | ------- | -------------------------------------- | ---------------------------------- | -------------------------- |
| 7   | relates | `3755013c` External Gates: schema docs | `ef41ba96` Short Hash: schema docs | Both add to docs/schema.md |

### F. Agent isolation (architectural)

| #   | Type    | From                                  | To                                       | Rationale                                                               |
| --- | ------- | ------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| 8   | relates | `8ec38869` Dolt Branch: branch module | `c904638b` Git Worktree: worktree module | Both agent isolation mechanisms (DB vs filesystem); shared design space |

---

## 3. Summary table

| #   | Type       | From task                             | To task                                  | Rationale                               |
| --- | ---------- | ------------------------------------- | ---------------------------------------- | --------------------------------------- |
| 1   | **blocks** | `1c993f01` Short Hash hash-id module  | `8ec38869` Dolt Branch branch module     | ID resolution before branch management  |
| 2   | **blocks** | `1c993f01` Short Hash hash-id module  | `c904638b` Git Worktree worktree module  | ID resolution before worktree isolation |
| 3   | relates    | `f2e49f41` External Gates migration   | `1c993f01` Short Hash hash-id module     | Both add to migrate.ts and types.ts     |
| 4   | relates    | `adc8c532` Context Budget config      | `6c05f293` Dolt Branch config            | Both modify config.json                 |
| 5   | relates    | `6c05f293` Dolt Branch config         | `883e644d` Dolt Replication config       | Both modify config.json                 |
| 6   | relates    | `eb0ea94a` Dolt Branch architecture   | `e1ce67ec` Dolt Replication architecture | Both add to architecture.md             |
| 7   | relates    | `3755013c` External Gates schema docs | `ef41ba96` Short Hash schema docs        | Both add to schema.md                   |
| 8   | relates    | `8ec38869` Dolt Branch branch module  | `c904638b` Git Worktree worktree module  | Both agent isolation mechanisms         |

**Notes (2):** On `f2e49f41` and on `1c993f01` — "Do not run these two tasks in parallel" (migrate.ts / types.ts).

---

## 4. Execution ordering (recommendations)

1. **Short Hash Task IDs first** — ID resolution is foundational for start/done/CLI.
2. **External Gates** — independent schema; coordinate with Short Hash on migrate.ts (separate sessions).
3. **Dolt Branch Per Agent** — after Short Hash; adds DB isolation.
4. **Git Worktree Isolation** — after Short Hash; adds FS isolation.
5. **Context Budget, Task Templates, Two-Stage Review, Meta-Planning Skills** — largely independent; safe to parallelize.
6. **Dolt Replication** — related to Dolt Branch conceptually; technically independent.
7. **TaskGraph MCP Server, Persistent Agent Stats** — independent; safe anytime.

---

## Applying proposals

**Do not write to Dolt without user approval.** To apply after approval:

- **blocks / relates:** `pnpm tg edge add <fromTaskId> <toTaskId> --type blocks|relates`
- **Notes:** `pnpm tg note <taskId> --msg "..."`

<original_prompt>
/pattern-tasks — add this to the plans folder
</original_prompt>
