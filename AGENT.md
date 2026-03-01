**Agent architecture:** See [docs/agent-strategy.md](docs/agent-strategy.md) for the canonical agent architecture doc.

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

**Task execution uses sub-agents. Do not do the work yourself.** You MUST dispatch implementer (and reviewer) sub-agents per `.cursor/rules/subagent-dispatch.mdc`. Feed all runnable, non-conflicting tasks; Cursor decides how many run in parallel. Direct execution (you code) only after a sub-agent fails twice or the task is explicitly exploratory/ambiguous. When using direct execution, log the reason: `tg note <taskId> --msg "Direct execution: <reason>"`.

**Task orchestration UI**: You MUST call TodoWrite with the task list from tg next before dispatching sub-agents (this triggers Cursor's orchestration panel). Update TodoWrite statuses as tasks complete. When dispatching a batch of N tasks, emit N Task (or mcp_task) calls in the same turn. See .cursor/rules/subagent-dispatch.mdc for the full protocol.

- Always begin with: tg status to orient — surface stale tasks, plan state, and other agents' active work (if any).
- Then: tg next --plan "<Plan>" --limit 20 (or tg next --limit 20). Get runnable tasks; include all that don't share files. Follow Pattern 1 (parallel batch) or Pattern 2 (sequential) in subagent-dispatch.mdc. Cursor decides concurrency.
- For each task: build implementer prompt from tg context and `.cursor/agents/implementer.md`; dispatch implementer (Task tool, agent CLI, or mcp_task per subagent-dispatch). After implementer completes, dispatch reviewer with task context + diff; if FAIL, re-dispatch implementer once; after 2 failures, do that task yourself or escalate to the **fixer** (see Escalation below).
- Sub-agents run tg start and tg done; you coordinate. Do not run tg start / tg done yourself for a task you delegated.
- Evidence is supplied by the implementer in tg done: "commands run, git ref" or "implemented; no test run" (implementers are not expected to report tests run). For the final run-full-suite task: "gate:full passed" or "gate:full failed: <summary>". You verify via reviewer.

Escalation ladder

- **Re-dispatch** → **Direct execution** (orchestrator) → **Fixer** (stronger model) → **Escalate to human**. Use the **escalation decision tree** in `.cursor/rules/subagent-dispatch.mdc` to choose. When to escalate to human: credentials/secrets, ambiguous intent, safety/approval, or repeated direct-execution failure. When implementer (or reviewer) has failed twice, the orchestrator may complete the task itself (direct execution) or dispatch the **fixer** sub-agent (`.cursor/agents/fixer.md`) with failure feedback and diff; the fixer uses a stronger model to resolve the task.

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

- Task is `todo` but work is already done: `tg done <taskId> --force --evidence "completed previously"` (or "gate:full run by human" if applicable)
- Task is `doing` but work is already done: `tg done <taskId> --evidence "completed previously"` (or "gate:full run by human" if applicable)
- Run `tg status` after cleanup to verify.
- Use `--force` only for legitimate out-of-band completion, never to bypass workflow.

Plan completion

After marking the last task in a plan as done, run:
tg export markdown --plan <planId>
This updates the plan file with final statuses.

When blocked

- If blocked by missing prerequisite, run:
  - tg block <taskId> --on <blockerTaskId> --reason "..."
- If blocker does not exist:
  - create a new task with owner=human and status todo, then block on it.

Data safety (task graph)

- Never run DELETE, DROP TABLE, or TRUNCATE on the task graph database. Use `tg cancel <planId|taskId> --reason "..."` for soft-delete (plan→abandoned, task→canceled). See `.cursor/rules/no-hard-deletes.mdc`.

Validation pipeline (development)

- **Bun is required for development** as the test runner. Vitest is no longer used.
- **Pipeline order**: (1) `biome check` — lint/format on `src/`, `__tests__/`, `scripts/`; (2) typecheck (default: changed files only); (3) targeted tests (affected by changed files) or full test suite.
- **Changed-files default**: Typecheck and tests default to **changed files** (git). Unmodified code is assumed already validated. Use `pnpm typecheck:all` or `pnpm gate:full` for full repo. See `.cursor/rules/changed-files-default.mdc`.
- **cheap-gate.sh** (`pnpm gate`): runs biome → typecheck (changed) → affected tests. Use for pre-commit or CI quick check; sub-agents use this.
- **Full suite** (`pnpm gate:full` or `bash scripts/cheap-gate.sh --full`): same lint + full typecheck + `bun test __tests__`. Use before release or when validating the whole codebase.
- **Manual steps**: `pnpm lint` / `pnpm lint:fix`, `pnpm typecheck` (changed) or `pnpm typecheck:all`, `bun test __tests__` (or `pnpm test` / `pnpm test:integration` / `pnpm test:all` per package.json).

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

- **Worktrunk for sub-agent worktrees:** When delegating to implementers, use worktree isolation so each task has its own directory. **Worktrunk (wt)** is the standard backend: set `"useWorktrunk": true` in `.taskgraph/config.json` or ensure `wt` is on PATH (auto-detect). Use `tg start <taskId> --agent <name> --worktree`; pass the worktree path (from `tg worktree list --json` or the started event) to the implementer as **WORKTREE_PATH** so they run all work and `tg done` from that directory. See .cursor/rules/subagent-dispatch.mdc.
- Always pass --agent <session-name> on tg start so other agents see who claimed each task.
- Read "Active work" from tg status before picking a task; avoid overlapping on the same files/area.
- Use tg note <taskId> --msg "..." to leave breadcrumbs when changing shared interfaces (types, schema, parser) or discovering anything relevant beyond the current task's scope. Notes are the cross-dimensional transmission between introspective (single-task) and connective (multi-task) agent perspectives. See docs/agent-strategy.md.
- Do not pick a task in the same area as another agent's doing task without human approval.
