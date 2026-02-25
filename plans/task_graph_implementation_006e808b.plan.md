---
name: Task Graph Implementation
overview: "Build the Task Graph CLI (`tg`) backed by Dolt, following the four milestones: M0 (Skeleton), M1 (Execution loop), M2 (Visualization), M3 (Portfolio), M4 (Plan import). Code lives in `tools/taskgraph/`, using the `dolt sql -q` approach via execa for reliability."
todos:
  - id: m0-scaffold
    content: "M0: Project scaffolding — package.json, tsconfig.json, install deps (commander, execa, zod, uuid), create directory structure under tools/taskgraph/"
    status: completed
  - id: m0-db
    content: "M0: DB layer — connection.ts (dolt sql -q wrapper), commit.ts (dolt add + commit), migrate.ts (CREATE TABLE IF NOT EXISTS for all 5 tables)"
    status: completed
  - id: m0-domain
    content: "M0: Domain types — Zod schemas and TS types for plan, task, edge, event, decision"
    status: completed
  - id: m0-cli-init
    content: "M0: CLI entry + tg init — commander setup, dolt repo creation, migration runner, config writer"
    status: completed
  - id: m0-plan-task-edge
    content: "M0: tg plan new, tg task new, tg edge add — insert commands with events and dolt commits"
    status: completed
  - id: m0-agent-md
    content: "M0: Write AGENT.md with the agent operating contract"
    status: completed
  - id: m1-invariants
    content: "M1: Domain invariants — cycle detection, runnable check, status transition guards"
    status: completed
  - id: m1-next-show
    content: "M1: tg next (runnable query + ordering) and tg show (details + blockers + dependents + events)"
    status: completed
  - id: m1-start-done
    content: "M1: tg start (with runnable guard + event) and tg done (with evidence + event)"
    status: completed
  - id: m1-block-split
    content: "M1: tg block (edge + status + event) and tg split (decompose + wire edges + event)"
    status: completed
  - id: m2-export
    content: "M2: tg export mermaid and tg export dot — graph visualization output"
    status: completed
  - id: m3-portfolio
    content: "M3: tg portfolio overlaps and tg portfolio hotspots"
    status: completed
  - id: m4-import
    content: "M4: Markdown plan importer — parser + upsert by external_key + tg import command"
    status: completed
isProject: false
---

# Task Graph Implementation Plan

## Starting Point

- Repo is empty (only `README.md`).
- Dolt v1.82.4 is installed at `/usr/local/bin/dolt`.
- Git on `main`, clean working tree.

## Architecture Decisions

- **CLI framework**: `commander` (cleaner TypeScript types than yargs, spec-listed first)
- **DB access**: `dolt sql -q` via `execa` (approach 2 from spec — simpler, robust, no server needed)
- **ID generation**: `uuid` v4
- **Validation**: `zod` for all input schemas and event body shapes
- **Build**: `tsx` for dev execution, `tsup` or `tsc` for compilation
- **Bin entry**: `package.json` `"bin": { "tg": "./dist/cli/index.js" }` with `npm link` for local use

## Repository Layout

```
tools/taskgraph/
  src/
    cli/           # commander commands
      index.ts     # entry point, registers all commands
      init.ts
      plan.ts      # plan new
      task.ts      # task new
      edge.ts      # edge add
      next.ts
      show.ts
      start.ts
      done.ts
      block.ts
      split.ts
      export.ts    # mermaid / dot
      portfolio.ts # overlaps / hotspots
      import.ts    # plan import from markdown
    db/
      connection.ts  # executes `dolt sql -q` via execa, returns parsed rows
      migrate.ts     # idempotent schema creation
      queries.ts     # parameterized SQL builders
      commit.ts      # wraps `dolt add -A && dolt commit -m "..."`
    domain/
      types.ts       # TypeScript types + Zod schemas for plan, task, edge, event, decision
      invariants.ts  # cycle detection, status-transition guards, blocker checks
    export/
      mermaid.ts     # graph -> Mermaid TD text
      dot.ts         # graph -> Graphviz DOT
    plan-import/
      parser.ts      # markdown -> task/edge extraction
      importer.ts    # upsert logic with stable keys
  package.json
  tsconfig.json
plans/               # Cursor Plan docs (narrative layer)
AGENT.md             # Agent contract
.taskgraph/
  config.json        # local config (db path, etc.)
```

## DB Layer Design (`src/db/`)

`connection.ts` — core execution function:

```typescript
import { execa } from 'execa';

export async function doltSql(query: string, repoPath: string): Promise<any[]> {
  const { stdout } = await execa('dolt', ['sql', '-q', query, '-r', 'json'], { cwd: repoPath });
  return JSON.parse(stdout)?.rows ?? [];
}
```

