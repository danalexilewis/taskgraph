---
name: "Cursor Sub-Agent Specialization System"
overview: |
  Create a collection of specialized sub-agent definitions for Cursor that use
  model="fast" (1/10 cost) for all dispatched work. The orchestrator (session model)
  handles reasoning and coordination; sub-agents handle bounded execution tasks.
  Better prompts with tight context (from tg context) compensate for cheaper models.

  Inspired by gt-toolkit's formula system (multi-model dispatch, context isolation,
  file-based handoffs) and superpowers' skill-driven subagent pattern (implementer +
  reviewer, fresh context per task).

  Three layers of value:
  1. Parallel task dispatch — orchestrator finds unblocked tasks via `tg next`,
     dispatches multiple fast sub-agents concurrently on independent work items.
     This is the primary performance win: multiple cheap agents working in parallel
     on non-dependent tasks from Dolt.
  2. Cheap execution — ALL sub-agents use model="fast". The quality comes from
     well-scoped prompts with full tg context injected, not from model tier.
     The orchestrator (expensive session model) only does coordination and review.
  3. Planning analysis — a fast sub-agent explores the codebase and gathers context
     before the expensive orchestrator writes or reviews the plan.

  Sub-agents are prompt templates (.md files) living in `.cursor/agents/`.
  The orchestrating agent (or the workflow rules) reference them when dispatching
  via Cursor's Task tool with model="fast".
fileTree: |
  .cursor/
    agents/
      README.md                          (create)
      explorer.md                        (create)
      implementer.md                     (create)
      reviewer.md                        (create)
      planner-analyst.md                 (create)
      task-dispatcher.md                 (create)
    rules/
      subagent-dispatch.mdc              (create)
      taskgraph-workflow.mdc             (modify)
  docs/
    skills/
      subagent-dispatch.md               (create)
risks:
  - description: "fast model may produce low-quality output on tasks with hidden complexity"
    severity: medium
    mitigation: "All sub-agents get full tg context (intent, suggested_changes, domain docs, skill guides). Reviewer catches issues. Orchestrator can fall back to direct execution on session model if fast agent fails twice."
  - description: "Parallel sub-agents may conflict on shared files if dependency graph has gaps"
    severity: medium
    mitigation: "Dispatch only tasks with zero unmet blockers (tg next); include file-overlap check in dispatcher. Sub-agents use tg start --agent to claim tasks."
  - description: "Cursor's Task tool model parameter only supports 'fast' — no fine-grained model tiers"
    severity: low
    mitigation: "Binary choice (fast vs default) is sufficient. The quality comes from prompt specificity and context injection, not model tier."
  - description: "Sub-agent prompts that are too long may consume context budget, reducing effective work capacity"
    severity: medium
    mitigation: "Keep agent prompts under 200 lines. Inject tg context output dynamically rather than embedding static instructions."
tests:
  - "Dispatch explorer sub-agent on a real task; verify it returns structured codebase analysis"
  - "Dispatch implementer sub-agent with tg context output; verify it completes a simple create task"
  - "Dispatch reviewer sub-agent after implementer; verify it catches a deliberately introduced issue"
  - "Run dispatcher on a plan with 3+ unblocked tasks; verify parallel dispatch and tg start/done lifecycle"
  - "Planner-analyst sub-agent gathers context for a plan; verify output feeds into plan creation"
