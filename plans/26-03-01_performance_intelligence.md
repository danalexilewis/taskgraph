---
name: Performance Intelligence
overview: Add benchmarking analytics, per-task metrics, self-report capture, and context optimization to continuously improve sub-agent execution efficiency.
fileTree: |
  src/
  ├── cli/
  │   ├── stats.ts              (modify - add --plan, --timeline flags)
  │   ├── status.ts             (modify - add stale-task warning)
  │   └── done.ts               (modify - add self-report flags)
  docs/
  ├── performance.md            (create - system requirements + optimization guide)
  └── cli-reference.md          (modify - document new stats options)
  .cursor/agents/
  └── implementer.md            (modify - self-report contract)
  __tests__/integration/
  └── stats.test.ts             (create or modify - cover new stats options)
risks:
  - description: Token counts and tool-call counts are emitted by the Cursor/Claude runtime, not by tg. We cannot capture them directly — agents must self-report at tg done time.
    severity: medium
    mitigation: Design optional self-report flags on tg done; document the convention in implementer.md. When fields are absent, stats display N/A. Graceful degradation.
  - description: The done command location (done.ts) is unconfirmed; it may be inline in index.ts or a separate file.
    severity: low
    mitigation: Implementer reads src/cli/ before editing; adjust file reference as needed.
  - description: tg context can deliver large contexts to sub-agents, inflating token cost for every task. Compression is the highest-leverage optimization per external research.
    severity: medium
    mitigation: context-audit task trims output to spec + relevant docs + immediate blockers only. Measure character count before/after as a proxy for token reduction.
tests:
  - "tg stats --plan <id> shows per-task elapsed table and plan-level summary (owned by stats-integration-tests)"
  - "tg stats --timeline shows plan history sorted by date (owned by stats-integration-tests)"
  - "tg status dashboard shows stale-task warning when a doing task exceeds 2h threshold (owned by stale-task-warning)"
  - "tg done with --tokens-in/--tokens-out/--tool-calls stores values in done event body (owned by self-report-done-flags)"
