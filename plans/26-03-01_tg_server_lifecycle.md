---
name: tg server - Dolt SQL Server Lifecycle Command
overview: Add tg server start/stop/status to run a persistent dolt sql-server for the production repo, and auto-detect it in CLI startup so all tg commands and the dashboard use the fast mysql2 pool path automatically.
fileTree: |
  src/cli/
  ├── server.ts              (create)
  └── index.ts               (modify - register command, add auto-detection in preAction)
  __tests__/integration/
  └── server.test.ts         (create)
  docs/
  ├── cli-reference.md       (modify)
  └── infra.md               (modify)
risks:
  - description: Port file written by integration test global-setup (tg-dolt-server-port.txt, port 13307) could be mis-detected as production server
    severity: high
    mitigation: Use distinct file names (tg-server-port.txt / tg-server-pid.txt / tg-server-meta.json) and validate PID liveness + data-dir match before trusting any port file
  - description: Auto-detection sets process.env.TG_DOLT_SERVER_PORT in the preAction hook; in-process CLI tests that share process.env could route to the production DB
    severity: medium
    mitigation: Auto-detection is a no-op when TG_DOLT_SERVER_PORT is already set; integration test setupIntegrationTest() always overwrites it explicitly
  - description: fb6bd667 (doing task in Integration Test Speed plan) also extracts a dolt sql-server spawn helper from test-utils.ts; potential duplication
    severity: low
    mitigation: server-spawn-helper task should read the final state of test-utils.ts startDoltServer() after fb6bd667 lands; or produce the util independently in src/ (not __tests__/) since it serves different purposes
tests:
  - "tg server start: creates tg-server-port.txt, tg-server-pid.txt, tg-server-meta.json; server accepts TCP"
  - "tg server status: prints running on port N when server is alive; prints stopped when files missing or PID dead"
  - "tg server stop: sends SIGTERM, deletes files, closeServerPool called"
  - "tg server start when already running: idempotent, prints already running on port N"
  - "auto-detection: preAction sets TG_DOLT_SERVER_PORT when valid server files present; no-op when already set"
  - "auto-detection: does not set env var when PID is stale or data-dir mismatch"