`commit.ts` — wraps dolt commits:

```typescript
export async function doltCommit(msg: string, repoPath: string): Promise<void> {
  await execa('dolt', ['add', '-A'], { cwd: repoPath });
  await execa('dolt', ['commit', '-m', msg, '--allow-empty'], { cwd: repoPath });
}
```

`migrate.ts` — runs `CREATE TABLE IF NOT EXISTS` for all five tables (plan, task, edge, event, decision) plus the `external_key` column on task for M4.

## Dolt Schema

Exactly as specified. Five tables: `plan`, `task`, `edge`, `event`, `decision`. All UUIDs are `CHAR(36)`. Enums for status fields. JSON columns for `acceptance`, `options`, `body`. Composite PK on `edge(from_task_id, to_task_id, type)`.

One addition for M4: `task.external_key VARCHAR(128) NULL UNIQUE` for stable markdown keys.

## Domain Layer (`src/domain/`)

`types.ts` — Zod schemas that double as runtime validators:

- `PlanSchema`, `TaskSchema`, `EdgeSchema`, `EventSchema`, `DecisionSchema`
- Status enums: `PlanStatus`, `TaskStatus`, `EdgeType`, `EventKind`, `Actor`, `Risk`

`invariants.ts`:

- `assertNoBlockerCycle(fromId, toId, edges)` — BFS/DFS cycle detection on `blocks` edges
- `assertRunnable(taskId)` — checks no unmet blockers
- `assertValidTransition(current, next)` — state machine: `todo->doing->done`, `todo->blocked`, `doing->blocked`, `blocked->todo` (when unblocked)

## CLI Commands Detail

Each command file exports a function that receives the `commander.Command` and adds its subcommand. All commands:

1. Load config from `.taskgraph/config.json` to get `repoPath`
2. Execute DB queries via `doltSql()`
3. Unless `--no-commit`, call `doltCommit()` with default or custom message
4. Support `--json` flag for machine-readable output

`**tg next**` query (the most complex SQL):

```sql
SELECT t.task_id, t.title, p.title as plan_title, t.risk, t.estimate_mins,
  (SELECT COUNT(*) FROM edge e 
   JOIN task bt ON e.from_task_id = bt.task_id 
   WHERE e.to_task_id = t.task_id AND e.type = 'blocks' 
   AND bt.status NOT IN ('done','canceled')) as unmet_blockers
FROM task t
JOIN plan p ON t.plan_id = p.plan_id
WHERE t.status = 'todo'
HAVING unmet_blockers = 0
ORDER BY p.priority DESC, t.risk ASC, 
  CASE WHEN t.estimate_mins IS NULL THEN 1 ELSE 0 END,
  t.estimate_mins ASC, t.created_at ASC
LIMIT ?
```

`**tg split**` — creates N new tasks copying `plan_id`, `feature_key`, `area` from original; adds edges original->new; creates `split` event with mapping JSON; optionally cancels original.

## AGENT.md

Write the agent contract exactly as specified: operating loop (`tg next` -> `tg show` -> `tg start` -> execute -> `tg done`), blocking protocol, decision protocol, and safe-edit boundaries.

---

## Milestones (Implementation Order)

### M0: Skeleton

- Project scaffolding (`package.json`, `tsconfig.json`, dependencies)
- `src/db/connection.ts`, `commit.ts`, `migrate.ts`
- `src/domain/types.ts` (all Zod schemas)
- `src/cli/index.ts` (commander setup)
- `tg init` — creates dolt repo, runs migrations, writes config
- `tg plan new`
- `tg task new`
- `tg edge add`
- `AGENT.md`

### M1: Execution Loop

- `src/domain/invariants.ts` (cycle detection, runnable check, transition guards)
- `tg next` (runnable query with ordering)
- `tg show` (task details + blockers + dependents + recent events)
- `tg start` (with runnable guard)
- `tg done` (with evidence + checks)
- `tg block` (add edge + set status + event)
- `tg split` (decomposition with edge wiring)

### M2: Visualization

- `src/export/mermaid.ts`
- `src/export/dot.ts`
- `tg export mermaid [--plan] [--feature]`
- `tg export dot`

### M3: Portfolio Views

- `tg portfolio overlaps` (relates edges + area co-occurrence)
- `tg portfolio hotspots` (task counts per area, cross-feature tasks)

### M4: Plan Import

- Add `external_key` column to task table (migration)
- `src/plan-import/parser.ts` (regex-based markdown block extraction)
- `src/plan-import/importer.ts` (upsert by external_key)
- `tg import <file> --plan <id>`