todos:
  - id: stats-plan-view
    content: "Add tg stats --plan <planId> flag showing plan total duration, task velocity, and per-task elapsed time table"
    agent: implementer
    changeType: modify
    docs: [schema, cli-reference]
    skill: cli-command-implementation
    intent: |
      Extend `src/cli/stats.ts` to accept a `--plan <planId>` (or `-p`) flag.

      When provided, run two queries:

      1. Plan-level summary:
         ```sql
         SELECT
           p.title,
           MIN(e_start.created_at) AS plan_started_at,
           MAX(e_done.created_at)  AS plan_done_at,
           TIMESTAMPDIFF(SECOND, MIN(e_start.created_at), MAX(e_done.created_at)) AS total_elapsed_s,
           COUNT(DISTINCT t.task_id) AS task_count
         FROM project p
         JOIN task t ON t.plan_id = p.plan_id
         JOIN event e_start ON e_start.task_id = t.task_id AND e_start.kind = 'started'
         JOIN event e_done  ON e_done.task_id  = t.task_id AND e_done.kind  = 'done'
         WHERE p.plan_id = ?
         ```
         Derive velocity = task_count / (total_elapsed_s / 3600.0) formatted as "N tasks/hr".

      2. Per-task elapsed table:
         ```sql
         SELECT
           t.hash_id,
           t.title,
           TIMESTAMPDIFF(SECOND, e_start.created_at, e_done.created_at) AS elapsed_s,
           e_done.body AS done_body
         FROM task t
         JOIN event e_start ON e_start.task_id = t.task_id AND e_start.kind = 'started'
         JOIN event e_done  ON e_done.task_id  = t.task_id AND e_done.kind  = 'done'
         WHERE t.plan_id = ?
         ORDER BY elapsed_s DESC
         ```

      Display:
      - Section header: "Plan: <title> | Duration: X min | Velocity: N tasks/hr | Tasks: N"
      - Table: hash_id (short), task title (flex col), elapsed (formatted as "Xm Ys")
      - Use `renderTable` + `boxedSection` + `getTerminalWidth()` patterns from status.ts
      - Support `--json` flag via `rootOpts(cmd).json`

      Handle `plan` vs `project` table names: check `tableExists('project')` first, fall back to `plan`.
      Handle done event body JSON: `typeof raw === 'string' ? JSON.parse(raw) : raw`.

  - id: stats-timeline
    content: "Add tg stats --timeline flag showing cross-plan execution history sorted by date with duration and velocity"
    agent: implementer
    changeType: modify
    docs: [schema, cli-reference]
    skill: cli-command-implementation
    intent: |
      Extend `src/cli/stats.ts` to accept a `--timeline` flag.

      Query:
      ```sql
      SELECT
        p.plan_id,
        p.title,
        p.status,
        MIN(e_start.created_at) AS started_at,
        MAX(e_done.created_at)  AS completed_at,
        TIMESTAMPDIFF(SECOND, MIN(e_start.created_at), MAX(e_done.created_at)) AS total_elapsed_s,
        COUNT(DISTINCT t.task_id) AS task_count,
        COUNT(DISTINCT CASE WHEN e_done.kind = 'done' THEN t.task_id END) AS done_count
      FROM project p
      LEFT JOIN task t ON t.plan_id = p.plan_id
      LEFT JOIN event e_start ON e_start.task_id = t.task_id AND e_start.kind = 'started'
      LEFT JOIN event e_done  ON e_done.task_id  = t.task_id AND e_done.kind  = 'done'
      GROUP BY p.plan_id, p.title, p.status
      ORDER BY started_at DESC
      ```

      Display table: started_at (date only), plan title (flex col), status, tasks completed/total, duration (formatted), velocity (tasks/hr or N/A if no data).
      Use renderTable + boxedSection patterns.
      Handle project/plan table name with tableExists guard.
      Support --json.

  - id: stale-task-warning
    content: "Add stale doing-task health warning to tg status dashboard when any task has been in doing state for more than 2 hours"
    agent: implementer
    changeType: modify
    docs: [schema, cli-reference]
    skill: cli-command-implementation
    intent: |
      Extend `src/cli/status.ts` to detect stale doing tasks and surface a warning in the dashboard output.

      Add a `fetchStaleDoingTasks(repoPath, thresholdHours = 2)` function:
      ```sql
      SELECT
        t.hash_id,
        t.title,
        t.owner,
        TIMESTAMPDIFF(HOUR, e.created_at, NOW()) AS age_hours
      FROM task t
      JOIN event e ON e.task_id = t.task_id AND e.kind = 'started'
      WHERE t.status = 'doing'
        AND TIMESTAMPDIFF(HOUR, e.created_at, NOW()) > ?
      ORDER BY age_hours DESC
      ```

      In the dashboard output, if stale tasks exist, render a warning section using chalk yellow:
      ```
      ⚠  Stale Doing Tasks (>2h)
      ┌──────────┬──────────────────────────┬────────┬─────────┐
      │ Id       │ Title                    │ Owner  │ Age     │
      ├──────────┼──────────────────────────┼────────┼─────────┤
      │ tg-xxxx  │ Task title               │ agent  │ 4h 32m  │
      └──────────┴──────────────────────────┴────────┴─────────┘
      ```

      Include in both the live TUI view and the one-shot view.
      When --json, include stale_tasks array in the JSON output.
      Threshold configurable via `--stale-threshold <hours>` option, default 2.

  - id: self-report-done-flags
    content: "Add optional --tokens-in, --tokens-out, --tool-calls, and --attempt flags to tg done; store values in done event body JSON"
    agent: implementer
    changeType: modify
    docs: [schema, multi-agent]
    skill: cli-command-implementation
    intent: |
      Find the `tg done` command implementation (likely `src/cli/done.ts` or in `src/cli/index.ts`).

      Add four optional integer flags:
      - `--tokens-in <n>` — input tokens consumed by the implementer session
      - `--tokens-out <n>` — output tokens generated by the implementer session
      - `--tool-calls <n>` — total tool call invocations (shell, read, write, etc.)
      - `--attempt <n>` — which attempt this is (1 for first, 2 for first retry, etc.)

      When any of these flags are present, merge them into the done event body JSON alongside the existing `evidence` field:
      ```json
      {
        "evidence": "...",
        "timestamp": "...",
        "tokens_in": 12400,
        "tokens_out": 3200,
        "tool_calls": 47,
        "attempt": 1
      }
      ```

      Fields absent = field not present in JSON (not null). Queries downstream must use `JSON_EXTRACT` with NULL handling.

      Validate: values must be non-negative integers when provided. Fail with a clear error if they are not.

      No migration needed — these are new fields in an existing JSON column.

  - id: performance-docs
    content: "Write docs/performance.md covering system requirements for N parallel agents, tg stats interpretation guide, and optimization patterns from external research"
    agent: implementer
    changeType: create
    docs: [architecture]
    intent: |
      Create `docs/performance.md`. This doc should be authoritative for: system requirements, how to interpret stats output, and optimization patterns. It does NOT own CLI behavior (that stays in cli-reference.md) or schema (that stays in schema.md).

      Sections to include:

      **System Requirements for Parallel Sub-Agents**
      - Cursor's architecture: each sub-agent session is an isolated Composer context window
      - No published per-session RAM figures from Cursor. Community reports: IDE becomes sluggish with 4+ concurrent sessions
      - The binding constraint for N parallel agents is **token cost**, not machine RAM
        - Rough estimate at Sonnet 4.5 pricing: ~$0.45–$0.60 per task (implementer + reviewer round-trip)
        - 4 parallel tasks ≈ $1.80–$2.40 per execution wave
      - Recommended minimum: 16GB RAM, modern CPU (M1/M2 Mac or equivalent)
      - For 4–6 parallel agents: 32GB RAM recommended (each Cursor session + Node process + Dolt server)
      - CPU cores matter less than memory; single-threaded sequential agent is viable on 8GB

      **Interpreting tg stats Output**
      - `tg stats` — per-agent summary: tasks done, avg elapsed, review pass/fail rate
      - `tg stats --plan <id>` — plan-level: total duration, velocity (tasks/hr), per-task elapsed ranking
      - `tg stats --timeline` — cross-plan history: which plans took longest, trend over time
      - Stale task warning in `tg status` — signals abandoned sub-agent sessions or stuck implementations

      **Key Performance Metrics to Track**
      - Wall-clock elapsed per task (available from start/done event timestamps)
      - First-attempt pass rate (implementer succeeds without reviewer FAIL) — low pass rate = high rework cost
      - Plan velocity (tasks/hr) — normalize by task complexity for fair comparison
      - Average tool calls per task (self-reported via `tg done --tool-calls`) — high count = inefficient search patterns
      - Context size per task (proxy: `tg context <id>` output character count) — large context = high token cost

      **Optimization Patterns** (from external research: ITR paper, ACON, LangChain Deep Agents patterns)
      - `tg context` scope: the most impactful lever. Each sub-agent receives the context command output as its starting context. Trim to: task spec + relevant docs (listed in task.docs field) + immediate blockers only. Avoid dumping full plan history or unrelated docs.
      - Reviewer context: reviewer only needs task spec + git diff. Does not need full plan history. Reviewers should be dispatched with minimal context.
      - Skill guides: tasks with a `skill` field pass a focused how-to guide to the agent. This compresses context vs the agent exploring the codebase blind. Quantifiable: compare elapsed time and tool-call count for tasks with vs without skill assignments.
      - Fast model for implementers: implementer tasks that are well-specified and use skill guides can run on the fast model without quality loss. Reserve session-model inheritance for analyst, reviewer, and fixer sub-agents.
      - Token self-reporting: once agents begin passing `--tokens-in/out` to `tg done`, use `tg stats --plan` to find the highest token-consuming task types and optimize their prompts or skill guides first.

      **External Observability Options**
      - AI Observer (tobilg/ai-observer, MIT): if any workload moves to Claude Code CLI, set CLAUDE_CODE_ENABLE_TELEMETRY=1 + OTEL_EXPORTER_OTLP_ENDPOINT for per-turn token spans. Free, self-hosted, supports 67+ models.
      - Cursor Enterprise AI Code Tracking API: per-commit Composer attribution. Requires Enterprise plan.
      - For now, Dolt's event table is sufficient for task-level analytics; OTLP is a future upgrade path.

      Add frontmatter triggers so this doc is loaded for perf-related tasks:
      ```yaml
      ---
      triggers:
        keywords: ["performance", "benchmarking", "token", "analytics", "tg stats", "parallel agents", "context optimization"]
      ---
      ```

      Register `performance` slug in `docs/domains.md`.

  - id: stats-docs-update
    content: "Update docs/cli-reference.md with tg stats --plan and --timeline options and tg status stale-task warning"
    agent: implementer
    changeType: modify
    docs: [cli-reference]
    blockedBy: [stats-plan-view, stats-timeline, stale-task-warning]
    intent: |
      Add documentation to `docs/cli-reference.md` for the new options added in stats-plan-view, stats-timeline, and stale-task-warning tasks.

      For `tg stats`:
      - `tg stats --plan <planId>` — show plan total duration, velocity, per-task elapsed table
      - `tg stats --timeline` — show cross-plan history (started_at, title, status, duration, velocity)
      - All existing options remain; these are additive

      For `tg status`:
      - Stale-task warning section (appears when any task has been doing > 2h)
      - `tg status --stale-threshold <hours>` option (default 2)

      Follow existing cli-reference.md formatting conventions (headers, option tables, examples).

  - id: implementer-self-report-contract
    content: "Update implementer.md to document the tg done self-report convention (--tokens-in, --tokens-out, --tool-calls, --attempt)"
    agent: implementer
    changeType: modify
    blockedBy: [self-report-done-flags]
    intent: |
      Update `.cursor/agents/implementer.md` to document the self-report convention at `tg done` time.

      Add a new section (or extend the Evidence section) explaining:
      - When to use: if your agent environment exposes token usage (e.g., you can see input/output counts in your session), pass them
      - `--tokens-in <n>` — input tokens for this implementer session
      - `--tokens-out <n>` — output tokens generated by this implementer session
      - `--tool-calls <n>` — total number of tool calls made (shell, read, write, grep, glob, etc.)
      - `--attempt <n>` — 1 for first attempt, 2 for second (after a reviewer FAIL), etc.
      - All flags are optional; omit if you don't have the data
      - Example: `tg done tg-xxxx --evidence "implemented X; gate passed" --tokens-in 14200 --tokens-out 3800 --tool-calls 52 --attempt 1`

      Keep it concise; agents should not spend significant effort estimating these values. If readily available, report them. If not, skip.

  - id: stats-token-view
    content: "Extend tg stats to surface token and tool-call aggregates when self-report data is present in done event bodies"
    agent: implementer
    changeType: modify
    docs: [schema, cli-reference]
    skill: cli-command-implementation
    blockedBy: [self-report-done-flags]
    intent: |
      Extend `src/cli/stats.ts` to query and display token/tool-call aggregates from done event bodies, when that data is present.

      Add to the default `tg stats` output (or as a new section visible whenever non-null data exists):
      ```sql
      SELECT
        t.owner AS agent,
        COUNT(*) AS tasks_done,
        AVG(CAST(JSON_EXTRACT(e.body, '$.tokens_in') AS UNSIGNED)) AS avg_tokens_in,
        AVG(CAST(JSON_EXTRACT(e.body, '$.tokens_out') AS UNSIGNED)) AS avg_tokens_out,
        AVG(CAST(JSON_EXTRACT(e.body, '$.tool_calls') AS UNSIGNED)) AS avg_tool_calls,
        SUM(CAST(JSON_EXTRACT(e.body, '$.tokens_in') AS UNSIGNED)) AS total_tokens_in,
        SUM(CAST(JSON_EXTRACT(e.body, '$.tokens_out') AS UNSIGNED)) AS total_tokens_out
      FROM task t
      JOIN event e ON e.task_id = t.task_id AND e.kind = 'done'
      WHERE JSON_EXTRACT(e.body, '$.tokens_in') IS NOT NULL
      GROUP BY t.owner
      ```

      If zero rows have tokens data: skip the section entirely (graceful degradation).
      If data exists: render a "Token Usage" table section.

      Also extend `tg stats --plan <id>` (from stats-plan-view) to include per-task token costs when present:
      - Add `tokens_in`, `tokens_out`, `tool_calls` columns to the per-task elapsed table
      - Show N/A when absent for a given task

  - id: context-audit
    content: "Audit tg context output scope; trim to task spec + relevant docs + immediate blockers; measure character count reduction"
    agent: implementer
    changeType: modify
    docs: [architecture, schema]
    intent: |
      Find `src/cli/context.ts` (or wherever `tg context <taskId>` is implemented).

      **Audit what gets included today:**
      - Run `pnpm tg context <any-completed-taskId>` and capture the character count of the output
      - Map each section: what is shown, how many characters, is it always needed

      **Goal:** trim context to the minimum needed for an implementer:
      1. Task spec (id, title, intent, suggestedChanges, changeType) — always include
      2. Plan overview (name, overview) — include as 1-2 lines only, not full plan YAML
      3. Relevant docs: only docs listed in task.docs field (not all docs)
      4. Immediate blockers: title + done evidence for each blocker task — not full history
      5. Blocked-by chain: go only 1 level deep (direct blockers, not transitive)

      **Remove or truncate:**
      - Full plan YAML dump (if present)
      - Unrelated done tasks in the same plan
      - Full doc content when only a section is relevant (if feasible, link to doc instead)

      **Measurement:** add a note at the bottom of context output: `[context: ~N chars, ~M tokens]` (estimate tokens as chars/4).

      **Document findings in docs/performance.md** under the `tg context` optimization section: before/after character counts, which sections were trimmed, estimated token savings per task.

      If changes to context output would break existing tests, update those tests.

  - id: stats-integration-tests
    content: "Write integration tests for new tg stats --plan and --timeline options"
    agent: implementer
    changeType: create
    docs: [testing]
    blockedBy: [stats-plan-view, stats-timeline, stats-token-view]
    intent: |
      Add integration tests for the new `tg stats` options following the patterns in `__tests__/integration/`.

      Tests to write:

      1. `tg stats --plan <planId>` — create a test plan with 2 tasks, start and done them, then assert:
         - Output contains plan title, total elapsed, velocity
         - Per-task elapsed table shows both tasks sorted by elapsed DESC
         - --json outputs structured data with planSummary and tasks arrays

      2. `tg stats --timeline` — with 2 plans completed, assert:
         - Output shows both plans in date-DESC order
         - Columns present: started_at, title, status, task_count, duration
         - --json works

      3. `tg stats` with self-report data — done a task with `--tokens-in 1000 --tokens-out 200`, assert:
         - Token Usage section appears in output
         - avg_tokens_in, avg_tokens_out columns shown

      4. `tg stats` with no self-report data — assert Token Usage section does not appear.

      Follow test isolation patterns: use `tmp` directories, fresh Dolt repos per test, execa-based CLI calls.