todos:
  - id: server-spawn-helper
    content: "Add findFreePort utility and startDoltServerProcess helper in src/cli/server.ts"
    agent: implementer
    changeType: create
    intent: |
      Create src/cli/server.ts with two internal utilities:

      1. findFreePort(): Promise<number> — binds a net.Server to port 0 on 127.0.0.1, captures the assigned port, closes immediately. No new packages needed.

      2. startDoltServerProcess(doltRepoPath: string, port: number): Promise<{ pid: number }> — spawns dolt sql-server with { detached: true, stdio: 'ignore' } + server.unref(), then TCP-polls (net.Socket) up to 30×200ms for readiness. Throws if not ready. This is the pattern from __tests__/integration/test-utils.ts:startDoltServer() — adapt it for production use in src/ (no test-utils import; src/ must not depend on __tests__/).

      Also write the metadata file helpers:
      - serverMetaPath(configDir: string): string — returns path to tg-server-meta.json inside configDir
      - writeServerMeta(configDir, { port, pid, dataDir }): void
      - readServerMeta(configDir): { port: number, pid: number, dataDir: string } | null — returns null if file missing or unparseable
      - isServerAlive(pid: number): boolean — wraps process.kill(pid, 0) in try/catch, returns false on ESRCH

      configDir = path.dirname(config.doltRepoPath) = .taskgraph/

      Do NOT export the serverCommand yet — just the helpers. No command registration in this task.
    suggestedChanges: |
      // src/cli/server.ts
      import * as fs from 'node:fs';
      import * as net from 'node:net';
      import * as path from 'node:path';
      import { spawn } from 'node:child_process';

      export interface ServerMeta {
        port: number;
        pid: number;
        dataDir: string;
      }

      export function serverMetaPath(configDir: string): string {
        return path.join(configDir, 'tg-server-meta.json');
      }

      export function readServerMeta(configDir: string): ServerMeta | null { ... }
      export function writeServerMeta(configDir: string, meta: ServerMeta): void { ... }
      export function isServerAlive(pid: number): boolean { ... }
      export async function findFreePort(): Promise<number> { ... }
      export async function startDoltServerProcess(doltRepoPath: string, port: number): Promise<{ pid: number }> { ... }

  - id: server-autodetect
    content: "Add detectAndApplyServerPort() and call it in the preAction hook in src/cli/index.ts"
    agent: implementer
    changeType: modify
    intent: |
      Add a synchronous function detectAndApplyServerPort(config: Config): void to src/cli/server.ts (after server-spawn-helper lands). Call it from the preAction hook in src/cli/index.ts, after readConfig() succeeds.

      Logic:
      1. If process.env.TG_DOLT_SERVER_PORT is already set: return immediately (no-op; lets test setups override).
      2. configDir = path.dirname(config.doltRepoPath)
      3. meta = readServerMeta(configDir) — if null, return.
      4. Validate: isServerAlive(meta.pid) — if false, return (stale PID; fall back to subprocess mode silently).
      5. Validate: path.resolve(meta.dataDir) === path.resolve(config.doltRepoPath) — if mismatch, return (different repo's server).
      6. process.env.TG_DOLT_SERVER_PORT = String(meta.port).

      Add "server" to SKIP_MIGRATE_COMMANDS in index.ts so the server command doesn't trigger auto-migration (which would use the server it's about to start).

      This task can be done in parallel with server-command since it modifies index.ts and the lower part of server.ts only.
    suggestedChanges: |
      // src/cli/index.ts — in preAction, after readConfig() succeeds:
      import { detectAndApplyServerPort } from './server.js';
      // ...
      program.hook('preAction', async (thisCommand) => {
        if (SKIP_MIGRATE_COMMANDS.has(thisCommand.name())) return;
        const config = readConfig();
        if (config.isOk()) {
          detectAndApplyServerPort(config.value);
          await ensureMigrations(config.value.doltRepoPath);
        }
      });

  - id: server-command
    content: "Implement tg server start/stop/status command in src/cli/server.ts and register in index.ts"
    agent: implementer
    changeType: modify
    blockedBy: [server-spawn-helper]
    intent: |
      Implement the serverCommand export in src/cli/server.ts following the parent+subcommand pattern from src/cli/worktree.ts.

      tg server start:
      - readConfig(); validate doltRepoPath exists and is a Dolt repo (check .dolt/ subdir).
      - configDir = path.dirname(config.doltRepoPath)
      - Check existing meta: if readServerMeta(configDir) exists and isServerAlive(pid), print "Server already running on port N" and exit 0.
      - findFreePort() → port
      - startDoltServerProcess(config.doltRepoPath, port) → { pid }
      - writeServerMeta(configDir, { port, pid, dataDir: config.doltRepoPath })
      - Print "tg server started on port N (pid P)"

      tg server stop:
      - readConfig(); configDir = path.dirname(config.doltRepoPath)
      - meta = readServerMeta(configDir); if null, print "No server running" and exit 0.
      - await closeServerPool(String(meta.port)) (from src/db/connection.ts)
      - try process.kill(meta.pid, 'SIGTERM') catch ESRCH
      - fs.rmSync(serverMetaPath(configDir), { force: true })
      - Print "tg server stopped"

      tg server status:
      - readConfig(); configDir = path.dirname(config.doltRepoPath)
      - meta = readServerMeta(configDir)
      - if null or !isServerAlive(meta.pid): print "tg server: stopped"
      - else: print "tg server: running on port N (pid P)"

      Register serverCommand in src/cli/index.ts. Ensure "server" is in SKIP_MIGRATE_COMMANDS.

      Note: server-autodetect (detectAndApplyServerPort) can be added to the same file in its own task — but both tasks modify server.ts. Sequence: server-spawn-helper first, then server-command and server-autodetect can run in parallel on different sections.
    suggestedChanges: |
      export function serverCommand(program: Command) {
        const cmd = program.command('server').description('Manage the background dolt sql-server for this repo');
        cmd.command('start').description('Start dolt sql-server in the background').action(async () => { ... });
        cmd.command('stop').description('Stop the background dolt sql-server').action(async () => { ... });
        cmd.command('status').description('Show whether the background server is running').action(async () => { ... });
      }

  - id: server-tests
    content: "Write integration tests for tg server start/stop/status in __tests__/integration/server.test.ts"
    agent: implementer
    changeType: create
    blockedBy: [server-command, server-autodetect]
    intent: |
      Create __tests__/integration/server.test.ts covering the tg server lifecycle.

      Use the existing integration test harness (setupIntegrationTest / teardownIntegrationTest from test-utils.ts). Each test gets an isolated Dolt repo cloned from the golden template.

      Tests to cover:
      1. `tg server start` creates tg-server-meta.json, contents have numeric port and pid, server accepts TCP on that port.
      2. `tg server status` after start: output contains "running on port".
      3. `tg server stop` after start: exits 0, meta file deleted, TCP connection refused.
      4. `tg server status` after stop: output contains "stopped".
      5. `tg server start` called twice: second call exits 0 and prints "already running".
      6. Auto-detection: when tg-server-meta.json is present for the test repo and PID is alive, a subsequent CLI invocation should not spawn subprocess mode. Verify by measuring query count or checking process.env.TG_DOLT_SERVER_PORT after preAction.

      After each test, ensure the server is stopped (teardown). Do not leak servers — use afterAll to kill any remaining server.

  - id: server-docs
    content: "Update docs/cli-reference.md and docs/infra.md with tg server command and auto-detection behavior"
    agent: implementer
    changeType: modify
    blockedBy: [server-command, server-autodetect]
    intent: |
      docs/cli-reference.md:
      - Add a `tg server` section with start/stop/status subcommands, descriptions, output format, and exit codes.
      - Note that starting the server enables fast pool mode for all subsequent tg commands automatically.

      docs/infra.md:
      - Update the env vars table: TG_DOLT_SERVER_PORT is now usually set automatically via tg-server-meta.json auto-detection; manual setting is still supported and takes precedence.
      - Add a "Background server" section explaining the tg-server-meta.json file, where it lives (.taskgraph/), and how to start the server persistently (shell init / launchd / systemd).
      - Note the port file namespace: tg-server-meta.json (production) vs tg-dolt-server-port.txt (integration test, do not use in production code).

      These docs tasks can run in parallel with server-tests (different files).

  - id: server-gate
    content: "Run gate:full to verify no regressions after tg server implementation"
    agent: implementer
    changeType: modify
    blockedBy: [server-tests, server-docs]
    intent: |
      Run pnpm gate:full. Verify:
      - All existing integration tests pass (the auto-detection no-op when TG_DOLT_SERVER_PORT is already set must prevent any interference)
      - New server.test.ts passes
      - Lint and typecheck clean
      Evidence: "gate:full passed" or "gate:full failed: <summary>".
