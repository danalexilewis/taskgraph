---
name: Bulk context for tg context
overview: Add batch context so the orchestrator can fetch context for multiple tasks in one CLI call instead of N separate tg context invocations.
risks:
  - description: Single-ID backward compatibility could break if output shape changes
    severity: low
    mitigation: When exactly one ID is given, keep returning the same single ContextResult object as today; only use keyed shape for 2+ IDs.
  - description: Partial failure (some IDs invalid) may confuse consumers
    severity: low
    mitigation: Document that 2+ ID mode returns keyed object with per-id error entries for missing/invalid IDs; orchestrator can filter or fail on first error as needed.
tests:
  - "Unit: client contextBatch with 0, 1, 2+ IDs; one invalid ID returns error entry in keyed result"
  - "Integration: tg context id1 --json unchanged; tg context id1 id2 --json returns keyed object by task_id"
todos:
  - id: api-batch-context
    content: Add runContextChainBatch and contextBatch to API client with batched SQL
    agent: implementer
    intent: |
      In src/api/client.ts add batch context: resolve IDs with resolveTaskIdsBatch (from cli/utils), then run batched queries (task WHERE task_id IN (...), project WHERE plan_id IN (...), task_doc/task_skill WHERE task_id IN (...), blockers edge JOIN for to_task_id IN (...), event for done evidence). Build one ContextResult per resolved task; apply existing compactContext/token budget per task. Expose contextBatch(taskIds: string[]) on TgClient returning Record<string, ContextResult | { error: string }>. Reuse runContextChain logic but fetch all data in batched form then map to per-task results. Handle resolveTaskIdsBatch errors by including error entries in the keyed output for failed inputs.
    suggestedChanges: |
      - New async function runContextChainBatch(config, taskIds) that returns Promise<Record<string, ContextResult | { error: string }>>.
      - Use query(config.doltRepoPath); then SELECT from task WHERE task_id IN (resolved ids), then project WHERE plan_id IN (distinct plan_ids), task_doc/task_skill WHERE task_id IN (...), single raw SQL for blockers (to_task_id IN (...)), then event for evidence. Build map taskId -> ContextResult; for any resolved ID that has no task row, set result[id] = { error: "Task not found" }.
      - TgClient.contextBatch(taskIds) calls runContextChainBatch and returns ResultAsync of that record.
    changeType: modify
    docs:
      - schema
      - architecture
  - id: cli-context-multi-id
    content: Allow context command to accept multiple task IDs and call contextBatch when 2+
    agent: implementer
    blockedBy:
      - api-batch-context
    intent: |
      In src/cli/context.ts change the context command to accept variadic task IDs (e.g. .argument("[taskIds...]", "Task ID(s); omit when using --hive")). Reuse parseIdList from utils. If --hive, keep current hive behavior. If no taskIds and no --hive, error as today. When exactly one ID after parseIdList, call client.context(id) and output that single object (unchanged behavior). When 2+ IDs, call client.contextBatch(ids) and output the keyed object as JSON; for human-readable non-JSON output, print a short summary per task. Update docs/cli-reference.md to document tg context [taskId...] and the keyed output shape for multiple IDs.
    suggestedChanges: |
      - context.ts: add taskIds as variadic argument; parseIdList(taskIds); branch on length === 1 (existing context) vs length >= 2 (contextBatch); --json in both cases.
      - cli-reference.md: add "Multiple task IDs" under context command; output shape when 2+ IDs is { "<task_id>": ContextResult | { error: string }, ... }.
    changeType: modify
    docs:
      - cli-reference
  - id: work-skill-dispatch-batch-context
    content: Update work skill and subagent-dispatch to use batch context when building N prompts
    agent: implementer
    intent: |
      When the orchestrator has multiple tasks (or a batch unit of 2–3 tasks) and needs context for each, it should use one call: tg context id1 id2 ... --json and build implementer prompts from the keyed response. Update .cursor/skills/work/SKILL.md (step 6a / task batching) and .cursor/rules/subagent-dispatch.mdc (Pattern 1 step 3) to say "when multiple tasks need context, run tg context <id1> <id2> ... --json once and build prompts from the keyed object; only run tg context <taskId> --json per task when batch context is unavailable (e.g. single task)."
    changeType: modify
    docs:
      - agent-contract
  - id: mcp-batch-context
    content: Add MCP tool for batch context (optional)
    agent: implementer
    blockedBy:
      - api-batch-context
    intent: |
      In src/mcp/tools.ts add a tool (e.g. tg_context_batch or extend existing context tool) that accepts taskIds: string[] and returns the same keyed structure as contextBatch. Call client.contextBatch(taskIds). Document in docs/mcp.md if the MCP server has a tools list.
    suggestedChanges: |
      - mcp/tools.ts: new tool descriptor and handler that takes taskIds array, returns Record<task_id, ContextResult | { error }>.
    changeType: modify
    docs:
      - mcp
  - id: tests-bulk-context
    content: Add unit and integration tests for batch context
    agent: implementer
    blockedBy:
      - api-batch-context
      - cli-context-multi-id
    intent: |
      Unit tests (e.g. __tests__/api/client.test.ts or equivalent): contextBatch with 0 IDs returns empty object; 1 ID returns one key; 2+ IDs return keyed object; one invalid ID in list returns keyed object with error entry for that ID. Integration tests: tg context <single-id> --json output unchanged; tg context <id1> <id2> --json returns valid JSON object keyed by task_id with context shape per key. Use existing integration test patterns (DB isolation, dist/).
    changeType: create
    docs:
      - testing