todos:
  - id: design-agent-format
    content: "Design the sub-agent definition format and directory structure"
    intent: |
      Establish the conventions for how sub-agents are defined in .cursor/agents/.
      Each agent needs: a purpose statement, model recommendation (fast vs default),
      input contract (what context it receives), output contract (what it produces),
      and the prompt template itself.

      Study how Cursor's Task tool consumes the prompt parameter and how
      subagent_type works. The agent definitions are prompt templates that the
      orchestrating rule or agent will interpolate with task-specific data
      (from tg context --json) before dispatching.

      Deliver: .cursor/agents/README.md documenting the format, naming conventions,
      and how to add new agents.
    domain: [backend]
    skill: [plan-authoring]
    changeType: create

  - id: create-explorer-agent
    content: "Create the Explorer sub-agent (fast model, codebase analysis)"
    intent: |
      The explorer is a cheap (fast model) sub-agent whose job is to gather and
      summarize codebase context. It does NOT write code. It reads files, searches
      for patterns, and returns a structured analysis.

      Use cases:
      - Pre-planning: "What files/functions are relevant to this feature area?"
      - Pre-implementation: "What patterns does the codebase use for X?"
      - Context enrichment: augment tg context with live codebase state

      The explorer uses subagent_type="explore" with model="fast".
      Its prompt should instruct it to:
      1. Read the task context (title, intent, domain docs, skill guides)
      2. Search the codebase for relevant files, functions, patterns
      3. Return a structured summary (relevant files, patterns found, dependencies,
         potential conflicts)

      Inspired by gt-toolkit's use of Haiku for codebase exploration and
      superpowers' context-gathering pattern.
    blockedBy: [design-agent-format]
    domain: [backend]
    changeType: create

  - id: create-implementer-agent
    content: "Create the Implementer sub-agent (fast model, task execution)"
    intent: |
      The implementer is the workhorse sub-agent that executes a single task.
      Always dispatched with model="fast". The quality comes from tight context
      injection, not model tier.

      Its prompt receives:
      - Full tg context --json output (title, intent, suggested_changes, domain/skill docs,
        file_tree, risks, related done tasks)
      - Explorer output (if available — codebase analysis from pre-exploration)
      - The repo's code-standards rule content (so it follows conventions)

      The implementer must:
      1. Run tg start <taskId> --agent implementer-<N>
      2. Read domain docs and skill guides referenced in context
      3. Implement the task within scope (intent + suggested_changes)
      4. Run tests if applicable
      5. Run tg done <taskId> --evidence "..."

      Key design: multiple implementer sub-agents run in parallel on independent
      tasks. Each gets a unique agent name (implementer-1, implementer-2, etc.)
      so tg status shows all active workers. They must NOT touch files outside
      their task's scope.

      Inspired by superpowers' implementer-prompt.md pattern where the controller
      extracts full task text and passes it directly (no file references).
    blockedBy: [design-agent-format]
    domain: [backend]
    changeType: create

  - id: create-reviewer-agent
    content: "Create the Reviewer sub-agent (fast model, spec compliance check)"
    intent: |
      The reviewer is a cheap (fast model) sub-agent that checks whether the
      implementer's work matches the task specification. It does NOT rewrite code —
      it evaluates and reports.

      Inspired by superpowers' two-stage review (spec reviewer + code quality reviewer),
      but consolidated into one agent for simplicity. It checks:
      1. Does the implementation match the task intent and acceptance criteria?
      2. Are there obvious code quality issues (unused imports, missing error handling)?
      3. Were tests added/updated as needed?

      The reviewer receives:
      - Task context (same as implementer received)
      - Git diff of the implementer's changes

      Output: PASS/FAIL with specific issues. On FAIL, the orchestrator can
      re-dispatch the implementer with the review feedback.

      Uses model="fast" because review is pattern-matching against a spec,
      not creative problem-solving.
    blockedBy: [design-agent-format]
    domain: [backend]
    changeType: create

  - id: create-planner-analyst-agent
    content: "Create the Planner Analyst sub-agent (fast model, pre-plan exploration)"
    intent: |
      The planner-analyst is a cheap (fast model) sub-agent that does the
      legwork before plan creation. Instead of the expensive planning model
      exploring the codebase itself, this agent:
      1. Takes the user's request/feature description
      2. Explores the codebase to find relevant files, patterns, dependencies
      3. Checks tg status and recent done tasks for related prior work
      4. Returns a structured analysis document:
         - Relevant files and their roles
         - Existing patterns to follow
         - Potential risks and dependencies
         - Suggested task breakdown (rough, not final)

      The expensive model then uses this analysis to write the actual plan,
      focusing its reasoning capacity on architecture decisions, risk assessment,
      and task design rather than file-hunting.

      This is the key insight from gt-toolkit: use Haiku-tier for exploration,
      Opus-tier for reasoning. Adapted for Cursor's fast/default binary.
    blockedBy: [design-agent-format]
    domain: [backend]
    skill: [plan-authoring]
    changeType: create

  - id: create-dispatcher-rule
    content: "Create the sub-agent dispatch rule and skill guide"
    intent: |
      Create .cursor/rules/subagent-dispatch.mdc — the orchestration rule that
      teaches agents how to dispatch sub-agents for task execution. This is the
      "conductor" that ties everything together.

      The rule covers three dispatch patterns:

      **Pattern 1: Parallel batch execution (primary pattern)**
      The orchestrator runs `tg next --json --limit 4` to find unblocked tasks,
      gathers `tg context --json` for each, then dispatches up to 4 implementer
      sub-agents concurrently — all with model="fast". Each sub-agent runs
      tg start/done independently. After all complete, the orchestrator runs
      reviewers (also fast) on each, then checks for newly unblocked tasks
      and dispatches the next batch. This is the main performance win.

      **Pattern 2: Sequential single-task execution**
      For one task at a time: explorer (optional) -> implementer -> reviewer.
      Fallback when only one task is available or tasks share files.

      **Pattern 3: Plan analysis**
      Before creating a plan, dispatch the planner-analyst (fast) to gather
      codebase context. Feed its output into the plan creation prompt.

      The rule includes:
      - All sub-agents use model="fast" — no heuristic needed
      - How to build the sub-agent prompt (interpolating tg context --json output)
      - Lifecycle management (tg start/done wrapping per sub-agent)
      - Error handling (re-dispatch once on fast; fall back to orchestrator
        direct execution after 2 failures)
      - File conflict detection (skip parallel dispatch if tasks share files)

      Also create docs/skills/subagent-dispatch.md as the skill guide that
      tg context can reference.
    blockedBy:
      - create-explorer-agent
      - create-implementer-agent
      - create-reviewer-agent
      - create-planner-analyst-agent
    domain: [backend]
    skill: [plan-authoring]
    changeType: create

  - id: update-workflow-rule
    content: "Update taskgraph-workflow.mdc to reference sub-agent dispatch"
    intent: |
      Modify .cursor/rules/taskgraph-workflow.mdc to add a section on sub-agent
      dispatch as an execution option. The existing execution loop (manual
      start/work/done) remains the default, but agents can now optionally use
      the dispatch patterns from subagent-dispatch.mdc.

      Add to the Execution Loop section:
      - A note about the sub-agent dispatch option
      - When to use sub-agents vs direct execution (sub-agents for well-scoped
        tasks with clear intent; direct for exploratory or ambiguous work)
      - Cross-reference to subagent-dispatch.mdc

      Keep changes minimal — this is a pointer, not a rewrite.
    blockedBy: [create-dispatcher-rule]
    domain: [backend]
    changeType: modify

  - id: add-agents-to-template
    content: "Add agent definitions to src/template for tg setup scaffolding"
    intent: |
      Copy the agent definitions and dispatch rule into src/template/.cursor/
      so that `tg setup` scaffolds them into new repos. This ensures any repo
      using taskgraph gets the sub-agent system out of the box.

      Files to add to src/template/:
      - .cursor/agents/ (all agent .md files + README)
      - .cursor/rules/subagent-dispatch.mdc
      - docs/skills/subagent-dispatch.md

      Update the setup command if needed to copy the agents/ directory
      (currently it copies rules/ and docs/).
    blockedBy: [update-workflow-rule]
    domain: [backend]
    skill: [cli-command-implementation]
    changeType: modify
