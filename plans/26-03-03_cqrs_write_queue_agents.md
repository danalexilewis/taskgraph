---
name: CQRS Write Queue for Agent I/O
overview: Add a persistent write queue and single writer process so CLI write commands return immediately and agents are not blocked on Dolt; extend read cache to next/context/show.
fileTree: |
  src/
  ├── db/
  │   ├── connection.ts           (reference; no change in Phase 1)
  │   ├── queue.ts                (create - queue append/peek/ack API)
  │   └── queue-schema.ts         (create - command types and payload Zod schemas)
  ├── cli/
  │   ├── status-cache.ts         (existing; reference for cache pattern)
  │   ├── status.ts              (existing; uses cachedQuery)
  │   ├── note.ts                 (modify - enqueue then return)
  │   ├── start.ts                (modify - enqueue then return)
  │   ├── done.ts                 (modify - enqueue then return)
  │   ├── block.ts                (modify - enqueue then return)
  │   ├── cancel.ts               (modify - enqueue then return)
  │   ├── gate.ts                 (modify - enqueue then return)
  │   ├── split.ts                (modify - enqueue then return)
  │   ├── task.ts                 (modify - enqueue then return)
  │   ├── edge.ts                 (modify - enqueue then return)
  │   ├── import.ts               (modify - enqueue then return)
  │   ├── crossplan.ts            (modify - enqueue then return)
  │   ├── plan.ts                 (modify - enqueue then return)
  │   ├── recover.ts              (modify - enqueue then return)
  │   ├── cycle.ts                (modify - enqueue then return)
  │   ├── initiative.ts           (modify - enqueue then return)
  │   ├── template.ts             (modify - enqueue then return)
  │   ├── drain.ts                (create - writer loop: tg drain or tg server writer)
  │   └── index.ts                (modify - register drain command)
  └── api/
  └── client.ts                   (modify - use cachedQuery for next/context where safe)
  .taskgraph/
  └── queue.db                    (created at runtime; SQLite)
  __tests__/
  ├── db/
  │   └── queue.test.ts           (create)
  ├── integration/
  │   └── drain-note.test.ts       (create - enqueue note, drain, verify event)
  └── cli/
  └── cache-next-context.test.ts   (create - next/context cache hit)
  docs/
  └── architecture.md              (modify - Dolt I/O and agents section)
risks:
  - description: Writer crash leaves queue with pending items; agent already got success
    severity: medium
    mitigation: Persistent queue (SQLite); writer restarts and resumes; document tg drain status and optional dead-letter visibility
  - description: Branch-per-task (done --merge) requires writer to run checkout/merge in repo context
    severity: medium
    mitigation: Queue payload carries doltRepoPath, worktreePath, branchName; writer uses existing branch.ts and worktree helpers
  - description: Cross-process cache remains stale until TTL after writer applies
    severity: low
    mitigation: Document eventual consistency (visibility within a few seconds); keep TTL at 2.5s; writer cannot clear other processes' cache
tests:
  - "Queue: append, peek, ack; idempotency key dedup (optional)"
  - "Integration: tg note enqueue then tg drain; verify event in Dolt"
  - "Integration: next/context use cache when within TTL (second call no dolt procs or reduced count)"
  - "Run-full-suite after all changes"
