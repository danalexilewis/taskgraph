---
name: CLI SDK for Agents
overview: Add a programmatic SDK so agents and scripts can run tg operations (next, context, status, start, done, note, block) without spawning the CLI and parsing JSON; build on existing CLI Ergonomics work and reuse logic already shared by CLI and MCP.
fileTree: |
  src/
  ├── api/
  │   ├── index.ts              (create)   # Public SDK entrypoint
  │   ├── client.ts             (create)   # TgClient class, readConfig + methods
  │   └── types.ts              (create)   # Typed result shapes for SDK consumers
  ├── cli/
  │   ├── next.ts               (modify)   # Delegate to api.next() when possible
  │   ├── context.ts            (modify)   # Delegate to api.context()
  │   └── (other commands)      (optional) # Delegate in follow-up tasks
  src/mcp/
  │   └── tools.ts              (modify)   # Call api client instead of runNext/runContext/...
  docs/
  │   ├── cli-reference.md       (modify)   # Add "Programmatic API (SDK)" section
  │   └── api.md                (create)   # SDK usage, options, error handling
  __tests__/
  ├── api/
  │   └── client.test.ts        (create)   # Unit tests for SDK (mocked or in-process repo)
  └── integration/
  │   └── sdk-vs-cli.test.ts    (create)  # Assert SDK and CLI --json produce same shapes
risks:
  - description: SDK and CLI drift if new commands only wire CLI
    severity: medium
    mitigation: "Document rule: new agent-facing commands must add an SDK method and use it from both CLI and MCP. Add SDK section to code-guidelines or docs/architecture."
  - description: Config/cwd handling differs between CLI (process.cwd()) and SDK (explicit cwd option)
    severity: low
    mitigation: "SDK client accepts optional cwd; defaults to process.cwd(). Same readConfig(repoPath) as CLI when cwd is set."
tests:
  - "TgClient.next({ planId, limit }) returns same shape as tg next --plan X --limit N --json (typed)"
  - "TgClient.context(taskId) returns same shape as tg context <id> --json"
  - "TgClient.status() returns same shape as tg status --json (or subset used by agents)"
  - "MCP tools tg_next, tg_context, tg_status use SDK; integration test confirms tool output matches CLI --json"