isProject: false
---

## Analysis

### The Core Insight

**Better prompts with tight context compensate for cheaper models.** This is the lesson from both reference projects:

- **gt-toolkit** dispatches Haiku for codebase exploration — the cheapest model does the most volume of work
- **superpowers** achieves quality through fresh context per sub-agent and two-stage review, not model escalation
- **Task Graph** already provides structured context (`tg context --json`) with intent, suggested changes, domain docs, skill guides, and related prior work

The approach: **all sub-agents use model="fast" (1/10 cost)**. The orchestrator (session model) handles coordination, review oversight, and complex reasoning. The sub-agents are scoped to bounded tasks with full context injected — the fast model is sufficient when it knows exactly what to do.

### Cost Model

With `fast` at 1/10 cost, dispatching 4 parallel fast sub-agents costs less than running 1 task on the session model. A plan with 8 independent tasks:

- **Before**: 8 sequential tasks on expensive model = 8x cost units
- **After**: 2 batches of 4 parallel fast agents = ~1.6x cost units (8 * 0.1 * 2 for retry headroom)

That's roughly a **5x cost reduction** with **4x throughput improvement** on independent work.

### Sub-Agent Architecture

```mermaid
graph TD
    subgraph orchestrator [Orchestrating Agent - session model]
        TGNext["tg next --json --limit 4"]
        TGContext["tg context --json per task"]
        BatchDispatch["Batch dispatch up to 4"]
        ReviewResults["Review results, next batch"]
    end

    subgraph fastAgents [All Sub-Agents - model=fast]
        Explorer["Explorer"]
        Impl1["Implementer 1"]
        Impl2["Implementer 2"]
        Impl3["Implementer 3"]
        Impl4["Implementer 4"]
        Reviewer["Reviewer"]
        PlannerAnalyst["Planner Analyst"]
    end

    subgraph taskgraph [Task Graph - Dolt]
        Tasks["Tasks + metadata"]
        Events["Events log"]
        Edges["Dependency edges"]
    end

    TGNext --> BatchDispatch
    TGContext --> BatchDispatch
    BatchDispatch --> Impl1
    BatchDispatch --> Impl2
    BatchDispatch --> Impl3
    BatchDispatch --> Impl4

    Impl1 -->|"tg done"| ReviewResults
    Impl2 -->|"tg done"| ReviewResults
    Impl3 -->|"tg done"| ReviewResults
    Impl4 -->|"tg done"| ReviewResults

    ReviewResults -->|"next batch"| TGNext

    PlannerAnalyst -->|"codebase analysis"| orchestrator
    Explorer -->|"context enrichment"| orchestrator
```

