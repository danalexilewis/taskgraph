---
triggers:
  files: ["src/agent-context/**"]
  change_types: ["create", "modify"]
  keywords: ["agent_events", "collector", "tg:event"]
---

# Agent Context

SQLite-backed event store that collects agent terminal output (e.g. `[tg:event] {...}` lines) and exposes a query API so any agent can see a snapshot of parallel agent activity. Used for cross-agent state visibility; separate from the Dolt task graph.

## Purpose

**This domain owns:**

- The **SQLite event store** (`.taskgraph/agent_context.db` by default): schema, WAL mode, and lifecycle.
- The **collector**: process that watches the terminals directory, parses event lines, and inserts into the store.
- The **query API**: programmatic and CLI access to events (e.g. `tg agent-context query`, `tg agent-context status`).

**This domain does NOT own:**

- The **Dolt task graph** (plans, tasks, edges, events in the main DB) — see [schema](schema.md) and [architecture](architecture.md).
- **Terminal file creation or rotation** — that is Cursor/IDE behavior; the collector only reads existing terminal files.

## Schema: `agent_events` table

Events are stored in a single SQLite table, created idempotently (`CREATE TABLE IF NOT EXISTS`). Typical columns (exact schema is defined in the agent-context implementation):

| Column     | Purpose                                |
| ---------- | -------------------------------------- |
| `id`       | Auto-increment or row id                |
| `agent`    | Agent identifier (e.g. from `--agent`)  |
| `task_id`  | Optional task ID when event is task-scoped |
| `kind`     | Event kind (e.g. `tg_start`, `tg_done`, `tg_note`, `file_write`, `search`, `custom`) |
| `payload`  | JSON or flexible payload                |
| `timestamp`| Unix ms                                |

Indexes support filtering by time, agent, and task. The store uses SQLite WAL mode where applicable.

## Event line format

Events are **line-based**. A line in a terminal file that represents an agent event must match:

```
[tg:event] <JSON>
```

- **Prefix:** exactly `[tg:event] ` (including the trailing space).
- **Body:** valid JSON that parses to an object with at least `kind`, `agent`/identifier, and `ts` (Unix ms). Optional fields include `taskId`, `parent` (linked list), and other payload.

The collector scans terminal files (e.g. under `.cursor/projects/.../terminals/*.txt`), looks for lines matching this pattern, parses the JSON, validates shape, and inserts into `agent_events`. Non-matching lines are ignored.

## Collector lifecycle

- **Entry point:** `tg agent-context collect` (or direct run of the Bun collector script with `--db`, `--dir`, etc.).
- **Mode:** Foreground process. Stdout/stderr are inherited so the operator can observe progress; no daemon.
- **Loop:** Poll the terminals directory at a configurable interval (e.g. 500 ms). For each `.txt` file, track `(inode, offset)` so only new bytes are read. If inode changes (e.g. file rotation), reset offset.
- **Shutdown:** SIGINT/SIGTERM triggers graceful stop: flush current tick, log a stop message, exit 0.

The CLI spawns the collector as a Bun subprocess because the compiled Node CLI binary cannot use `bun:sqlite`; see Decisions below.

## Query API

- **CLI:**  
  - `tg agent-context query [--since <ms>] [--agent <id>] [--task <id>] [--limit <n>] [--json]` — returns events as table or `{ "agent_events": [...] }`.  
  - `tg agent-context status` — one-shot summary: events per agent in the last 5 minutes, most recent per agent.
- **Programmatic:** The query logic lives in a Bun script that reads from the SQLite DB and prints JSON to stdout. The Node CLI spawns it and parses stdout; no direct DB access from the Node binary.

## Decisions / gotchas

- **bun:sqlite isolation:** `bun:sqlite` is a Bun built-in, not available in the Node-compiled CLI. The collector and query reader are **standalone Bun scripts** (e.g. `scripts/collect-agent-events.ts`, `scripts/query-agent-events.ts`). The CLI in `src/cli/agent-context.ts` only spawns them as subprocesses. No `bun:sqlite` import in `src/` code that gets built into `dist/`.
- **Polling vs FSEvents:** The collector uses **polling** (e.g. 500 ms) over the terminals directory rather than FSEvents or similar. This avoids platform-specific native APIs and keeps the implementation simple; trade-off is a short delay before new events are visible.
- **No daemon:** The collector runs in the foreground. This avoids daemon lifecycle (install, start/stop, logs) and lets the operator see output directly; Cursor/agents can run it when needed and observe via terminal output.
- **Offset + inode:** To handle file rotation, the collector tracks `(inode, offset)` per file. If the inode changes between polls, the offset is reset so the file is not re-read from the wrong position.
- **Test isolation:** Tests must use a temporary DB path (e.g. `fs.mkdtempSync`) and pass `--db` to the collector/query script so they never touch `.taskgraph/agent_context.db`.

## Related projects

- Agent Context Sync