todos:
  - id: sdk-types-and-client
    content: Add src/api/types.ts and TgClient in src/api/client.ts with next, context, status
    agent: implementer
    changeType: create
    intent: |
      Create the SDK surface used by agents. Types: export Result types and payload shapes for next (array of runnable tasks), context (ContextOutput from domain/token-estimate), status (StatusData or the subset returned by fetchStatusData). Client: createClient({ cwd?: string }) that reads config (from cwd or process.cwd()), returns a TgClient with methods next(options), context(taskId), status(options?) each returning ResultAsync<T, AppError>. Implement by calling the same logic the CLI uses: for next, use the same query and filters as src/cli/next.ts; for context, use the same flow as src/cli/context.ts (query task, project, task_doc, task_skill, blockers, etc.); for status, call fetchStatusData(config, opts). Do not duplicate SQL or business logic — factor shared helpers (e.g. getNextRunnableTasks(repoPath, opts)) if needed and call from both CLI and api/client. Entrypoint src/api/index.ts: export { createClient } from './client'; export type { TgClient, NextOptions, ContextResult, StatusResult } from './client' or types.
    docs: [architecture, cli-reference]

  - id: sdk-write-methods
    content: Add start, done, note, block to TgClient
    agent: implementer
    changeType: modify
    blockedBy: [sdk-types-and-client]
    intent: |
      Extend TgClient with start(taskId, agentName, options?), done(taskId, evidence, options?), note(taskId, message, options?), block(taskId, blockerTaskId, reason?). Each returns ResultAsync with the same shape the CLI and MCP use. Reuse startOne from cli/start, and the done/note/block logic already in mcp/tools.ts (runDone, runNote, runBlock). Optionally add worktree support to start (worktree: boolean) and return worktree_path in result when startOne provides it (align with CLI Ergonomics start --json worktree_path). Ensure no direct doltSql in api/; go through query(repoPath) and domain/db layers.
    docs: [cli-reference, schema]

  - id: mcp-use-sdk
    content: Refactor MCP tools to call TgClient instead of inline runNext/runContext/runStatus/runStart/runDone/runNote/runBlock
    agent: implementer
    changeType: refactor
    blockedBy: [sdk-write-methods]
    intent: |
      In src/mcp/tools.ts, construct a TgClient from config (createClient not applicable from MCP process; use config.doltRepoPath to build client or a getClient(config) that returns TgClient). Replace runStatus(repo, plan) with client.status({ plan }).then(r => r.map(toToolResult).mapErr(toToolError)). Replace runContext, runNext, runShow, runStart, runDone, runNote, runBlock with the corresponding client methods. Keep toToolResult/toToolError and the MCP registration (server.registerTool) unchanged; only the implementation of each tool handler switches to the SDK. This removes duplication and ensures MCP and CLI share one code path.
    docs: [mcp, architecture]

  - id: cli-delegate-next-context
    content: Optionally delegate tg next and tg context to SDK in CLI action handlers
    agent: implementer
    changeType: refactor
    blockedBy: [sdk-types-and-client]
    intent: |
      In src/cli/next.ts and context.ts, after readConfig(), call the SDK (createClient with config or getClient(config)) and invoke client.next(...) / client.context(taskId). Serialize result to JSON for --json or to table for human output. This ensures CLI and SDK stay in sync and reduces duplicate query logic. If this is too invasive for the first iteration, leave as a follow-up and only add the SDK for consumers (MCP, scripts); otherwise do it in this task.
    docs: [cli-reference]

  - id: sdk-docs-and-exports
    content: Document SDK in docs/api.md and add Programmatic API section to cli-reference; export from package
    agent: documenter
    changeType: document
    blockedBy: [sdk-write-methods]
    intent: |
      Add docs/api.md: how to require/import the SDK (e.g. import { createClient } from '@danalexilewis/taskgraph/api' or from 'taskgraph/api' depending on package.json exports). Example: createClient({ cwd: process.cwd() }), then client.next({ planId: 'My Plan', limit: 20 }), client.context('tg-abc123'). Document error handling (Result type, .match() or .unwrapOr()). Document that the SDK uses the same config and Dolt repo as the CLI (cwd must have .taskgraph/config.json). In docs/cli-reference.md add a short "Programmatic API (SDK)" section that points to docs/api.md and lists the equivalent method for each agent-facing command (next → client.next(), context → client.context(), etc.). Update package.json "exports" if needed so that "taskgraph/api" or "taskgraph/dist/api" resolves for consumers.
    docs: [cli-reference, agent-contract]

  - id: sdk-tests
    content: Add unit tests for TgClient and integration test SDK vs CLI --json parity
    agent: implementer
    changeType: test
    blockedBy: [sdk-write-methods, mcp-use-sdk]
    intent: |
      Unit: __tests__/api/client.test.ts — with a temp repo (tg init) and a small plan/tasks, createClient({ cwd: tempDir }), call next(), context(taskId), status(), start(), done(); assert on result shapes and success/error. Integration: __tests__/integration/sdk-vs-cli.test.ts — same fixture, run tg next --json and client.next(); parse CLI stdout and deepEqual to SDK result; same for context and status. Ensures SDK and CLI stay interchangeable for agents.
    docs: [testing]

  - id: run-full-suite-sdk
    content: Run full test suite (pnpm gate:full) and record result in evidence
    agent: implementer
    changeType: test
    blockedBy: [sdk-tests]
    intent: |
      Run pnpm gate:full from the plan worktree or repo root. Record result in tg done evidence. On failure, add tg note with summary and do not mark done until fixed or escalated.
    docs: [agent-contract]
---

# CLI SDK for Agents

## Context

**Existing project:** [CLI Ergonomics for Agents and Subagents](26-03-02_cli_ergonomics_agents_subagents.md) improves the **CLI surface** for agents (worktree_path in `tg start --json`, Agent CLI entrypoint in AGENT.md, standardized JSON error envelope). Agents that run in a shell still invoke `tg` and parse stdout.