### Parallel Dispatch Flow

```mermaid
sequenceDiagram
    participant O as Orchestrator (session model)
    participant TG as Task Graph (Dolt)
    participant A1 as Implementer-1 (fast)
    participant A2 as Implementer-2 (fast)
    participant A3 as Implementer-3 (fast)
    participant R as Reviewer (fast)

    O->>TG: tg next --json --limit 4
    TG-->>O: 3 unblocked tasks (no shared files)

    O->>TG: tg context task1 --json
    O->>TG: tg context task2 --json
    O->>TG: tg context task3 --json

    par Batch 1 - Parallel Dispatch
        O->>A1: Task(model=fast, prompt=context1+agent_template)
        O->>A2: Task(model=fast, prompt=context2+agent_template)
        O->>A3: Task(model=fast, prompt=context3+agent_template)
    end

    A1->>TG: tg start task1 --agent implementer-1
    A2->>TG: tg start task2 --agent implementer-2
    A3->>TG: tg start task3 --agent implementer-3

    Note over A1,A3: Each implements, tests, runs tg done

    A1->>TG: tg done task1 --evidence "..."
    A2->>TG: tg done task2 --evidence "..."
    A3->>TG: tg done task3 --evidence "..."

    A1-->>O: result
    A2-->>O: result
    A3-->>O: result

    par Review each
        O->>R: Task(model=fast, review task1 diff)
        O->>R: Task(model=fast, review task2 diff)
        O->>R: Task(model=fast, review task3 diff)
    end

    R-->>O: PASS/FAIL per task

    O->>TG: tg next --json --limit 4
    Note over O: Repeat with newly unblocked tasks
```

