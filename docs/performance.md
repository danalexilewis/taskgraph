---
triggers:
  files: ["docs/performance.md", "src/**"]
  change_types: ["create", "modify"]
  keywords: ["performance", "benchmarking", "token", "analytics", "tg stats", "parallel agents", "context optimization", "resource", "memory", "specs"]
---

# Performance

This doc covers system requirements for running parallel sub-agents, how to interpret `tg stats` output, and optimization patterns for reducing token cost and execution time.

## Purpose

This domain owns: recommended hardware specs for N parallel agents, key performance metrics and how to track them, interpretation of `tg stats` output, context optimization guidance, and external observability options.

It does NOT own: CLI command syntax (→ `docs/cli-reference.md`), schema design (→ `docs/schema.md`), or multi-agent coordination protocol (→ `docs/multi-agent.md`).

## System Requirements for Parallel Sub-Agents

Cursor does not publish per-session RAM figures. Community reports indicate IDE sluggishness with 4+ concurrent Composer sessions. The practical binding constraint for N parallel agents is **token cost**, not machine RAM.

### Token cost estimates (Sonnet 4.5 pricing)

| Parallel agents | Approx. cost per wave | Notes |
|---|---|---|
| 1 (sequential) | ~$0.45–$0.60 | Implementer + reviewer round-trip |
| 2–3 | ~$0.90–$1.80 | Standard for most plans |
| 4–6 | ~$1.80–$3.60 | Reasonable for large plans |
| 8 | ~$3.60+ | Cursor 2.0 max; redundancy model |

### Hardware recommendations

| Scenario | Minimum | Recommended |
|---|---|---|
| 1–2 parallel agents | 8 GB RAM, any modern CPU | 16 GB RAM |
| 3–4 parallel agents | 16 GB RAM | 32 GB RAM, M1/M2 Mac or equivalent |
| 5–8 parallel agents | 32 GB RAM | 64 GB RAM; ensure SSD swap |

Each active Cursor agent session, Node.js process, and Dolt server each consume RAM independently. CPU core count matters less than total RAM and single-core speed (Cursor is largely single-threaded per session).

### Terminal/process overhead

Each sub-agent gets an isolated terminal. With 4 parallel implementers + 4 reviewers + the orchestrator session, expect 9–10 active terminal processes. On macOS this is typically fine; on 8 GB systems it may cause swapping. If you observe IDE sluggishness: reduce parallel batch size in the plan's task structure (use more `blockedBy` edges to sequence tasks).

## Key Performance Metrics

These metrics are available from the Dolt event table without any additional capture:

| Metric | How to get it | Command |
|---|---|---|
| Per-task elapsed time | `started` → `done` event TIMESTAMPDIFF | `tg stats --plan <id>` |
| Plan total duration | MIN(started) → MAX(done) for all tasks | `tg stats --plan <id>` |
| Plan velocity | tasks ÷ duration in hours | `tg stats --plan <id>` |
| Cross-plan history | Timeline of all plans with duration | `tg stats --timeline` |
| Reviewer pass/fail rate | `note` events with `"type":"review"` | `tg stats` (default view) |
| Stale doing tasks | Doing tasks older than threshold | `tg status` warning section |

Self-reported metrics (agents pass via `tg done` flags):

| Metric | Flag | Interpretation |
|---|---|---|
| Input tokens | `--tokens-in <n>` | Context + prompt tokens for this session |
| Output tokens | `--tokens-out <n>` | Generated tokens; higher = more work done |
| Tool calls | `--tool-calls <n>` | Higher count = more search/edit cycles |
| Attempt number | `--attempt <n>` | >1 means reviewer FAIL; high count = spec quality issue |

## Interpreting `tg stats` Output

### Default view: `tg stats`

Shows per-agent summary: tasks completed, average elapsed time, review pass/fail rate, and (when self-report data is present) token usage aggregates by agent.

**What to look for:**
- Agent with low pass rate → implementer prompt or task intent quality issue
- Agent with high avg elapsed → task is under-specified or hitting environment issues
- High `avg_tool_calls` → agent is searching the codebase excessively; improve `tg context` scope or skill guide

### Plan view: `tg stats --plan <planId>`

Shows: plan total duration, velocity (tasks/hr), and per-task elapsed table sorted slowest-first with optional token columns.

**What to look for:**
- Outlier tasks that took 10x longer than the median → poorly specified or high-complexity task; consider splitting in future plans
- Low velocity (<1 task/hr) → serial dependencies bottlenecking execution; increase parallelism in plan structure
- High `tokens_in` on a task → context delivered by `tg context` was large; review context scope

### Timeline view: `tg stats --timeline`

Shows all plans with start date, status, task count, duration, and velocity sorted newest-first.

**What to look for:**
- Velocity trend over time: are plans getting faster or slower?
- Plans with no duration (N/A) → no started/done events; tasks may have been done with `--force` bypassing events
- Status distribution: how many plans are abandoned vs. completed?

### Stale task warning in `tg status`

When `tg status` shows the "⚠ Stale Doing Tasks" section, it means a sub-agent session was likely abandoned. Use `tg done <taskId> --evidence "completed previously" --force` if the work is done, or restart the task with a fresh sub-agent.

## Optimization Patterns

### `tg context` scope — highest-leverage optimization

Context delivered to each sub-agent is the primary driver of token cost. The context-audit task (2026-03-01) reduced output by ~35% by:
- Trimming to: task spec + plan name/overview + relevant docs (from task.docs field) + immediate blockers only
- Removing: full plan YAML, unrelated done tasks from the same plan
- Adding: `[context: ~N chars, ~M tokens]` footer for visibility

