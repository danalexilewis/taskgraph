# Sub-Agent Definitions

**Leads vs workers:** Some agents are **leads** (orchestration from skills; e.g. planner-analyst, investigator); others are **workers** (task-level execution; e.g. implementer, reviewer). See [docs/leads/README.md](../docs/leads/README.md).

This directory contains **prompt templates** for specialized sub-agents. The orchestrating agent reads these templates, interpolates them with task-specific data from `tg context --json`, and dispatches sub-agents via the Cursor Task tool, the `agent` CLI, or mcp_task (same prompt; mechanism chosen by what's available). Before dispatching tg tasks, call TodoWrite with the task list and emit N Task/mcp_task calls in the same turn when batching. See [docs/cursor-agent-cli.md](../docs/cursor-agent-cli.md) and `.cursor/rules/subagent-dispatch.mdc`.

## Directory layout

- **README.md** (this file) — format, conventions, and how to add agents
- **explorer.md** — codebase exploration and context gathering (no code writing)
- **implementer.md** — execute a single task (tg start → work → tg done)
- **spec-reviewer.md** — spec compliance check (PASS/FAIL): intent, scope, suggested_changes (planned; add when present)
- **quality-reviewer.md** — code quality check (PASS/FAIL): patterns, tests, errors (planned; add when present)
- **reviewer.md** — single reviewer; dispatch rule currently references this; the two-stage flow will use spec-reviewer + quality-reviewer once those agents exist
- **planner-analyst.md** — pre-plan codebase analysis for the planning model
- **fixer.md** — escalation agent; resolves tasks after implementer/reviewer failure using a stronger model (see [When to use the fixer](#when-to-use-the-fixer) and [Model tier](#model-tier)).

Agent files are **prompt templates**, not executable code. The orchestrator injects context at dispatch time.

### Two-stage review flow

After an implementer completes, the orchestrator runs a **two-stage review**:

1. **spec-reviewer** — Checks that the implementation matches the task intent, stays in scope, and follows suggested_changes. Returns PASS or FAIL.
2. **quality-reviewer** — Only invoked if spec-reviewer returns PASS. Checks code quality: patterns, error handling, test coverage. Returns PASS or FAIL.

If either reviewer returns FAIL, the orchestrator re-dispatches the implementer once with the feedback. The old `reviewer.md` combined both concerns; the split allows spec compliance to be validated before investing in quality checks. The two-stage flow uses the split agents once spec-reviewer and quality-reviewer exist.

### When to use the fixer

The **fixer** agent is used for escalation when the default implementer path has failed:

- Reviewer reported **FAIL**, the orchestrator re-dispatched the implementer once, and the second attempt also failed (or was not attempted).
- The orchestrator explicitly escalates a single failed task to a stronger model instead of re-dispatching the fast implementer again.
- Environment or gate issues blocked the implementer and the orchestrator created a fixer task with the blocker context.

Dispatch the fixer with the same task context plus failure feedback (e.g. `{{FAILURE_REASON}}`, `{{REVIEWER_FEEDBACK}}`) and current diff so the fixer can amend rather than redo. See `fixer.md` for input/output contract and prompt outline.

## Model tier

- **fast** — Default for dispatched sub-agents (implementer, reviewer, explorer, planner-analyst, spec-reviewer, quality-reviewer). Use for routine task execution and reviews; keeps latency and cost low when tasks are well-scoped.
- **stronger** — Used for the **fixer** agent. Escalation is for harder reasoning, subtle bugs, or aligning implementation with reviewer feedback after one or more fast-model attempts failed. When invoking the fixer, use a higher-capability model (not `fast`).

The orchestrator uses the session model; sub-agents specify their tier in the agent file and the dispatcher passes the appropriate model (e.g. `model="fast"` for implementer, a stronger model for fixer).

## Agent file format

Each agent file (e.g. `implementer.md`) should include:

1. **Purpose** — One or two sentences: when this agent is used and what it does.
2. **Model** — `fast` for most dispatched sub-agents; `stronger` for the fixer (see [Model tier](#model-tier)). Orchestrator uses session model.
3. **Input contract** — What the orchestrator must pass: e.g. task_id, tg context JSON, optional explorer output.
4. **Output contract** — What the agent returns: e.g. "completed + evidence", "PASS/FAIL + issues", "structured analysis document".
5. **Prompt template** — The body of the prompt. Use placeholders the orchestrator will replace, e.g. `{{TASK_ID}}`, `{{CONTEXT_JSON}}`, `{{INTENT}}`.
6. **Learnings** (optional, grows over time) — Accumulated corrections from the orchestrator's learning-mode reviews. See below.

The orchestrator builds the final prompt by substituting these placeholders, then dispatches (Task tool, agent CLI, or mcp_task) with the built prompt; use `model="fast"` when using the Task tool or CLI.

## Learnings section

When **learning mode** is enabled (`"learningMode": true` in `.taskgraph/config.json`), the orchestrator reviews sub-agent output after each run and may append learnings to the agent file. These are concrete, reusable corrections — not praise or generic advice.

### Format

Each agent file may have a `## Learnings` section at the bottom. Entries use this format:

```
- **[YYYY-MM-DD]** <one-line summary>. <directive: "Instead, do X" or "Always check Y before Z".>
```

Example:

```
## Learnings

- **[2026-02-26]** Ignored suggested_changes and wrote implementation from scratch. Always read and follow suggested_changes as a starting point — deviate only when the suggestion is clearly wrong.
- **[2026-02-26]** Added unused import for a utility function. Run the project linter before completing the task.
```

### How learnings are used

- **Injection**: When building a sub-agent prompt, the orchestrator reads the `## Learnings` section and injects it as `{{LEARNINGS}}` in the prompt (after instructions, before task context).
- **Consolidation**: When learnings exceed ~10 entries, the orchestrator folds recurring patterns into the main prompt template and prunes the individual entries. This keeps the section high-signal.
- **Scope**: Learnings are per-agent (implementer learnings stay in implementer.md). Cross-cutting patterns that apply to all agents go into `.cursor/rules/subagent-dispatch.mdc` or `.cursor/memory.md` instead.

## Naming conventions

- **File names**: kebab-case, e.g. `planner-analyst.md`, `implementer.md`.
- **Agent identity for tg**: When multiple implementers run in parallel, use unique names like `implementer-1`, `implementer-2` so `tg status` shows distinct workers.
- **No YAML frontmatter required** — these are not Cursor plugin agent definitions; they are content that the dispatch rule and orchestrator interpret.

## How dispatch works

1. Orchestrator runs `tg next --json --limit 20` to get unblocked tasks.
2. For each task, orchestrator runs `tg context <taskId> --json` and optionally runs the explorer.
3. Orchestrator reads the appropriate agent template (e.g. `implementer.md`), replaces placeholders with the task's context.
4. Orchestrator dispatches the sub-agent: Task tool, `agent` CLI, or mcp_task with the same description and interpolated prompt (see docs/cursor-agent-cli.md).
5. Sub-agent runs in its own context. When using worktree isolation (Worktrunk standard): orchestrator runs `tg start <taskId> --agent <name> --worktree` and passes **{{WORKTREE_PATH}}**; sub-agent `cd`s there and runs work and `tg done` from that directory. Otherwise sub-agent runs `tg start <taskId> --agent <name>` (and optionally `--worktree` then gets path from `tg worktree list --json`), does the work, runs `tg done <taskId> --evidence "..."`.

Placeholders commonly used:

| Placeholder             | Source                                                                | Example                   |
| ----------------------- | --------------------------------------------------------------------- | ------------------------- |
| `{{TASK_ID}}`           | task_id from tg next                                                  | UUID                      |
| `{{AGENT_NAME}}`        | Unique name for this run (e.g. implementer-1)                         | string                    |
| `{{WORKTREE_PATH}}`     | When using worktrees; from `tg worktree list --json` or started event | Absolute path to worktree |
| `{{CONTEXT_JSON}}`      | Output of `tg context <taskId> --json`                                | JSON object               |
| `{{TITLE}}`             | context.title                                                         | Task title string         |
| `{{INTENT}}`            | context / task intent                                                 | Multi-line intent         |
| `{{DOC_PATHS}}`         | context.domain_docs                                                   | Paths to read             |
| `{{SKILL_DOCS}}`        | context.skill_docs                                                    | Paths to read             |
| `{{SUGGESTED_CHANGES}}` | context.suggested_changes                                             | Optional snippet          |
| `{{EXPLORER_OUTPUT}}`   | Optional; output from explorer sub-agent                              | Structured text           |

## Adding a new agent

1. Create `<agent-name>.md` in `.cursor/agents/` with Purpose, Model, Input contract, Output contract, and Prompt template.
2. Document the placeholders the orchestrator must fill.
3. Update `.cursor/rules/subagent-dispatch.mdc` to describe when to use the new agent and how to build its prompt.
4. Optionally add a short mention in `docs/skills/subagent-dispatch.md`.

## References

- Dispatch rule: `.cursor/rules/subagent-dispatch.mdc`
- Skill guide: `docs/skills/subagent-dispatch.md`
- Task graph workflow: `.cursor/rules/taskgraph-workflow.mdc`