isProject: false
---

## Analysis

This plan has three parallel tracks that can all start from day one, plus a second wave that depends on the first track completing.

### What's already free — no code needed

The planner-analyst confirmed that the Dolt event table already captures `started` and `done` events with `created_at` timestamps. This means plan duration, per-task elapsed time, plan velocity, and cross-plan history are **already in the database** — they just haven't been surfaced via `tg stats`. The first three tasks (stats-plan-view, stats-timeline, stale-task-warning) are SQL-query tasks against existing data, no schema changes.

### Token tracking: the architectural constraint

The most important finding from both the analyst and external research: **Cursor does not expose per-session token counts to non-Enterprise users**. Token tracking must be agent self-report (optional flags on `tg done`). This is low-friction (agents pass values when they have them), gracefully degrades (fields omitted = section hidden in stats), and builds toward a real signal over time.

External research (arXiv ITR paper, ACON) confirms that `tg context` output size is the highest-leverage optimization target — a 95% context reduction per-step is theoretically achievable for well-scoped tasks. The `context-audit` task addresses this directly.

### Why this sequencing

Wave 1 tasks are all independent:

- `stats-plan-view`, `stats-timeline`, `stale-task-warning` — SQL query extensions, no blockers
- `self-report-done-flags` — adds flags to `tg done`, no dependency on stats changes
- `performance-docs` — pure documentation, no code dependency
- `context-audit` — reads context command, audit + trim, independent