isProject: false
---

## Analysis

The root cause of dashboard startup latency is `doltSql()` in subprocess mode: every query forks `dolt sql -q ...` via `execa`, costing 200–500ms each. With ~12 queries in `fetchStatusData`, the first render blocks for 2–4+ seconds. The fix is already 80% built: when `TG_DOLT_SERVER_PORT` is set, `doltSql()` routes to a `mysql2` connection pool where queries cost 1–5ms. Integration tests already exploit this; the production path just needs lifecycle management and auto-detection.

**Why not a daemon with a status cache (Phase 2)?** That's a separate plan. The `mysql2` pool is fast enough that dashboard first paint at ~10–30ms needs no cache. Phase 2 only matters if you want zero-latency even before the first pool query returns.

**Why not Dolt Scheduled Events?** 30s minimum frequency, SQL-only logic, main-branch only. Not a fit for this problem. Suitable for GC/maintenance tasks.

**Port file collision fix:** The test infrastructure writes `tg-dolt-server-port.txt` (plain text port number, 13307). The new production server writes `tg-server-meta.json` (JSON with port, pid, dataDir). The names are different, eliminating the collision. The auto-detection also validates PID liveness and data-dir match as a second defense.

## Dependency Graph

```
Parallel start (2 unblocked):
  ├── server-spawn-helper  (src/cli/server.ts helpers: findFreePort, startDoltServerProcess, meta file R/W)
  └── server-autodetect    (index.ts preAction hook + detectAndApplyServerPort — can be scaffolded before spawn helper lands)

After server-spawn-helper:
  └── server-command       (src/cli/server.ts: start/stop/status subcommands + index.ts registration)

After server-command + server-autodetect:
  ├── server-tests         (integration tests — can run in parallel with server-docs)
  └── server-docs          (cli-reference.md + infra.md — can run in parallel with server-tests)

After server-tests + server-docs:
  └── server-gate          (gate:full)
```

## Proposed Changes

### `src/cli/server.ts` (new file, ~150 lines)

```typescript
// Metadata file schema
export interface ServerMeta {
  port: number;
  pid: number;
  dataDir: string;
}

// Helpers (used by both command and auto-detection)
export function serverMetaPath(configDir: string): string;
export function readServerMeta(configDir: string): ServerMeta | null;
export function writeServerMeta(configDir: string, meta: ServerMeta): void;
export function isServerAlive(pid: number): boolean; // process.kill(pid, 0)
export function detectAndApplyServerPort(config: Config): void; // preAction hook

// Internals
async function findFreePort(): Promise<number>;
async function startDoltServerProcess(
  repoPath: string,
  port: number,
): Promise<{ pid: number }>;

// Command registration
export function serverCommand(program: Command): void;
```

### `src/cli/index.ts` modifications

- Import `detectAndApplyServerPort`, `serverCommand` from `./server.js`
- Add `"server"` to `SKIP_MIGRATE_COMMANDS`
- In `preAction`: call `detectAndApplyServerPort(config)` after successful `readConfig()`

### `.taskgraph/tg-server-meta.json` (new runtime file, gitignored-by-default)

```json
{
  "port": 54321,
  "pid": 12345,
  "dataDir": "/Users/dan/repos/Task-Graph/.taskgraph/dolt"
}
```

## Open Questions

1. **Should `tg server start` be added to shell `~/.zshrc` automatically by `tg init`?** Not in this plan — too opinionated. Docs should recommend it.
2. **launchd / systemd plist for persistent server?** Out of scope for this plan; a follow-up skill guide (`docs/skills/server-autostart.md`) could cover this.
3. **Should the server daemon optionally poll and cache status (Phase 2)?** Deferred to a separate plan once Phase 1 is validated.

<original_prompt>
launching the dashboard is slow. can we set it up as a running process in the background and then have the dashboard instead connect to it so that its instant. how would Dolt work with this? a live materialised view, or one refreshed every 5 seconds? what drives that cron job.

/research then /report this then create a /plan
</original_prompt>