isProject: false
---

# Bulk context for tg context

## Analysis

The work skill and subagent-dispatch flow require the orchestrator to run `tg context <taskId> --json` **once per task** when building implementer prompts for a batch of runnable tasks. With 6 runnable tasks that yields 6 process spawns and 6× full `runContextChain` (task, project, task_doc, task_skill, blockers, evidence). Transcript analysis and the evolve-cli report show this as a repeated pattern.

Batching is feasible: all data needed for context comes from `task`, `project`, `task_doc`, `task_skill`, `edge`, and `event`. These can be queried with `IN` clauses for multiple task IDs (and derived plan_ids), then results grouped by task_id to build one `ContextResult` per task. Single process, one batched SQL path (or one transaction), same per-task compaction and token budget.

Existing **Batch CLI operations** (start, done, note, cancel) already use variadic positionals and `parseIdList`/`resolveTaskIdsBatch` from `src/cli/utils.ts`. Context should follow the same pattern for consistency.

## Dependency graph

```
Parallel start (2 unblocked):
  ├── api-batch-context
  └── mcp-batch-context (optional)

After api-batch-context:
  ├── cli-context-multi-id
  └── (mcp-batch-context already unblocked)

After cli-context-multi-id:
  └── work-skill-dispatch-batch-context

After api-batch-context and cli-context-multi-id:
  └── tests-bulk-context
```

## Decisions

- **Single ID:** When exactly one task ID is provided, keep current behavior: `client.context(id)` and output the single `ContextResult` object. No wrapper. Backward compatible.
- **2+ IDs:** Call `client.contextBatch(ids)`; output shape `{ "<task_id>": ContextResult | { error: string }, ... }`. Per-id errors (e.g. task not found) appear as `{ error: "..." }` for that key.
- **CLI signature:** Variadic positionals `tg context [taskIds...]` like start/done/note. No new `--batch` flag.
- **MCP:** Optional follow-up; batch context tool allows orchestrators using MCP to get N contexts in one call.

## Related

- Batch CLI operations plan (start, done, note, cancel) — same variadic and utils pattern.
- reports/26-03-03_evolve-cli-transcript-analysis.md — context repetition and status+next gap.
- reports/26-03-02_cli_ergonomics_agents_subagents_research.md — batch context suggested as medium priority.

## Original prompt

<original_prompt>
/plan improvement — Add bulk (batch) context for tg context so the orchestrator can fetch context for N tasks in one call instead of N separate tg context invocations; single process, batched DB/transaction.
</original_prompt>