Wave 2 tasks wire the pieces together:

- `stats-docs-update` — can only be written once the new flags exist
- `implementer-self-report-contract` — can only be written once `tg done` flags are in
- `stats-token-view` — needs done event body to have token fields before it's useful to surface them
- `stats-integration-tests` — needs stats-plan-view and stats-token-view to be testable

### External research highlights

From web research (March 2026):

- **Cursor 2.0** supports up to 8 parallel agents but with redundancy (run 8, pick best). Our sequential pipeline (implementer → reviewer) is already cost-efficient by design.
- **Token cost is the binding constraint**, not RAM. ~$0.45–$0.60 per task at Sonnet 4.5 pricing for a standard implementer+reviewer round trip.
- **AI Observer** (tobilg/ai-observer, MIT): free self-hosted OTLP dashboard; worth evaluating if any workload moves to Claude Code CLI.
- **Communication tax**: up to 86% token duplication in multi-agent systems. `tg context` scoping is our primary mitigation.
- **SWE-Bench Pro** (2025) measures long-horizon enterprise tasks hours-to-days. Our first-attempt pass rate is the analogue — directly computable from done/note events already.

## Dependency Graph

```
Wave 1 — all parallel (no blockers):
  ├── stats-plan-view         (extends tg stats with --plan)
  ├── stats-timeline          (extends tg stats with --timeline)
  ├── stale-task-warning      (adds warning to tg status)
  ├── self-report-done-flags  (adds --tokens-in/out/tool-calls/attempt to tg done)
  ├── performance-docs        (create docs/performance.md)
  └── context-audit           (audit + trim tg context output)

Wave 2 — after respective wave 1 tasks:
  ├── stats-docs-update       (after stats-plan-view + stats-timeline + stale-task-warning)
  ├── implementer-self-report-contract  (after self-report-done-flags)
  └── stats-token-view        (after self-report-done-flags)

Wave 3 — integration:
  └── stats-integration-tests (after stats-plan-view + stats-timeline + stats-token-view)
```

