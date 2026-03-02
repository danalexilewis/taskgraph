---
name: reprioritise
description: Reviews priority of active work by examining active projects and asking "are these the right projects to be active". Produces a linear prioritised project list, ensures at least 10 Ready (runnable) tasks, and updates order or activates tasks as needed. Use when the user says "reprioritise", "review priorities", "are these the right projects", or when prioritisation or active-project mix should be reassessed.
---

# Reprioritise

**Lead documentation:** See [docs/leads/reprioritise.md](../../docs/leads/reprioritise.md).

When this skill is invoked, run reprioritise: review which projects are active, decide if that mix is right, produce a linear priority order, and ensure enough runnable work (Ready tasks).

## When to use

- User says **reprioritise**, **review priorities**, **are these the right projects**, or **reprioritise work**.
- User wants to reassess which projects should be active or how work is ordered.
- After a sitrep or status check when someone asks whether the current active set is correct.

## Architecture

- **Orchestrator** runs reprioritise directly (no sub-agent dispatch). Read-write: can propose or apply priority changes and activate tasks/plans as needed.
- **Data sources:** `tg status --projects`, `tg status --tasks`, `tg next --json` (to count runnable tasks and see which plans they belong to).

## Permissions

- **Orchestrator:** read-write (reads status/next; may update priority order or activate tasks to meet the Ready-task target).
- **Propagation:** Orchestrator only; no sub-agents.

## Decision tree

```mermaid
flowchart TD
    R["/reprioritise or trigger"] --> A[Fetch tg status --projects, --tasks, tg next --json]
    A --> B[Count Ready (runnable) tasks]
    B --> C{Ready >= 10?}
    C -->|Yes| D[Review: are these the right active projects?]
    C -->|No| E[Build linear priority list; identify tasks to activate]
    E --> F[Update order / activate tasks so Ready >= 10]
    F --> D
    D --> G[Produce linear prioritised project list]
    G --> H[Output: list + any actions taken]
```

## Workflow

1. **Gather state**
   - Run `tg status --projects` and `tg status --tasks` (or equivalent JSON).
   - Run `tg next --json --limit 50` to get runnable (Ready) tasks and their plans.
   - Count total runnable tasks across all active plans.

2. **Apply target**
   - **Target:** At least **10** tasks in Ready (runnable). The number of projects treated as "active" is driven by having enough runnable work.
   - If Ready < 10: decide which additional tasks (or plans) to activate or unblock so that runnable count reaches at least 10. Update priority order or task/plan state as needed (e.g. via notes, unblock, or plan ordering) and only activate what is needed.

3. **Answer the question**
   - Explicitly answer: "Are these the right projects to be active?" Use the current active set and strategic context (initiatives, goals, staleness) to justify.

4. **Produce output**
   - A **linear prioritised list of projects** (ordered 1..N), with a one-line rationale per position if helpful.
   - Summary of actions taken (if any): what was reordered or activated to meet the Ready ≥ 10 target.
   - Optional: suggest dropping or pausing projects that should not be active.

## Dashboard and taskboard limits (reference)

- **Projects board** (dashboard): shows a **maximum of 5** projects (Active Projects section).
- **Taskboard** (Active tasks and upcoming): shows a **minimum of 6** rows (padded if fewer tasks).

These limits are enforced in the CLI/dashboard so reprioritise output aligns with what users see: few projects on the board, enough task rows to see pipeline.

## Output format

Use this structure when reporting:

```markdown
# Reprioritise report

## Are these the right projects?

[One paragraph: yes/no and why.]

## Prioritised project list

1. [Plan A] — [brief rationale]
2. [Plan B] — ...
   ...

## Ready count

- Before: N runnable
- Target: ≥ 10
- After: N runnable [and any actions taken]

## Actions taken

- [None | Reordered ... | Activated task(s) ... ]
```

## See also

- [docs/leads/reprioritise.md](../../docs/leads/reprioritise.md) — lead purpose and pattern.
- [docs/leads/README.md](../../docs/leads/README.md) — lead registry.
- `.cursor/rules/available-agents.mdc` — reprioritise in agent registry and skills table.
