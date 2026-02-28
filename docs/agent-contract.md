---
triggers:
  files: [".cursor/agents/**", "AGENT.md"]
  change_types: ["create", "modify"]
  keywords: ["agent", "contract", "workflow"]
---

# Agent Contract

This document outlines the protocol and responsibilities of an agent interacting with the Task Graph system. The goal is to enable "centaur development", where a human plans and audits, and an agent executes, ensuring determinism and auditability.

**Canonical source**: [AGENT.md](../AGENT.md) in the repo root. This doc expands on it. See also [docs/agent-strategy.md](agent-strategy.md) (agent architecture) and [docs/leads/](leads/) (lead docs).

## Plan Creation and Review

When the user asks for a plan:

1.  Create `plans/<name>.md` in Cursor format (YAML frontmatter with `name`, `overview`, `todos`).
2.  Summarize the plan, then **pause** and ask for review.
3.  Do not import or execute until the user responds. Interpret the response:

| User says                                              | Meaning              | Agent action                                                                                     |
| ------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------ |
| proceed, go ahead, execute, run it, let's do it        | Approve and execute  | Run `tg import plans/<file> --plan "<Plan Name>" --format cursor`, then enter the execution loop |
| just add the tasks, add to taskgraph only              | Add to graph only    | Run `tg import`; do not execute                                                                  |
| thanks, that's good, looks good, ok, don't do anything | Acknowledgement only | Do nothing. No import, no execution.                                                             |

## Agent Operating Loop

The agent's primary interaction loop is designed to pick up the next runnable task, execute it, and update its status. This loop ensures a structured and predictable workflow.

**Task orchestration UI**: When running tg tasks, call TodoWrite with the task list from `tg next` before dispatching and update statuses as tasks complete; when dispatching a batch, emit N Task (or mcp_task) calls in the same turn. See AGENT.md and `.cursor/rules/subagent-dispatch.mdc` for the full TodoWrite and batch-in-one-turn protocol.

1.  **Select Next Task**: Always begin by querying for runnable tasks and selecting the top priority one.

    ```bash
    tg next --limit 20
    ```

    The agent should choose the highest priority task from the list that is currently in `todo` status and has no unmet blockers.

2.  **Understand Task Context**: Before initiating any work, display the task's details to confirm its intent, scope, and acceptance criteria.
    `bash
tg show <taskId>
    `
    The agent should restate: - `intent`: The goal or purpose of the task. - `scope_in`: What is explicitly part of this task. - `scope_out`: What is explicitly _not_ part of this task. - `acceptance`: The criteria that must be met for the task to be considered complete.

3.  **Start Task**: Mark the selected task as `doing` to indicate active work has commenced. When multiple agents may be active, pass `--agent <name>` for visibility.
    `bash
tg start <taskId> [--agent <name>]
    `

4.  **Execute Task**: Perform the work exactly within the defined `scope_in` and aiming to meet all `acceptance` criteria. The agent must _not_ deviate from the task's defined scope without explicit human approval.

5.  **Complete Task**: Once the work is done, mark the task as `done` and provide clear evidence of completion.
    `bash
tg done <taskId> --evidence "<text>" [--checks <json>]
    `
    The `--evidence` should include: - Tests run and their outcomes. - Summaries of command outputs. - Relevant Git commit hash(es) if code changes were made. - Optionally, `--checks` can be used to report on specific acceptance criteria met.

## When Blocked

If the agent encounters a situation where it cannot proceed with a task due to an external dependency or prerequisite, it must follow this protocol:

1.  **Identify Blocker**: Determine the specific reason and the blocking entity (another task, a decision, an external factor).

2.  **Block the Task**: If blocked by an existing task that is not yet `done` or `canceled`:
    `bash
tg block <taskId> --on <blockerTaskId> --reason "Reason for blocking."
    `

3.  **Create New Blocker (if needed)**: If the blocker is not an existing task (e.g., a missing design, a human decision required, an external team dependency), create a new task with `owner=human` and `status=todo`, then block the current task on it.
    `bash
tg task new "Decide: API design for feature X" --plan <currentPlanId> --owner human --area design
tg block <currentTaskId> --on <newBlockerTaskId> --reason "Requires human decision on API design."
    `

4.  **Stop and Report**: After blocking, the agent should report the blockage and await further instructions from the human.

## Decisions

If a decision is required to proceed with a task that is not a straightforward technical implementation:

1.  **Create Decision Task**: Create a new task with `owner=human` to clearly delineate the decision point.
    `bash
tg task new "Decide: Frontend framework choice" --plan <currentPlanId> --owner human --area frontend
    `

2.  **Add Decision Event**: Record the decision-needed event with context and potential options.

    ```bash

    ```

# Example: After creating the decision task, add an event. This would typically be via a direct DB insert or a specialized `tg decision add` command.

# For now, simulate: tg event add <decisionTaskId> decision_needed --body '{"options":["React","Vue"],"recommendation":"React due to team familiarity"}'

    ```

3.  **Stop and Ask for Approval**: The agent should then stop its operation on this path and await human input for the decision.

## Safe Graph Edits (Agent May Do Without Asking)

To allow for efficient autonomous operation, the agent is permitted to make the following changes without explicit human approval:

- **Status Transitions**: Moving tasks between `todo` → `doing` → `done`, or setting to `blocked` when a real blocker is identified.
- **Add Dependencies**: When a prerequisite is objectively required for a task to proceed (e.g., "API endpoint must exist before UI integration"), the agent may add a `blocks` edge.
- **Split Tasks**: If a single task's scope becomes too large, typically exceeding an estimated 90 minutes of work, the agent may split it into smaller, more manageable subtasks, preserving the original scope and acceptance criteria. The original task can become an `umbrella` task or be `canceled`.

## Multi-Agent Awareness

When 2–3 agents work alongside the human on the same task graph:

1.  **Always pass `--agent`**: Use `tg start <taskId> --agent <session-name>` so other agents see who claimed each task.
2.  **Read Active Work**: Before picking a task, run `tg status` and check the "Active work" section. Avoid tasks that touch the same files/area as another agent's doing task.
3.  **Leave Notes**: Use `tg note <taskId> --msg "..."` when changing shared interfaces (types, schema, parser) so other agents are aware.
4.  **Conflict Avoidance**: Do not pick a task in the same area as another agent's doing task without human approval.

## Everything Else is Proposal-Only

Any other modification to the task graph (e.g., changing task ownership, altering plan intent, modifying existing dependencies for reasons other than objective prerequisites, re-prioritizing tasks, deleting tasks/plans) must be proposed to the human for approval. The agent should clearly articulate the proposed change and its rationale.
