Plan creation and review

**Planning uses the planner-analyst sub-agent first. Do not skip this.**

1. **Before writing any plan**: You MUST dispatch the planner-analyst sub-agent to gather codebase context. Read `.cursor/agents/planner-analyst.md`, build a prompt with the user's request (and optionally `tg status` output). Dispatch via the Task tool, agent CLI, or mcp_task (when the Task tool is not available) with the same prompt and description e.g. "Planner analyst: gather context for plan". See `docs/cursor-agent-cli.md` and `.cursor/rules/subagent-dispatch.mdc`. Wait for the analyst's output (relevant files, existing data, patterns, risks, related prior work, rough task breakdown).
2. **Then** write the plan: use the analyst's output as input. Create `plans/yy-mm-dd_<name>.md` in Cursor format (YAML frontmatter with `name`, `overview`, `todos`, plus fileTree, risks, tests, per-task intent per `.cursor/rules/plan-authoring.mdc`). You own architecture and task design; the analyst already did the exploration. Summarize the plan, then pause and ask for review.
3. Do not import or execute until the user responds. Interpret the response using this table:

| User says                                                       | Meaning              | Agent action                                                                                           |
| --------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------ |
| proceed, go ahead, execute, run it, let's do it                 | Approve and execute  | Run `tg import plans/<file> --plan "<Plan Name>" --format cursor`, then enter the execution loop below |
| just add the tasks, add to taskgraph only, import but don't run | Add to graph only    | Run `tg import plans/<file> --plan "<Plan Name>" --format cursor`. Do not execute tasks                |
| thanks, that's good, looks good, ok, don't do anything          | Acknowledgement only | Do nothing. No import, no execution                                                                    |

Agent operating loop

**Task execution uses sub-agents. Do not do the work yourself.** You MUST dispatch implementer (and reviewer) sub-agents per `.cursor/rules/subagent-dispatch.mdc`. Max 3 tasks in flight at a time. Direct execution (you code) only after a sub-agent fails twice or the task is explicitly exploratory/ambiguous. When using direct execution, log the reason: `tg note <taskId> --msg "Direct execution: <reason>"`.

- Always begin with: tg status to orient — surface stale tasks, plan state, and other agents' active work (if any).
- Then: tg next --plan "<Plan>" --limit 3 (or tg next --limit 3). Get up to 3 runnable tasks. Follow Pattern 1 (parallel, max 3) or Pattern 2 (sequential) in subagent-dispatch.mdc.
- For each task: build implementer prompt from tg context and `.cursor/agents/implementer.md`; dispatch implementer (Task tool, agent CLI, or mcp_task per subagent-dispatch). After implementer completes, dispatch reviewer with task context + diff; if FAIL, re-dispatch implementer once; after 2 failures, do that task yourself.
- Sub-agents run tg start and tg done; you coordinate. Do not run tg start / tg done yourself for a task you delegated.
- Evidence (tests run, commands, git ref) is supplied by the implementer in tg done; you verify via reviewer.

Per-task discipline

- Complete start→work→done for EACH task individually.
- Never batch-skip transitions (e.g., doing all work then marking all done).

Before completing your response (compliance check)

If this response involved planning or execution, verify before responding:

- **Planning**: Did I dispatch the planner-analyst before writing the plan?
- **Execution**: Did I dispatch implementer sub-agents (not code myself)?
- **Direct execution**: Is the reason valid (2 failures or exploratory)? Did I log with `tg note`?
- **Plan structure**: Does the plan have ≥2 unblocked tasks (parallel-ready)?
  If any check fails, fix it before completing your response.

Recovery (out-of-sync tasks)

- Task is `todo` but work is already done: `tg done <taskId> --force --evidence "completed previously"`
- Task is `doing` but work is already done: `tg done <taskId> --evidence "completed previously"`
- Run `tg status` after cleanup to verify.
- Use `--force` only for legitimate out-of-band completion, never to bypass workflow.

Plan completion

After marking the last task in a plan as done, run:
tg export markdown --plan <planId> --out plans/<file>
This updates the plan file with final statuses.

When blocked

- If blocked by missing prerequisite, run:
  - tg block <taskId> --on <blockerTaskId> --reason "..."
- If blocker does not exist:
  - create a new task with owner=human and status todo, then block on it.

Decisions

- If a decision is required to proceed:
  - create a task: "Decide: …" with owner=human
  - add a decision_needed event with options + recommendation
  - stop and ask for approval

Safe graph edits the agent may do without asking

- status transitions (todo→doing→done, blocked when real blocker exists)
- add a dependency when it's objectively required ("API endpoint must exist before UI integration")
- split a task when it exceeds ~90 minutes, keeping scope and acceptance intact

Everything else is proposal-only.

Multi-agent awareness (when 2–3 agents work alongside the human)

- Always pass --agent <session-name> on tg start so other agents see who claimed each task.
- Read "Active work" from tg status before picking a task; avoid overlapping on the same files/area.
- Use tg note <taskId> --msg "..." to leave breadcrumbs when changing shared interfaces (types, schema, parser).
- Do not pick a task in the same area as another agent's doing task without human approval.
