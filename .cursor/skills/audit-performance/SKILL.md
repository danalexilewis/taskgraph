---
name: audit-performance
description: Performance audit skill that dispatches a Performance Architect lead with parallel ferret-search sub-agents to identify bottlenecks, anti-patterns, and schema/query inefficiencies. Deeply Dolt-aware. Uses a pre-compute race pattern: a setup agent computes shared context (schema snapshot, query catalog, file hotmap) and stores it via tg notes while investigation agents run in parallel — agents receive shared context mid-operation. Produces a prioritised remediation plan. Use when the user says /audit-performance, "audit perf", "performance review", "find bottlenecks", or wants to assess system performance.
---

# Audit Performance

**You are the Performance Architect lead.** Your mandate is to find, assess, and prioritise performance issues across schema design, query patterns, code hotpaths, and Dolt-specific infrastructure. You do not implement fixes — you produce a ranked evidence-backed remediation plan.

**Shared learnings for sub-agents:** [.cursor/agent-utility-belt.md](../../agent-utility-belt.md).

## Architecture

| Role       | Agent                 | Mode      | Model                  | Purpose                                                          |
| ---------- | --------------------- | --------- | ---------------------- | ---------------------------------------------------------------- |
| Lead (you) | Performance Architect | read-only | inherit (session model) | Coordinate, synthesise, plan                                     |
| Setup      | pre-compute agent     | read-only | inherit                | Snapshot shared context → `tg note` race                         |
| Scanner A  | schema-profiler       | read-only | fast                   | Index coverage, Dolt branch design, table sizing                 |
| Scanner B  | query-auditor         | read-only | fast                   | N+1 patterns, unbounded scans, hot SQL ferret search             |
| Scanner C  | hotpath-tracer        | read-only | fast                   | Expensive code loops, repeated computation, sync-in-async        |
| Scanner D  | anti-pattern-scanner  | read-only | fast                   | Broad sweep: memoisation gaps, deep clones, re-compute cycles    |
| Scanner E  | dolt-specialist       | read-only | fast                   | Diff ops on hotpaths, versioned-table scan patterns, merge costs |

**All agents are read-only.** No file edits, no DB mutations.

## Decision tree

```mermaid
flowchart TD
    A[/audit-performance] --> B[Step 1: Orient — tg status, read docs]
    B --> C[Step 2: Identify shared computations]
    C --> D[Step 3: Dispatch pre-compute agent + 5 scanners in parallel]
    D --> E[Race: setup agent stores notes while scanners investigate]
    E --> F[Step 4: Collect all findings]
    F --> G[Step 5: Deduplicate + rank by severity × impact]
    G --> H[Step 6: Synthesise into remediation plan]
    H --> I[Present plan to user]
```

## Step 1 — Orient

```bash
pnpm tg status --tasks   # active work context
```

Then do a fast pass over relevant docs:

- `docs/schema.md` — table shapes, Dolt branch design
- `docs/architecture.md` — module boundaries, data flow
- `docs/infra.md` — build, deploy, infrastructure constraints
- Any domain docs matching the area under audit

Extract:

- **Focus area** — which subsystem / plan the user wants audited (default: whole codebase)
- **Known concerns** — any bottlenecks or slow paths the user mentioned
- **Task anchor** — if a task exists for this audit, note its ID for storing notes; otherwise create one with `tg task new "Perf audit findings" --plan <activePlan>`

## Step 2 — Identify shared computations

Before dispatching any agent, decide what **shared context** all scanners will need so you can have the pre-compute agent race to provide it.

Common shared computations:

| Computation                | Command                                                                      | Note key                 |
| -------------------------- | ---------------------------------------------------------------------------- | ------------------------ |
| Schema snapshot            | `pnpm tg status --json` or direct Dolt query                                 | `[SHARED] schema`        |
| SQL/query catalog          | `rg -l "\.query\|sql\|SELECT\|INSERT" src/`                                  | `[SHARED] query-catalog` |
| File hotmap (most-changed) | `git log --name-only --pretty="" \| sort \| uniq -c \| sort -rn \| head -40` | `[SHARED] hotmap`        |
| Dolt table list            | `cd .taskgraph/dolt && dolt sql -q "SHOW TABLES;"`                           | `[SHARED] dolt-tables`   |
| Large function map         | `rg "function\|=>" src/ --stats`                                             | `[SHARED] fn-map`        |

Select the 3–5 most relevant for the current audit scope. List them explicitly in the pre-compute agent prompt so it stores each as a separate `tg note`.

## Step 3 — Dispatch all agents in one turn

**Emit all Task calls in the same response turn** — pre-compute agent plus all 5 scanners simultaneously (see `.cursor/agent-utility-belt.md` § Parallel sub-agent dispatch). Cursor decides parallelism. (Dispatch all 5 scanners with `model="fast"` (explore type); omit `model` for the pre-compute setup agent so it inherits the session model.)

### Pre-compute agent prompt

