# Review: Lock Strategy and CQRS Alternative (Dolt I/O for Agents)

**Date:** 2026-03-03  
**Scope:** Current Dolt lock/serialization strategy, agent pain, and alternative (read cache + write queue / eventual consistency).  
**Produced by:** Orchestrator (read-only review).

---

## 1. Current “lock” strategy (what it really is)

The system does **not** use traditional file locks for application logic. The bottleneck is **Dolt’s noms file storage**, which does not allow concurrent process access. When multiple `dolt sql` subprocesses run against the same repo:

- Later processes see the noms lock as “a server must be running” and fall back to TCP (port 3306).
- With no Dolt SQL server running (default execa path), that connection is refused and the query fails.

**Mitigation in place:** Per-repo **in-process semaphore** in `src/db/connection.ts`:

- `acquireExecaSlot(repoPath)` — only one `dolt sql` subprocess at a time per repo.
- FIFO queue; 60s wait timeout then “Dolt operation timed out: another operation may be stuck”.
- **Server path** (`TG_DOLT_SERVER_PORT` set): mysql2 pool, no serialization; concurrency is native.

So “lock strategy” = **serialize all execa-path Dolt calls per repo**. No cross-process file lock yet; plan **26-03-03_dolt_data_loss_hardening** adds a cross-process file lock for the execa path (`.tg-execa.lock` or under `.dolt/noms/`) so that multiple OS processes (e.g. several agents in different shells) also serialize instead of corrupting noms.

---

## 2. Where this hurts agents

| Pain point | Cause |
|------------|--------|
| **Long waits** | Every `tg` command (status, next, start, done, note, context, …) that touches Dolt goes through the same slot. With many agents or rapid CLI use, queue builds up. |
| **Timeout UX** | 60s then “another operation may be stuck” — agent or human can’t tell if it’s slow load or a stuck process. |
| **No parallelism on execa** | Even read-only commands (status, next, show, context) are serialized with writes (start, done, note). One slow or blocked command blocks everyone. |
| **Dashboard / status volume** | `fetchStatusData` does ~17 queries (serialized). At 2s refresh that’s ~600 dolt processes per minute of dashboard uptime when cache misses. |

So the “lock strategy” (serialization) is **correct** to avoid noms corruption and TCP fallback failures, but it **maximizes latency and contention** for multi-agent and dashboard use.

---

## 3. Read path: cache (already in place)

**Implemented:**

- **`src/db/cache.ts`** — `QueryCache` (in-memory, TTL, table-tagged invalidation).
- **`src/db/cached-query.ts`** — `cachedQuery(repoPath, cache, ttlMs)` wraps `query()`; read path (select, count, raw SELECT) served from cache when `ttlMs > 0`.
- **`src/cli/status-cache.ts`** — Singleton `getStatusCache()`, `statusCacheTtlMs` (default 2.5s; `TG_DISABLE_CACHE=1` → 0), `getSchemaFlags(repoPath)` memoizes initiative/cycle tableExists (5 min).
- **`src/cli/status.ts`** — `fetchStatusData` uses `cachedQuery(..., getStatusCache(), statusCacheTtlMs)` and `getSchemaFlags`; first call hits Dolt, subsequent calls within TTL hit cache (0 dolt procs).
- **Write invalidation** — done, start, note, block, import clear `getStatusCache().clear()` on success so next status/dashboard sees fresh data.

So **caching in front of read requests through the CLI** is already the strategy for the main hot path (status/dashboard). Scope: **CLI only**; if an agent or tool goes direct to Dolt (e.g. raw `dolt sql`), they bypass cache and still contend on the execa slot (or server).

**Gaps / limits:**

- Cache is **process-scoped**. Multiple processes (e.g. orchestrator + dashboard + MCP server) each have their own cache; no shared read model.
- Only **status/dashboard** use the cache today. Other read-heavy commands (`tg next`, `tg context`, `tg show`, MCP tools that call `fetchStatusData`) benefit when they go through `fetchStatusData`; commands that use `query(repoPath)` directly (e.g. `show`, `context`, `next` internals) do **not** use the status cache. Extending cache to more read paths would reduce Dolt calls further.

---

## 4. Write path: queue + eventual consistency (proposed)

Your idea: **writes** (start, done, note, block, import, etc.) enqueue; CLI returns immediately with “accepted”; a single writer (or Dolt service) drains the queue; agents get **eventual consistency** and don’t wait for Dolt.

### 4.1 CQRS framing

- **Command side:** CLI accepts mutations (e.g. “tg done X –evidence …”), enqueues a command (e.g. to a file-based or in-process queue), returns success to the agent. Agent moves on.
- **Query side:** Reads served from cache (and/or from Dolt when cache misses). With short TTL and invalidation on write, “eventual” is usually within one refresh (e.g. 2–2.5s).
- **Single writer:** One process or service owns “drain queue → apply to Dolt”. That preserves the “one writer at a time” constraint that noms and the current semaphore enforce.

