---
name: Perf Audit Remediation — Test Infra, Schema Indexes, CLI Speed
overview: |
  Remediation plan from the 2026-03-01 performance audit. Three root problems discovered:
  (1) 80 orphaned dolt sql-server processes from integration test teardown bugs consuming 3.5 GB RAM;
  (2) no secondary indexes on hot FK columns making every status/next/start query scan full tables;
  (3) production CLI spawns ~42 dolt subprocesses per command (6-8s latency) due to no persistent server mode and per-invocation migration probes.
  Group 1 (test infra) and Group 2 (schema indexes) are the first wave — they unblock safe test runs and deliver the highest schema-level speedup. Group 3 (CLI speed) is the second wave.
todos:
  - id: fix-process-group-kill
    content: "Fix process group kill in test teardown — use process.kill(-pid, 'SIGTERM') in teardownIntegrationTest and globalTeardown; add SIGKILL fallback after 3s for detached dolt servers"
    status: pending
    agent: implementer

  - id: fix-setup-try-finally
    content: "Add try/finally in setupIntegrationTest — kill server if ensureMigrations throws after spawn; add process.on('exit') emergency cleanup for any server not yet torn down"
    status: pending
    agent: implementer
    blockedBy: [fix-process-group-kill]

  - id: add-pid-registry
    content: "Add PID registry file for per-test dolt servers — append each serverPid to .taskgraph/tg-test-server-pids.json on setup; remove on teardown; global-teardown SIGKILL-kills all remaining entries; global-setup kills stale entries on start"
    status: pending
    agent: implementer
    blockedBy: [fix-setup-try-finally]

  - id: add-dolt-leak-assertion
    content: "Add assertNoDoltLeak() helper to test-utils.ts — pgrep -c dolt before and after each test suite; console.warn if count grows; call from global-setup and global-teardown as baseline check"
    status: pending
    agent: implementer
    blockedBy: [add-pid-registry]

  - id: fix-port-allocation
    content: "Fix port allocation — expand range from 90 to 200 ports (13310-13509); add pre-bind TCP probe before spawning dolt, retry up to 10 times on conflict; log selected port"
    status: pending
    agent: implementer
    blockedBy: [add-dolt-leak-assertion]

  - id: bump-beforeall-timeouts
    content: "Bump beforeAll/afterAll timeouts in slow integration suites — stats.test.ts, worktree.test.ts, plan-worktree.test.ts: pass 60_000ms to prevent Bun 10s global timeout killing setup after server spawn"
    status: pending
    agent: implementer

  - id: add-schema-indexes
    content: "Add secondary index migration — applyIndexMigration() in migrate.ts with 5 CREATE INDEX: event(task_id,kind,created_at), edge(to_task_id,type), task(plan_id), task(status), gate(task_id,status)"
    status: pending
    agent: implementer
    blockedBy: [fix-port-allocation]

  - id: fix-migration-cache
    content: "Persist migration state — write .taskgraph/.tg-migration-version sentinel file; ensureMigrations returns early if hash matches; invalidate only when a migration actually runs; eliminates ~32 subprocess probes per CLI command"
    status: pending
    agent: implementer
    blockedBy: [add-schema-indexes]

  - id: parallelize-fetchstatusdata
    content: "Parallelize fetchStatusData queries — replace sequential .andThen() chain with ResultAsync.combine batches; merge nextSql/next7Sql into LIMIT 7 + JS slice; merge count queries into single GROUP BY"
    status: pending
    agent: implementer
    blockedBy: [add-schema-indexes]

  - id: fix-import-n-plus-one
    content: "Fix N+1 in plan import — pre-fetch all existing hash_ids once before the loop; replace per-task syncBlockedStatusForTask loop with bulk query + batch UPDATE"
    status: pending
    agent: implementer
    blockedBy: [add-schema-indexes]

  - id: run-full-suite
    content: "Run full test suite — pnpm gate:full; verify all test infra fixes and schema changes pass integration tests"
    status: pending
    agent: implementer
    blockedBy: [fix-migration-cache, parallelize-fetchstatusdata, fix-import-n-plus-one, bump-beforeall-timeouts]
---