```
You are the pre-compute setup agent for a performance audit. Your only job is to run the listed computations as fast as possible and store each result as a tg note on task {{TASK_ID}}.

Run these computations:
{{SHARED_COMPUTATIONS_LIST}}

For each result, run:
  pnpm tg note {{TASK_ID}} --msg "[SHARED] <key>: <result>"

Keep results compact — scanners will read them from notes. Truncate large outputs to the most relevant 50 lines. Store each computation as a separate note.

After all notes are stored, return: "SETUP COMPLETE: stored N notes on {{TASK_ID}}"

Do NOT read or analyse the results yourself. Just store them. Speed matters — other agents are racing you.
```

### Scanner prompts

See [sub-agents.md](sub-agents.md) for the full prompt templates for each scanner. Inject:

- `{{TASK_ID}}` — the findings task ID
- `{{FOCUS_AREA}}` — subsystem or path scope
- `{{KNOWN_CONCERNS}}` — any bottlenecks/concerns from Step 1
- `{{DOLT_PATH}}` — path to the Dolt DB (usually `.taskgraph/dolt`)

**Mid-operation note pickup:** Each scanner should check `pnpm tg context {{TASK_ID}}` once during its investigation (after its initial sweep) to pick up any notes the pre-compute agent has stored. This gives them the shared context if the race resolved in time.

## Step 4 — Collect findings

Each scanner returns a **structured findings block** (see sub-agents.md for format). Collect all five.

## Step 5 — Deduplicate and rank

For each finding, score by:

```
severity (1–3) × impact_breadth (1–3) × fix_cost_inverse (1–3)
```

| Severity | Meaning                                                                      |
| -------- | ---------------------------------------------------------------------------- |
| 3        | Immediate degradation — O(n²) loops, full-table scans, blocking sync I/O     |
| 2        | Accumulating cost — unnecessary recomputation, missing index on common query |
| 1        | Latent / architectural — patterns that will hurt at scale                    |

Deduplicate overlapping findings from different scanners. Tag each with its source scanner(s).

## Step 6 — Synthesise remediation plan

Produce the plan in the output format below. If the user said "proceed" or "execute", import it immediately:

```bash
# Write plan file
plans/<date>_perf_audit_<area>.md

# Import
pnpm tg import plans/<file> --plan "Perf Audit: <area>" --format cursor
```

## Output format

```markdown
## Performance Audit: [Area]

**Scope:** [subsystem / date]
**Scanners run:** schema-profiler, query-auditor, hotpath-tracer, anti-pattern-scanner, dolt-specialist
**Pre-compute notes stored:** [N] on task [ID]

---

### Executive Summary

[2–3 sentences: what is the most urgent problem and what class of fix it needs]

---

### Findings — Ranked

| #   | Finding       | Severity    | Area     | Scanner(s) |
| --- | ------------- | ----------- | -------- | ---------- |
| 1   | [description] | 🔴 Critical | [module] | [scanner]  |
| 2   | ...           | 🟡 Moderate | ...      | ...        |
| 3   | ...           | 🟢 Latent   | ...      | ...        |

#### Finding 1: [Title]

- **Evidence:** [specific file:line, query, or pattern]
- **Why it's slow:** [mechanism]
- **Dolt context:** [if applicable — how Dolt's versioning makes this worse or better]
- **Fix approach:** [short description]

[Repeat for each finding]

---

### Remediation Tasks

1. [Task title] — [intent] `agent: implementer`
2. ...

### Next steps

[e.g. "Run /work to execute remediation tasks" or "Review findings and approve plan before executing"]
```

## Dolt performance reference

Key Dolt gotchas the scanners are trained to find:

- **Full dolt diff on every request** — `dolt_diff_*` table scans are expensive; cache or batch.
- **Large branch fan-out** — many short-lived branches on high-write tables create GC pressure.
- **Keyless table merges** — expensive conflict detection; prefer keyed tables for performance-sensitive data.
- **JSON column merges** — Dolt's JSON merge is key-level; deeply nested JSON objects can cause spurious conflicts and slow merges.
- **Unbounded `SHOW TABLES`** — on databases with hundreds of versioned tables this is O(tables × branches).
- **Read from working set vs HEAD** — queries on the working set read uncommitted data and bypass the read cache.
- **No index on `commit_hash`** — common in app code that queries `dolt_log`; always filter by branch first.

## Rules

- **Read-only**: All agents. No file edits, no `dolt commit`, no destructive SQL.
- **Race pattern**: Pre-compute agent stores notes; scanners check notes mid-operation via `tg context`. Don't wait — start investigating immediately.
- **One plan**: All remediation tasks go into a single plan named `Perf Audit: <area>`.
- **No implementation here**: This skill produces findings and a plan. Fixes are for the implementer.
- **Dolt awareness**: Every finding should note whether Dolt's versioning model amplifies or mitigates the issue.

## Additional resources

- Full scanner prompt templates: [sub-agents.md](sub-agents.md)
- Dolt performance reference: [docs/infra.md](../../docs/infra.md)
- Schema design: [docs/schema.md](../../docs/schema.md)