So: **CQRS with Dolt by agents** — commands are async from the agent’s perspective; queries are served from a read model (cache) that is updated shortly after the command is applied.

### 4.2 Design choices

| Choice | Option A (in-process queue) | Option B (out-of-process writer) |
|--------|----------------------------|-----------------------------------|
| **Queue** | In-memory queue in the same Node process that runs `tg` | Persistent queue (e.g. file, SQLite, or sidecar) + separate “tg writer” process |
| **Who drains** | Same process: e.g. after returning to agent, a background loop or “on next tick” drains | Dedicated process (e.g. `tg server` or `tg drain`) that only runs the writer |
| **Agent** | One `tg` process per agent; each has its own queue and would need to serialize at Dolt anyway unless only one process drains | One shared writer process; all agents enqueue to shared queue and return immediately |
| **Crash** | Queue in memory is lost unless flushed to disk before “accept” | Queue on disk survives; writer can resume |

For **multi-agent**, Option B (shared persistent queue + single writer process) matches “agents don’t wait; a Dolt service grinds through the queue.” Option A still forces each agent process to wait when it drains its own queue to Dolt, unless only one process is designated the drainer.

### 4.3 Implementation sketch (shared queue + writer)

- **Queue:** Persistent (e.g. append-only file, or SQLite in `.taskgraph/`, or a small table in Dolt itself). Each entry: command type (start | done | note | block | …), payload, optional idempotency key.
- **CLI write commands:** Instead of calling `query()` / `doltSql()` directly, append to the queue and return success. Optionally return a “ticket” id for observability.
- **Writer process:** Long-running (e.g. `tg server` already starts a process; could add “writer” mode). Loop: read next N commands from queue, apply to Dolt one-by-one (holding execa slot or server connection), advance queue, invalidate cache or signal “new data” if needed.
- **Read path:** Unchanged: cache + TTL + invalidation. After a short delay, status/next/context see the applied writes (eventual consistency).

### 4.4 Risks and trade-offs

| Risk | Mitigation |
|------|------------|
| **Agent assumes immediate visibility** | Document “eventual consistency (e.g. within a few seconds)”; status/dashboard TTL already implies this. |
| **Write failure after “accepted”** | Queue entry can be retried; on permanent failure, move to dead-letter or surface via `tg` health / admin command. |
| **Ordering** | Single writer preserves order; no need for global ordering across agents if queue is FIFO per writer. |
| **Branch-per-task (tg start/done –branch)** | Done flow does merge; must run in writer context with same repo/branch semantics. Queue payload carries branch/task id so writer can do checkout/merge. |
| **Cross-process cache** | Reads in other processes still see stale until TTL or next fetch; acceptable if TTL is short and documented. |

---

## 5. Summary and next steps

### Current strategy

- **Execa path:** One Dolt subprocess at a time per repo (in-process semaphore); 60s timeout. Plan exists to add cross-process file lock. Correct for noms, bad for latency under concurrency.
- **Read path:** Cache is already in front of the main CLI read path (status/dashboard via `cachedQuery` + `getStatusCache()`). Other read commands don’t use it yet.
- **Write path:** All writes go synchronously through the same execa slot; agents block until Dolt and (where used) commit complete.

### Alternative (CQRS-style)

- **Reads:** Keep and extend caching in front of CLI reads; document that direct Dolt access bypasses cache. Optionally expand cache to more read commands (next, context, show) to reduce Dolt load further.
- **Writes:** Introduce a **persistent queue** and a **single writer process** that drains the queue into Dolt. CLI write commands enqueue and return immediately; agents get eventual consistency and don’t wait on Dolt. Document visibility delay (e.g. “within a few seconds”).

### Suggested next steps

1. **Short term:** Finish status cache rollout (already wired); add cross-process lock per dolt_data_loss_hardening plan so multi-process use is safe. Consider making **tg server** (or server auto-start) the recommended path so most traffic uses the concurrent mysql2 path instead of execa.
2. **Medium term:** Design the write queue (format, location, idempotency) and writer process (lifecycle, error handling, branch-per-task). Prototype one command (e.g. `tg note`) as enqueue + writer apply to validate.
3. **Doc:** Add a short “Dolt I/O and agents” section (e.g. in `docs/architecture.md` or `docs/infra.md`) describing execa vs server path, cache scope, and (once implemented) eventual consistency for writes.

---

## References

- `src/db/connection.ts` — execa semaphore, `acquireExecaSlot`, server pool
- `reports/dashboard-dolt-concurrency-fix-2026-03-02.md` — root cause (noms lock, TCP fallback)
- `plans/26-03-02_status_dashboard_cache.md` — status cache integration
- `plans/26-03-03_dolt_data_loss_hardening.md` — cross-process lock, repair, noms health
- `src/cli/status-cache.ts`, `src/db/cached-query.ts`, `src/db/cache.ts` — cache layer
