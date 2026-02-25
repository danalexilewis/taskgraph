Agent operating loop

- Always begin with: tg next --limit 5 and choose the top runnable task.
- Before coding: tg show <taskId> and restate:
  - intent
  - scope in/out
  - acceptance checks
- Then: tg start <taskId>
- Execute exactly within scope.
- When done: tg done <taskId> --evidence "..." including:
  - tests run
  - commands output summary
  - git commit hash(es)

When blocked

- If blocked by missing prerequisite, run:
  - tg block <taskId> --on <blockerTaskId> --reason "..."
- If blocker does not exist:
  - create a new task with owner=human and status todo, then block on it.

Decisions

- If a decision is required to proceed:
  - create a task: “Decide: …” with owner=human
  - add a decision_needed event with options + recommendation
  - stop and ask for approval

Safe graph edits the agent may do without asking

- status transitions (todo→doing→done, blocked when real blocker exists)
- add a dependency when it’s objectively required (“API endpoint must exist before UI integration”)
- split a task when it exceeds ~90 minutes, keeping scope and acceptance intact

Everything else is proposal-only.