**Terminal sessions (recent):**
- Long one-liners that chain `pnpm -s tg --json cycle new ...`, parse JSON with `node -e` to get IDs, then `tg initiative new ...`, `tg plan new ...`, etc. Each step is a subprocess + parse.
- Integration tests use `runTgCli(...)` (subprocess or in-process CLI) and assert on stdout.
- MCP server already implements the **same logic** as the CLI in `src/mcp/tools.ts` (runStatus, runContext, runNext, runShow, runStart, runDone, runNote, runBlock) by calling `fetchStatusData`, `startOne`, `query()`, etc. — so a programmatic API exists internally but is not exposed as an SDK.

**User ask:** Improve the CLI tool for agents with **an SDK to make it easier to send queries** — i.e. allow agents and scripts to call tg operations without spawning the CLI and parsing JSON.

## Goal

- **SDK:** A small programmatic API (e.g. `createClient({ cwd }).next()`, `.context()`, `.status()`, `.start()`, `.done()`, `.note()`, `.block()`) that returns typed results and uses the same code path as the CLI and MCP.
- **Consumers:** (1) Scripts (e.g. cycle/initiative/plan setup) can `import { createClient } from 'taskgraph/api'` and call methods instead of shelling out. (2) MCP tools call the SDK instead of duplicating runNext/runContext/etc. (3) Optional: CLI action handlers delegate to the SDK so one implementation serves both.
- **Compatibility:** SDK result shapes match CLI `--json` output so that existing agent prompts and parsers remain valid when switching from CLI to SDK.

## Design

- **Single implementation:** The SDK is the canonical implementation; CLI and MCP call it. Today MCP and CLI duplicate logic (e.g. runNext in tools.ts vs nextCommand in next.ts); after this plan, both use TgClient.
- **Config:** TgClient is created with `createClient({ cwd?: string })`. Reads `.taskgraph/config.json` from cwd (default `process.cwd()`). Same as CLI.
- **Errors:** Methods return `ResultAsync<T, AppError>`. Consumers use `.match()` or `.unwrapOr()`. No process.exit; SDK is library-only.
- **Types:** Export TypeScript types for next result (array of task rows), context (ContextOutput), status (StatusData or agent-relevant subset), and write operation results (start/done/note/block) so script authors get type safety.

## Dependency graph

```text
Parallel:
  └── sdk-types-and-client

After sdk-types-and-client:
  ├── sdk-write-methods
  ├── cli-delegate-next-context   (optional; can be same wave as sdk-write-methods)
  └── (none blocking sdk-write-methods)

After sdk-write-methods:
  ├── mcp-use-sdk
  ├── sdk-docs-and-exports
  └── sdk-tests (can start after sdk-write-methods; may need mcp-use-sdk for full integration)

After mcp-use-sdk + sdk-tests:
  └── run-full-suite-sdk
```

## Relation to CLI Ergonomics

- **CLI Ergonomics** = better CLI UX (fewer round-trips, one entrypoint doc, consistent errors). Stays relevant for agents that prefer or only have shell access.
- **This plan (SDK)** = programmatic access so agents/scripts that can run Node can avoid subprocess + parse. Both plans are complementary: complete CLI Ergonomics first for shell-based agents; add the SDK for scriptable and MCP-driven flows.
- If the repo has already shipped CLI Ergonomics (worktree_path in start --json), the SDK `start()` method should return that same worktree_path when worktree option is used.

## Open questions

- **Package exports:** Current package.json has `"main": "dist/cli/index.js"`. To support `import { createClient } from 'taskgraph/api'` we may need `"exports": { ".": "...", "./api": "dist/api/index.js" }`. Confirm with existing build and consumers.
- **Hive context:** When `tg context --hive --json` is implemented (plans/26-03-02_hive_context.md), the SDK can expose `client.contextHive()` that returns the same shape.

## References

- [CLI Ergonomics for Agents and Subagents](26-03-02_cli_ergonomics_agents_subagents.md) — existing plan
- [CLI Ergonomics Research Report](../reports/26-03-02_cli_ergonomics_agents_subagents_research.md)
- docs/mcp.md — MCP server and tools
- src/mcp/tools.ts — current MCP tool implementations (runNext, runContext, etc.)
- src/cli/next.ts, context.ts, status.ts — CLI implementations to align with SDK
