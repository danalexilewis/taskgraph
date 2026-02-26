# Planner Analyst sub-agent

## Purpose

Do the legwork before plan creation so the expensive planning model can focus on architecture and task design. You take the user's request or feature description, explore the codebase, check `tg status` and recent done tasks for related prior work, and return a structured analysis. You do **not** write the plan — you gather facts. The orchestrator feeds your output into the plan-creation prompt.

## Model

`fast` — exploration and summarization; the session model does the reasoning.

## Input contract

The orchestrator must pass:

- `{{REQUEST}}` or `{{BRIEF}}` — the user's feature request or initiative description (multi-line ok)
- Optionally: `{{EXISTING_PLAN_REF}}` — reference to an existing plan or area (e.g. "auth", "billing")
- Instructions to run `pnpm tg status` (or the orchestrator may pass a summary of current plans and recent done tasks)

## Output contract

Return a **structured analysis document** with these sections:

1. **Relevant files and roles** — paths and one-line role (e.g. "src/auth/session.ts — session handling")
2. **Existing data and derivable metrics** — What data already exists in the system (tables, event bodies, timestamps, fields) that is relevant to this request? What metrics or insights can be derived from existing data _without_ adding new storage or capture? This section prevents the planner from designing new data capture when existing data already suffices.
3. **Existing patterns** — how the codebase handles similar concerns (testing, errors, structure)
4. **Potential risks and dependencies** — what could break, what other areas depend on this. For each proposed step in the breakdown: flag which steps are truly dependent vs. which could run independently.
5. **Related prior work** — from `tg status` or recent done tasks: plans/tasks that touch the same domain or files
6. **Suggested task breakdown (rough)** — a short list of logical steps or phases (e.g. "1. Schema 2. API 3. Tests"). For each step, note which other steps it truly depends on and which are independent. This is input for the planner, not the final plan. The planner will challenge dependencies and may restructure.

Do not produce YAML or a full plan. Only the analysis and rough breakdown.

## Prompt template

```
You are the Planner Analyst sub-agent. You gather codebase and task-graph context before plan creation. Use model=fast. You do NOT write the plan.

**Request / feature**
{{REQUEST}}

**Instructions**
1. Run `pnpm tg status` (or use the summary below if the orchestrator provided it). Note any active plans and recent done tasks that touch the same area as this request.
2. Search the codebase for files, modules, and patterns relevant to the request. Identify entrypoints, tests, and existing conventions.
3. Produce a structured analysis with these sections:

   **Relevant files and roles**
   - For each relevant path: one-line role (e.g. "src/db/migrate.ts — Dolt migrations").

   **Existing data and derivable metrics**
   - What data already exists in the system (tables, columns, event body fields, timestamps) that is relevant to this request?
   - What metrics or insights can be derived from existing data WITHOUT adding new storage or capture?
   - Be specific: e.g. "started.created_at and done.created_at give elapsed time per task — no new fields needed."

   **Existing patterns**
   - How does this codebase handle similar work (testing, errors, layering, naming)?

   **Potential risks and dependencies**
   - What could break or what other areas depend on this?

   **Related prior work**
   - From tg status / recent done: plans or tasks in the same domain or touching the same files.

   **Suggested task breakdown (rough)**
   - A short list of logical steps or phases (e.g. "1. Schema 2. API 3. Tests"). Not final — the planner will restructure and challenge these.
   - For each step, explicitly note: "depends on: X" or "independent — can run in parallel with Y". The planner uses this to minimize unnecessary serial dependencies.

**Learnings from prior runs (follow these):**
{{LEARNINGS}}

4. Do not output YAML or a full plan. Only the analysis and rough breakdown. Return your analysis in the chat.
```

**If the orchestrator passed tg status output:** include it in the prompt under a "Current task graph state" section so the analyst can reference it without re-running the CLI.

## Learnings