todos:
  - id: queue-format-and-storage
    content: "Add persistent write queue (SQLite under .taskgraph/) with append/peek/ack API"
    agent: implementer
    changeType: create
    docs: [schema, architecture, infra]
    intent: |
      Create queue storage under .taskgraph/ (e.g. queue.db) so multiple CLI processes can append and a single writer can drain. Use SQLite for durability and simple status (pending/applied/failed).
      New module src/db/queue.ts: append(commandType, payloadJson, idempotencyKey?), peek(limit), ack(id), markFailed(id, error?). Table schema: id (auto), command_type TEXT, payload_json TEXT, idempotency_key TEXT UNIQUE nullable, status TEXT, created_at, updated_at. Append inserts status=pending; writer peeks N pending, applies, then ack or markFailed.
      New module src/db/queue-schema.ts: Zod schemas for each command type (note, start, done, block, ...) and a discriminated union so CLI and writer can validate payloads. Export types for payloads.
      Config: queue path from config.doltRepoPath parent (e.g. path.join(path.dirname(doltRepoPath), 'queue.db')) or .taskgraph/config.json queuePath. Do not add writer or wire any CLI yet; this task is queue + schema only.
      Unit test __tests__/db/queue.test.ts: append, peek returns in order, ack removes from pending, idempotency key prevents duplicate append.
  - id: extend-read-cache
    content: "Use cachedQuery or getStatusCache for tg next and tg context and tg show read paths"
    agent: implementer
    changeType: modify
    docs: [architecture, performance]
    intent: |
      Today only fetchStatusData (status/dashboard) uses cachedQuery and getStatusCache(). next, context, and show use query(repoPath) directly and hit Dolt every time.
      In src/api/client.ts: for next() and for the read path used by context() (runContextChain or equivalent), replace query(repoPath) with cachedQuery(repoPath, getStatusCache(), statusCacheTtlMs) so repeated next/context within TTL hit cache. Ensure getStatusCache is imported from status-cache.ts; use same TTL as status (2.5s or TG_STATUS_CACHE_TTL_MS).
      For tg show: in src/cli/show.ts, use cachedQuery(repoPath, getStatusCache(), statusCacheTtlMs) instead of query(repoPath) for the read queries that fetch task details, blockers, dependents, events. Write commands already clear getStatusCache().clear() so after a write the next show will miss cache and get fresh data.
      Add test in __tests__/cli/cache-next-context.test.ts (or integration): call next or context twice within TTL; assert second call does not spawn additional dolt processes (or mock doltSql and assert call count).
  - id: writer-process
    content: "Add tg drain command (or tg server writer mode) that drains queue and applies to Dolt"
    agent: implementer
    blockedBy: [queue-format-and-storage]
    changeType: create
    docs: [architecture, infra, error-handling]
    intent: |
      Long-running process that reads pending items from the queue, applies each by running the same logic that the CLI would (insert/update via query(), doltCommit(), and for done/start: checkoutBranch, mergeAgentBranchIntoMain, etc.), then acks or marks failed.
      New file src/cli/drain.ts: command "drain" (e.g. tg drain). Loop: queue.peek(10), for each item run an applicator function keyed by command_type (note -> insert event + doltCommit; start -> branch + event + update task + commit; done -> update + event + merge branch + commit; etc.). Use existing query(), doltSql(), doltCommit(), branch.ts, worktree helpers. Run inside repo context: payload includes doltRepoPath; ensure cwd or config is set so Dolt and git operations use the right paths. On apply error: retry once with backoff, then markFailed(id, error) and continue. Optionally log to stderr or .taskgraph/drain.log.
      Register in src/cli/index.ts: program.command('drain').option('--once', 'Run one batch then exit').action(drainCommand). Optionally tg server start could spawn a drain loop in the same process; for minimal first version, tg drain is a separate foreground process the user runs (e.g. in a dedicated terminal or as a background job).
      Integration test: see wire-note task (enqueue note, run drain, verify event).
  - id: wire-note
    content: "Make tg note enqueue and return immediately; writer applies note command"
    agent: implementer
    blockedBy: [writer-process]
    changeType: modify
    docs: [schema, cli-reference, architecture]
    intent: |
      In src/cli/note.ts: instead of calling query().insert('event', ...) and doltCommit() and getStatusCache().clear() directly, call queue.append('note', { taskId, message, repoPath: config.doltRepoPath }) (and any other fields needed for apply). Return success to the caller immediately. Do not clear status cache here (writer will not clear other processes' caches; TTL handles staleness).
      Writer (drain) already implements applicator for 'note': read payload, validate with queue-schema, run query().insert('event', ...), doltCommit(). After this task, tg note no longer blocks on Dolt; agent gets success and moves on; within a few seconds (drain loop + TTL) status/show will see the note.
      Integration test __tests__/integration/drain-note.test.ts: run tg note for a task, then run tg drain --once (or run drain until queue empty), then query Dolt or tg show and assert event exists.
  - id: wire-remaining-writes
    content: "Wire all other write commands to enqueue (start, done, block, cancel, gate, split, task, edge, import, plan, recover, crossplan, cycle, initiative, template)"
    agent: implementer
    blockedBy: [wire-note]
    changeType: modify
    docs: [schema, cli-reference, architecture, multi-agent]
    intent: |
      For each CLI command that currently performs writes (start, done, block, cancel, gate, split, task new, edge, import, plan, recover, crossplan, cycle, initiative, template): replace the direct query()/doltSql()/doltCommit() path with queue.append(commandType, payload). Payload must include everything the writer needs: repoPath, taskIds, branch name for start/done, worktree path for done --merge, plan path for import, etc. Use queue-schema.ts types so payloads are validated. Keep init synchronous (bootstrap); it does not enqueue.
      Writer (drain.ts) must implement applicator for each command type: start (checkoutBranch/createBranch, insert event, update task, doltCommit), done (update task, insert event, mergeAgentBranchIntoMain or mergeWorktreeBranchIntoMain, doltCommit), block (insert edge, sync blocked status, commit), and so on. Reuse existing logic from each command file by extracting an applyNote, applyStart, applyDone, ... or by calling shared functions that take (repoPath, payload).
      Add tests: at least one integration test that enqueues start and done (with or without --branch) and drains, then verifies task status and events.
  - id: docs-dolt-io-agents
    content: "Document Dolt I/O, execa vs server path, cache scope, and eventual consistency for writes"
    agent: documenter
    blockedBy: [wire-note, extend-read-cache]
    changeType: modify
    docs: [architecture, infra, cli-reference]
    intent: |
      Add a section "Dolt I/O and agents" to docs/architecture.md (or docs/infra.md). Content: (1) Execa path vs server path - execa serializes per repo (one dolt sql at a time), server path (TG_DOLT_SERVER_PORT) uses mysql2 pool and allows concurrent queries. (2) Read cache - status, dashboard, and (after this plan) next, context, show use cachedQuery/getStatusCache with TTL 2.5s; cache is process-scoped. (3) Write queue and eventual consistency - write commands enqueue and return immediately; a separate tg drain process applies to Dolt; visibility of writes in status/next/context is eventual (within a few seconds). (4) Queue location and writer - queue lives in .taskgraph/queue.db; run tg drain to process the queue. Update cli-reference.md to mention tg drain and that writes are asynchronous when drain is used.
  - id: add-tests
    content: "Add integration tests for queue drain (note, start/done) and next/context cache"
    agent: implementer
    blockedBy: [wire-remaining-writes, docs-dolt-io-agents]
    changeType: create
    docs: [testing]
    intent: |
      Ensure __tests__/integration/drain-note.test.ts exists and passes (from wire-note). Add __tests__/integration/drain-start-done.test.ts: enqueue start for a task, drain; enqueue done with evidence, drain; verify task status done and events. Add or extend __tests__/cli/cache-next-context.test.ts so that next() and context() hit cache on second call within TTL (mock or real Dolt; assert dolt call count or timing). Call resetStatusCache() in beforeEach where needed to avoid bleed.
  - id: run-full-suite
    content: "Run pnpm gate:full and confirm all tests pass"
    agent: implementer
    blockedBy: [add-tests]
    changeType: modify
    intent: |
      Run pnpm build then pnpm gate:full from repo root. Report pass or fail in evidence. If fail, add tg note with failure summary and do not mark done until fixed or escalated.
isProject: true
---

# CQRS Write Queue for Agent I/O

## Analysis

Agents are blocked because every `tg` command (read or write) shares a single execa-path Dolt slot. The review (reports/review-26-03-03-lock-strategy-cqrs-alternative.md) recommends a CQRS-style approach: **writes** enqueue and return immediately; a **single writer process** (tg drain) drains the queue into Dolt; **reads** continue to use cache where possible, and we extend cache to next/context/show so more traffic avoids Dolt.

- **Queue:** Persistent (SQLite under `.taskgraph/`) so multiple CLI processes can append and the writer can resume after crash.
- **Writer:** New command `tg drain` runs a loop: peek pending, apply each command (reusing existing query/branch/commit logic), ack or mark failed. Run as a separate foreground process (or future: same process as tg server).
- **Init:** Stays synchronous (bootstrap). All other write commands (note, start, done, block, cancel, gate, split, task, edge, import, plan, recover, crossplan, cycle, initiative, template) enqueue.
- **Read cache:** Extend cachedQuery/getStatusCache to api/client next() and context() and to cli/show.ts so repeated reads within TTL do not hit Dolt.

## Dependency graph

```
Parallel start (2 unblocked):
  ├── queue-format-and-storage   (queue + schema; no writer yet)
  └── extend-read-cache          (next/context/show use cache)

After queue-format-and-storage:
  └── writer-process             (tg drain loop)

After writer-process:
  └── wire-note                  (note enqueue + applicator)

After wire-note:
  └── wire-remaining-writes      (all other write commands enqueue + applicators)

After wire-note and extend-read-cache:
  └── docs-dolt-io-agents       (document I/O and eventual consistency)

After wire-remaining-writes and docs-dolt-io-agents:
  └── add-tests                  (drain-note, drain-start-done, cache next/context)

After add-tests:
  └── run-full-suite
```

## Proposed changes

- **queue.ts:** SQLite table `write_queue` (id, command_type, payload_json, idempotency_key UNIQUE, status, created_at, updated_at). append(), peek(n), ack(id), markFailed(id, err). Path from config (e.g. `.taskgraph/queue.db`).
- **queue-schema.ts:** Zod schemas and discriminated union for note, start, done, block, cancel, gate, split, task_new, edge, import, plan, recover, crossplan, cycle, initiative, template payloads. Used by CLI when building payload and by drain when applying.
- **drain.ts:** Command handler: load config, open queue, loop (peek 10, for each run applicator by command_type, ack or markFailed). Applicators call existing query/doltSql/doltCommit/branch/worktree helpers with payload.doltRepoPath and payload fields.
- **Wire commands:** Each write command builds payload from argv/config, calls queue.append(type, payload), returns ok. No direct query() or doltCommit() in command handler.
- **api/client.ts and show.ts:** Use cachedQuery(repoPath, getStatusCache(), statusCacheTtlMs) instead of query(repoPath) for next, context, and show read paths.

## Open questions

- Whether `tg server start` should optionally start a drain loop in the same process (reduces two processes to one). Deferred: first version is `tg drain` as separate process.
- Dead-letter visibility: whether to add `tg queue failed` or similar to list failed items. Deferred: markFailed writes to DB; can add list command later.

<original_prompt>
The current system does not work. The agents all get blocked all the time. Create a plan from reports/review-26-03-03-lock-strategy-cqrs-alternative.md to fix agent blocking via CQRS write queue and read cache extension.
</original_prompt>
