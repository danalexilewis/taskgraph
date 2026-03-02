# Evolve: Merge conflict handling — 2026-03-02

**Scope:** Patterns extracted from resolving merge conflicts in commit `0d2be2a` (Merge origin/main: dashboard look fix and upstream changes). Two files had conflicts (MM): `docs/infra.md`, `src/cli/index.ts`.

---

## Conflict summary

| File | Local (ours) | Remote (theirs) | Resolution |
|------|--------------|-----------------|------------|
| `docs/infra.md` | Added "Dolt Binary Setup", "tg server commands", "Multi-user / Docker notes" before "## Dolt" | Added "Optimising gate:full" after Validation pipeline; added Environment variables table and Decisions | **Combined both**: local's Dolt/server sections + remote's gate:full + shared Dolt content + remote's env table and Decisions, in coherent order |
| `src/cli/index.ts` | `await detectAndApplyServerPort(...)`; `process.exit(0)` on success | `detectAndApplyServerPort(...)` (no await); `process.exitCode = 0` on success | **Semantic merge**: kept `await` (local — correct async) and `process.exitCode = 0` (remote — avoids stdout flush race) |

---

## Findings

| Category | Pattern | File | Routed to |
|----------|---------|------|-----------|
| Scope / discipline | Docs conflict: each side added distinct sections; resolution combined both in logical order instead of dropping one side | docs/infra.md | agent-utility-belt.md § Merge conflict resolution |
| Error handling / correctness | Code conflict: both sides had different correctness fixes; resolution kept both (await + exitCode) instead of choosing ours/theirs | src/cli/index.ts | agent-utility-belt.md § Merge conflict resolution; implementer.md § Learnings |

---

## Learnings written

- **agent-utility-belt.md** — New section "Merge conflict resolution": 2 entries (docs: combine both; code: semantic merge, keep both fixes).
- **implementer.md § Learnings** — 1 entry: when resolving code conflicts, keep correctness from both sides; do not take ours/theirs blindly.

---

## Durable patterns (suggest doc update)

- **Optional:** Add a short "Merge conflict resolution" subsection to `docs/agent-contract.md` or `docs/multi-agent.md` when worktree/plan-merge flows are documented, referencing: (1) combine additive doc sections from both branches; (2) for code, semantic merge — preserve each branch’s correctness fix; (3) for plan-branch rebase onto main, existing report (initiative-project-task-hierarchy-execution) documents "theirs for code/docs, ours for .taskgraph/dolt". No change made this run; utility belt and implementer learnings suffice for now.

---

## Reference

- Merge commit: `0d2be2a` (Merge origin/main: dashboard look fix and upstream changes). Parents: `78288a6` (local — Dolt hardening, dashboard), `0562184` (origin/main — grouped commits g1–g6).
- Related: `reports/initiative-project-task-hierarchy-execution-2026-03-02.md` (different scenario — rebase from plan worktree; resolution rule: theirs code/docs, ours .taskgraph/dolt).
