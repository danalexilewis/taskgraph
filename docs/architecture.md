---
triggers:
  files: ["src/domain/**", "src/db/**", "src/plan-import/**", "src/export/**"]
  change_types: ["create", "refactor"]
  keywords: ["architecture", "layer", "data flow"]
---

# Architecture

The Task Graph system is built around a Command Line Interface (CLI) that interacts with a Dolt database, acting as a Git-like version-controlled data store. This architecture is designed for reliability, determinism, and ease of audit.

## Data Store

- **Dolt Repository**: The core data for plans, tasks, dependencies, events, and decisions is persisted in a Dolt repository. This repository is typically located within the project at `.taskgraph/dolt/` or an adjacent directory.
- **Access Method**: Data access is primarily via the `dolt sql` CLI command. This approach, executed through `execa` in TypeScript, prioritizes robustness and avoids the need for a persistent MySQL server connection.
- **Version Control**: All data modifications are treated as Dolt commits, providing a complete audit trail of changes with meaningful messages.

## Execution Surface (CLI)

The agent interacts with the Task Graph system through a small, safe CLI, `tg`. This CLI is built using `commander.js` and is the primary interface for creating, managing, and querying the task graph.

### Repository Layout

The project adheres to a structured repository layout to separate concerns and improve maintainability:

```
  src/
    cli/           # Commander.js commands and CLI utilities
    db/            # Dolt connection, commit, and migration logic
    domain/        # Core business logic: types, Zod schemas, invariants, error definitions
    export/        # Graph visualization logic (Mermaid, DOT)
    plan-import/   # Markdown plan parsing and database import logic
  package.json
  tsconfig.json
  plans/             # Directory for Cursor Plan docs (narrative layer)
  AGENT.md           # Agent contract and operating protocol
  .taskgraph/
    config.json      # Local configuration for the Task Graph system
```

### Configuration (`.taskgraph/config.json`)

| Field                        | Type                      | Description                                                                                        |
| :--------------------------- | :------------------------ | :------------------------------------------------------------------------------------------------- |
| `doltRepoPath`               | string                    | Path to the Dolt repository (required).                                                            |
| `learningMode`               | boolean (optional)        | When true, orchestrator may append learnings to agent files after runs.                            |
| `context_token_budget`       | number or null (optional) | Max tokens for `tg context` output; null or omitted = unlimited. Typical: 4000–8000.               |
| `context_inline_doc_budget`  | number (optional)         | Token budget for inlining doc content into implementer prompts; omitted or 0 = no inlining. Positive = max tokens per task (typical: 8000). See subagent-dispatch.mdc → Doc-inlining policy. |
| `general_context_budget`    | number (optional)         | Cap in tokens for the **general context** block (e.g. `{{GENERAL_CONTEXT}}`). When set, orchestrator/tooling that fills general context uses this value; when unset, use the default (2000 tokens) per subagent-dispatch.mdc. |
| `mainBranch`                 | string (optional)         | Branch to merge agent branches into when using `tg start --branch` and `tg done`. Default: `main`. |

- **Agent branches**: Use `tg start <taskId> --branch` to create and checkout a Dolt branch for that task. When you run `tg done <taskId>`, the CLI merges that branch into the main branch (or `mainBranch` from config) and deletes the agent branch. If the merge has conflicts, an error is reported and the branch is left for manual resolution.

### Dolt branching (branch-per-agent)

Branch-per-agent is an **opt-in** pattern that gives each task its own Dolt branch. Use it when you want rollback safety or isolation for multi-agent work.

- **When to enable**: Pass `tg start <taskId> --branch` when starting a task. No config flag is required; branching is chosen per task at start time.
- **What happens**: A branch is created from the current HEAD (e.g. `main`) and checked out. All commits for that task (start event, notes, done) happen on that branch. The branch name is derived from the task (stored in the start event).
- **Completion**: Running `tg done <taskId>` merges the agent branch into the main branch (or `mainBranch` from config) and then deletes the agent branch. If the merge has conflicts, the CLI reports an error and does not delete the branch; you resolve conflicts manually, merge, and delete the branch yourself.
- **Rollback**: To discard a task’s changes without merging, checkout the main branch and delete the agent branch (e.g. `dolt checkout main` then `dolt branch -d <agent-branch>` from the Dolt repo). The task remains in the graph; you can mark it canceled or leave it for cleanup. Rollback is safe because the main branch is unchanged until you merge.