### Key Design Decisions

1. **All sub-agents use model="fast".** No heuristic, no per-task model selection. The orchestrator (session model) handles complex reasoning; sub-agents do bounded work with full context injected. This is the gt-toolkit lesson: cheap models + good prompts > expensive models + vague prompts.

2. **Parallel-first execution.** The primary dispatch pattern is batching: find up to 4 unblocked tasks, dispatch them concurrently, review results, repeat. Sequential execution is the fallback, not the default.

3. **Agents are prompt templates, not executable code.** They live as `.md` files in `.cursor/agents/` and are interpolated by the orchestrating agent at dispatch time. This matches superpowers' approach and avoids adding runtime dependencies.

4. **Sub-agents wrap the tg lifecycle.** Every implementer sub-agent runs `tg start` and `tg done` — the task graph remains the single source of truth for what's in progress and what's complete. Dolt handles concurrent writes from parallel agents.

5. **File conflict detection before parallel dispatch.** The orchestrator checks whether unblocked tasks share files (via `file_tree` or `suggested_changes`) and only parallelizes truly independent work.

6. **Fail-fast with escalation.** If a fast sub-agent fails twice on a task, the orchestrator falls back to direct execution on the session model. This prevents cheap model failures from blocking progress.

### Comparison with Reference Projects

| Aspect | gt-toolkit | superpowers | Our system |
|--------|-----------|-------------|------------|
| Model tiers | 3 (Haiku/Sonnet/Opus) + external | 1 (inherit) | 2 (all sub-agents fast; orchestrator session model) |
| Dispatch | TOML formulas, background jobs | Controller dispatches sub-agents | Cursor rules dispatch via Task tool, model="fast" |
| Context passing | File-based (.tmp artifacts) | Controller extracts text inline | tg context --json interpolated into prompt |
| Review | Multi-model consensus (3x parallel) | Two-stage (spec + quality) | Single-stage (fast model, spec + quality combined) |
| Parallel execution | Yes (needs-based DAG) | No (sequential only) | Yes (tg next finds independent tasks from Dolt) |
| Task tracking | Beads/molecules | None (plan markdown) | Task graph (Dolt, concurrent writes, full events) |
| Cost model | Varies by formula | Session model cost | ~10% per sub-agent; 4x parallel throughput |

### Open Questions

1. Should the reviewer agent be split into spec-reviewer and quality-reviewer (like superpowers) or kept as one? Starting with one; can split if review quality is insufficient.
2. Should explorer output be persisted as a `tg note` on the task for future reference? Leaning yes — it creates a searchable record.
3. Dolt concurrent write safety: multiple sub-agents will call `tg start` and `tg done` at the same time. Need to verify Dolt handles concurrent writes gracefully (it should — it's a SQL database — but worth confirming in testing).

<original_prompt>
Create a collection of specialized sub-agents for Cursor, inspired by gt-toolkit's formulas
(https://github.com/Xexr/gt-toolkit/tree/main/formulas) and superpowers' skills
(https://github.com/obra/superpowers). Sub-agents should leverage the task graph for context
(tg context), use cheap models (model="fast") for ALL dispatched work, and enable parallel
execution of unblocked tasks pulled from Dolt. Multiple agents should be able to work on
independent tasks concurrently — this is the primary performance win. The system should be
added to .cursor/ and also scaffolded via tg setup for new repos.
</original_prompt>