**Budget target:** aim for <3000 chars (~750 tokens) per context output. High-quality skill guides and focused task intent are more effective than large context dumps.

### Skill guides compress agent behavior

Tasks with a `skill` field in the plan YAML receive a focused how-to guide (e.g. `docs/skills/cli-command-implementation.md`). This replaces open-ended codebase exploration with targeted guidance. Quantifiable signal: compare `avg_tool_calls` for tasks with vs without skill assignments.

### Fast model for implementers

Implementers run on `model="fast"` by default. This is intentional: quality comes from well-specified task intent + context, not model tier. Reserve session-model inheritance (Sonnet) for analysts, reviewers, and fixer agents.

### Reviewer context minimization

Reviewer sub-agents only need: task spec + git diff. They do not need full plan history. Dispatch reviewers with a minimal prompt focused on the diff and the task's acceptance criteria.

### Sequential pipeline beats parallel redundancy (for this system)

External research (arXiv ITR, 2025): sequential specialized agents outperform parallel general agents on cost-efficiency for pipelines with clear step dependencies. The implementer→reviewer→done pipeline is already the right architecture. Token overhead from passing context between agents is ~25–35% but is bounded; the alternative (single large agent) has no review pass and higher retry costs.

### Identifying hot spots

Use this workflow to find where time and tokens are going:

1. `tg stats --timeline` — find the slowest plan
2. `tg stats --plan <id>` — find the slowest tasks in that plan
3. For tasks with high `tool_calls`: read the task intent and check if it was under-specified or missing a skill guide
4. For tasks with long elapsed: check if they had a reviewer FAIL (look for `attempt: 2` in token data or `tg note` events)

## Query Result Cache

An in-process, TTL-based query result cache sits between the CLI commands and the Dolt query layer. It stores query results in memory and invalidates entries by table name when a write occurs on that table.

### What it is

- **In-memory key/value store**: results are keyed by query string + args. No persistence; cache is cleared on process exit.
- **TTL-based expiry**: each entry expires after `TTL_MS` milliseconds. Once expired, the next call goes to Dolt and repopulates the cache.
- **Table-level invalidation**: write operations (INSERT, UPDATE, etc.) invalidate all cached entries for the affected table, ensuring consistency without requiring global cache flushes.

### When it helps

| Scenario | Benefit |
|---|---|
| Dashboard polling (`tg status` repeated every 1–2 s) | Eliminates redundant Dolt queries between data changes |
| Migration checks (run before every command) | Avoids re-querying the migrations table on back-to-back CLI invocations |
| Future server-mode sessions | Amortises query cost across multiple in-process requests |

### How to enable

**Via environment variable:**

```bash
TG_QUERY_CACHE_TTL_MS=1500 pnpm tg status
```

**Via `.taskgraph/config.json`:**

```json
{
  "queryCacheTtlMs": 1500
}
```

**Defaults:**

| Mode | Default TTL |
|---|---|
| CLI (single command) | `0` (disabled) |
| Dashboard mode | `1500 ms` (applied automatically regardless of config) |

Setting TTL to `0` disables the cache entirely; all queries pass through directly to Dolt.

### Note on Dolt and query caching

Dolt has no built-in query result cache. MySQL 8 removed the query cache (deprecated in MySQL 5.7). Application-layer caching — as implemented here — is the only option for amortising repeated identical reads.

## Dolt sql-server Mode (Performance)

Running a persistent `dolt sql-server` eliminates the ~150 ms process-spawn overhead of the default `dolt --data-dir ... sql -q` execa path. This is the single biggest performance lever for high-frequency workloads (dashboard mode, parallel agents, CI).

### When it matters

| Workload | Default (execa) | sql-server pool |
|---|---|---|
| Single CLI command | ~150 ms/query | ~5 ms/query |
| Dashboard (`tg status` polling) | ~450 ms per refresh | ~15 ms per refresh |
| Parallel agents (N concurrent) | N × 150 ms | ~5 ms, shared pool |
| Integration tests | ~150 ms/query | ~5 ms/query |

### Setup

```bash
# Start a persistent Dolt sql-server (defaults: port 3306, no auth)
dolt sql-server --port 3306 --data-dir .taskgraph/dolt

# Activate pool mode in the CLI
export TG_DOLT_SERVER_PORT=3306
export TG_DOLT_SERVER_DATABASE=dolt
```

For full environment variable reference see [docs/infra.md → Environment variables](infra.md#environment-variables).

### Integration test infrastructure

`__tests__/integration/global-setup.ts` starts a Dolt sql-server on a dynamic port for each test run and sets `TG_DOLT_SERVER_PORT` / `TG_DOLT_SERVER_DATABASE` so all integration test queries use the pool. Teardown calls `closeServerPool` before killing the server. See [docs/testing.md](testing.md) for per-test isolation patterns.

## External Observability Options

For deeper token-level analytics beyond what `tg stats` provides:

| Option | When to use | Link |
|---|---|---|
| **AI Observer** (tobilg/ai-observer, MIT) | If any workload moves to Claude Code CLI; free OTLP dashboard with 67+ model cost tracking | https://ai-observer.dev |
| **Cursor Enterprise AI Code Tracking API** | Enterprise plan; per-commit Composer attribution | cursor.com/docs/api |
| **OpenTelemetry** | If you want to pipe `tg start`/`tg done` events to Grafana or Jaeger | Emit OTLP spans from event hooks |

For now, Dolt's event table is the primary analytics store. OTLP integration is a future upgrade path if volume or reporting needs grow.

## Related Projects

- Performance Intelligence (2026-03-01) — added `tg stats --plan`, `tg stats --timeline`, stale-task warning, `tg done` self-report flags, and `tg context` scope compression