### Multi-machine sync and workflow

The task graph lives in a Dolt repository (`.taskgraph/dolt/` by default). Dolt supports remotes and push/pull, so the same graph can be shared across machines (e.g. different laptops or CI).

- **Sync today**: There is no `tg sync` command yet. To sync between machines, use Dolt from the repo root: add a remote (e.g. `dolt remote add origin <url>` from inside `.taskgraph/dolt/`), then `dolt pull` / `dolt push` as needed. Each machine needs the same `.taskgraph/` layout and config pointing at the Dolt repo.
- **Planned sync**: A future `tg sync` (or equivalent) may wrap Dolt fetch/pull/push and optionally use a **remote** entry in `.taskgraph/config.json` (e.g. `remoteUrl`) so the CLI can pull/push without running Dolt commands manually.
- **Remote config (planned)**: Config may gain an optional `remoteUrl` (or similar) to designate the default Dolt remote for sync. Until then, remotes are configured only via Dolt in `.taskgraph/dolt/`.
- **Multi-machine workflow**: On a new machine, clone the project (or copy it) so `.taskgraph/dolt/` exists; if the graph is in a shared remote, run `dolt pull` from the Dolt repo to get latest. Run `tg` commands as usual; worktrees and branch-per-agent work per machine. Push changes from the Dolt repo when you want to share them.

### Dolt I/O and agents

How the CLI and agents interact with Dolt for reads and writes:

1. **Execa path vs server path**  
   **Execa path** (default): the CLI runs `dolt sql` via execa per repo, so only one Dolt SQL invocation runs at a time (serialized). **Server path**: when `TG_DOLT_SERVER_PORT` (and `TG_DOLT_SERVER_DATABASE`) are set, the CLI uses a mysql2 connection pool to a running `dolt sql-server`; multiple queries can run concurrently. Use the server path for lower latency and higher throughput (e.g. integration tests, dashboards). See [infra.md § Dolt sql-server mode](infra.md#dolt-sql-server-mode).

2. **Read cache**  
   Commands such as `tg status`, `tg dashboard`, and (when enabled) `tg next`, `tg context`, and `tg show` use `cachedQuery()` / status cache with a short TTL (e.g. 2.5 s). The cache is **process-scoped** (in-memory, per CLI process). This reduces Dolt read load when many agents or UIs poll; reads may be slightly stale for up to the TTL.

3. **Write queue and eventual consistency**  
   When the write queue is used, **write commands** (e.g. `tg start`, `tg done`, `tg note`) **enqueue** the operation and return immediately. A separate **drain** process (`tg drain`) applies queued operations to Dolt. Visibility of those writes in `tg status`, `tg next`, and `tg context` is **eventual** — typically within a few seconds after the drain process runs.

4. **Queue location and writer**  
   The write queue is stored in `.taskgraph/queue.db`. Run `tg drain` (from the project root) to process the queue and apply pending writes to the Dolt repository. Without a running drain process, queued writes are not applied until you run `tg drain` manually or via a scheduler.

## Data Flow and Error Handling

The system employs a bottom-up data flow with `neverthrow` Result types for explicit error handling.

### Query cache layer

An in-process query result cache sits transparently between the CLI and Dolt:

```
CLI command → [QueryCache (in-process)] → cachedQuery() → query() → doltSql() / mysql2 pool → Dolt
```

- `cachedQuery()` checks the in-memory TTL cache before delegating to `query()`.
- When TTL is `0` (default in CLI mode), the cache is a no-op passthrough; all calls go directly to Dolt.
- Write operations trigger table-level cache invalidation to keep reads consistent.
- Dashboard mode applies a `1500 ms` TTL floor automatically to reduce polling overhead.

See [performance.md § Query Result Cache](performance.md#query-result-cache) for configuration details.

```mermaid
flowchart TD
  dbLayer["db/ layer: doltSql, doltCommit"] --> domainLayer["domain/ layer: invariants"]
  dbLayer --> exportLayer["export/ layer: mermaid, dot"]
  dbLayer --> importLayer["plan-import/ layer: parser, importer"]
  domainLayer --> cliLayer["cli/ layer: all commands"]
  exportLayer --> cliLayer
  importLayer --> cliLayer
  cliLayer --> entryPoint["cli/index.ts: match/unwrap at boundary"]

  subgraph Branch-per-agent flow
    direction TB
    main["main branch"] --> startBranch["tg start --branch"]
    startBranch --> createCheckout["db/branch: create + checkout agent branch"]
    createCheckout --> work["work (commits on agent branch)"]
    work --> done["tg done"]
    done --> merge["merge into main, delete branch"]
    work --> rollback["rollback: checkout main, dolt branch -d (discard branch)"]
  end
  dbLayer -.-> createCheckout
  createCheckout -.-> merge

  subgraph Error Handling Flow
    direction LR
    neverthrow_Result["Functions return Result<T, AppError> or ResultAsync<T, AppError>"]
    errorPropagation["Errors propagated via .andThen() / .mapErr()"]
    cliBoundary["CLI .action() handlers: .match() to handle success/error"]
    processExit["process.exit(1) on error (only at CLI boundary)"]

    neverthrow_Result --> errorPropagation --> cliBoundary --> processExit
  end
```

- **`db/` layer**: Handles direct interaction with Dolt. Functions like `doltSql` and `doltCommit` return `ResultAsync` to encapsulate potential database operation failures.
- **`domain/` layer**: Contains core business logic and invariants. Functions here return `Result` (for synchronous operations) or `ResultAsync` (for operations involving DB calls) to ensure all possible failure states are explicitly handled.
- **`export/` and `plan-import/` layers**: These layers process data from the database or external files and transform it. The plan-import parser and importer support the [enhanced plan format](plan-format.md) (file trees, risks, tests, per-task suggested changes), which is stored on plan and task rows and surfaced by `tg context`.
- **`cli/` layer**: The command handlers in this layer orchestrate the calls to the underlying domain, database, and other service layers. They use `neverthrow`'s `.match()` method at the outer boundary of the `action` handler to gracefully respond to the user with success messages or error details, terminating the process with `process.exit(1)` on error.
- **Error Types**: A custom `AppError` interface with an `ErrorCode` enum provides a structured way to categorize and handle different types of errors consistently across the application. See [Error Handling](error-handling.md) for more details. Multi-agent adds `TASK_ALREADY_CLAIMED` when `tg start` is attempted on an already-claimed task without `--force`.

### Agent escalation ladder

Task execution follows an **escalation ladder**: re-dispatch (same or adjusted sub-agent) → direct execution (orchestrator) → fixer (stronger model) → escalate to human. The **escalation decision tree** is defined in [.cursor/rules/subagent-dispatch.mdc](../.cursor/rules/subagent-dispatch.mdc); it specifies when to re-dispatch, when the orchestrator should do the task directly, and when to escalate to human (e.g. credentials, ambiguous intent, safety/approval, repeated failure). The **fixer** sub-agent ([.cursor/agents/fixer.md](../.cursor/agents/fixer.md)) is used when the orchestrator escalates a failed task to a stronger model after one or more implementer (and optionally reviewer) attempts; the fixer receives task context, failure feedback, and the current diff.

### Cross-Task Communication via Notes

The `event` table's `kind = 'note'` rows serve as the boundary-crossing mechanism between agent perspectives. An implementer (introspective: focused on one task) writes notes when it discovers issues beyond its scope; the orchestrator and future implementers (connective: focused on patterns across tasks) read those notes via `tg context`. See [agent-strategy.md](agent-strategy.md#communication-notes-as-cross-dimensional-transmission) for the full model.

### Auto-Migration

A `preAction` hook runs before every CLI command (except `init` and `setup`), calling `ensureMigrations()` to apply any pending idempotent migrations. This eliminates the "two worlds" problem where agents encounter a stale schema.
