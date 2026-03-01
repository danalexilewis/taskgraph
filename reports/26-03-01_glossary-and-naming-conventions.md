# Glossary and Naming Conventions Setup

**Date:** 2026-03-01  
**Scope:** Establishment of a single source of truth for Task Graph terminology and wiring it into AGENT.md and the documentation sync process.  
**Produced by:** Orchestrator (report skill).

---

## What was done

| Action                        | File(s)                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------- |
| Created glossary              | `docs/glossary.md`                                                           |
| Pointed agents at glossary    | `AGENT.md` — added "Naming and definitions" block                            |
| Listed glossary in doc index  | `docs/README.md`                                                             |
| Made glossary source of truth | `.cursor/rules/docs-sync.mdc` — added to Source of Truth and Update Triggers |
| Linked from agent contract    | `docs/agent-contract.md` — added glossary link in canonical-source line      |

## Glossary contents

- **Plan vs project** — Plan = markdown in `plans/` (pre–task graph). Project = task-graph entity after import. Table with definition, location, CLI/API. Note that during plan→project rename some CLI/docs may still say "plan" where they mean "project".
- **Execution and workflow** — Wave, task, blocked, evidence, sub-agent, orchestrator. Explicit convention: use "wave" (not "phase") for execution groupings.
- **Task graph and data** — Task graph, edge, event, initiative, soft-delete.
- **Validation and quality** — Gate, cheap gate, changed-files default.
- **Other** — Cursor format, worktree, MCP.
- **Updating this glossary** — Short maintenance section: new term → add entry and cross-link; renamed concept → glossary first, then docs/code.

## Implications

- New or renamed terms should be added to `docs/glossary.md` first; docs-sync rule now triggers on "New or renamed term, naming convention, or definition."
- Plan-to-project rename plan and future terminology work can reference the glossary as the target convention; the glossary already reflects plan vs project and waves.
- Template (`src/template/`) does not yet include the glossary; that can be done in the plan-to-project rename's update-templates task.

## Recommendations

1. **When doing the plan→project rename** — Use the glossary as the authority; update the glossary if any new terms emerge (e.g. deprecated alias behavior).
2. **When adding new concepts** — Add a glossary entry and link from AGENT.md or agent-contract if user/agent facing.
3. **Optional** — Add a minimal glossary (or link to it) to `src/template/docs/` when updating templates so consuming projects get consistent terminology.

---

## Summary

A single glossary (`docs/glossary.md`) now defines plan vs project, waves, and other core terms. AGENT.md and docs-sync point agents and maintainers at it; the doc index and agent contract link to it. Terminology changes should update the glossary first, then align other docs.
