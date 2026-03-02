# Lead: Reprioritise

## Purpose

Reviews which projects are active and whether that set is right. Produces a linear prioritised project list and ensures at least 10 Ready (runnable) tasks by updating priority order or activating only the tasks needed. Orchestrator performs the review and any updates directly; no sub-agents.

## Skill and agents

- **Skill:** reprioritise (`.cursor/skills/reprioritise/SKILL.md`)
- **Agent files:** None (orchestrator direct)

## Pattern

1. **Gather** — `tg status --projects`, `tg status --tasks`, `tg next --json` to get active plans, task counts, and runnable tasks.
2. **Count Ready** — Total runnable tasks across active plans. Target: ≥ 10.
3. **Adjust if needed** — If Ready < 10, decide what to activate or reorder; apply only the changes needed to reach the target.
4. **Answer** — "Are these the right projects to be active?" with brief justification.
5. **Output** — Linear prioritised list of projects (1..N) and summary of actions taken.

## Input

- Current status (fetched via CLI)
- Optional: initiatives or strategic context from sitrep

## Output

- Reprioritise report: answer to "right projects?", prioritised project list, Ready count before/after, actions taken.

## When to use

- User says "reprioritise", "review priorities", "are these the right projects", or wants to reassess active work mix.
- After status or sitrep when prioritisation should be checked.

## Dashboard / taskboard alignment

- Projects board (dashboard): max **5** projects shown.
- Taskboard (Active tasks and upcoming): min **6** rows shown.

The lead’s list and actions align with these limits so the dashboard reflects the prioritised view.