<original_prompt>
Okay, this is pretty much good for... I'll kind of-- solid stable launch with all the kind of original features as kind of planned. The thing I would like to do now is step back and do a high level review from a performance standpoint. Um... I'm noticing that The sub-agents do a lot of terminal requests. probably because of... the way they get spun up. It could also be just a lack of resources on my computer, which is totally fine. If that's the issue, I'm not too worried. Maybe we would just need to Uh... provide recommended specs information and say, This is a to run multiple, so many terminals for so many sub-agents requires quite a lot of memory. Um... I'm also... garbage collection and making sure that we're preserving memory as best we can. I don't know how WorldCursor does this. It looks like most of the terminals are getting shut down. maybe a volume thing. There might be other things as well. I'd like you to look online and research other systems optimized We already did a great push on our tests and making sure the tests ran really fast because they were slowing down the sub-agents. So now I'm just looking for more general performance review and performance improvements that we could identify. To do this, we probably need to build some benchmarking tools so we can start editing different configurations. Otherwise, we're just going to be continue to be kind of firing them from the hip based upon in stats alone. Uh... Yeah, make me a plan for reviewing our performance and the to do's related to, uncovering intelligence, searching online, building tools for analyzing parts of a building better reporting pages or dashboards on performance, essentially. give us the full suite of what we need to continuously improve performance. Um... Data, like analytics on at the end of delivering projects. So we track how much time it took to deliver a task, how many tokens it took, how many Um... How many tokens and tasks were... Yeah, we probably need to do something around for each project we want to know. How many tokens were used for... the pre-model, and then if we're using subages that are fast, we use them in fast models, presumably Composer or Under the Hood. But like capturing that capturing them at a time maybe capturing them tool calls or terminals spun up just like let's start capturing some data about of how well our projects and tasks are getting executed.
</original_prompt>
