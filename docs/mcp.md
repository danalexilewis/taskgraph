# Task Graph MCP Server

The Task Graph MCP server exposes Task Graph data to AI assistants (Cursor, Claude Desktop, etc.) via the [Model Context Protocol](https://modelcontextprotocol.io/). Tools are read-only and mirror the JSON output of `tg status`, `tg context`, `tg next`, and `tg show`.

## Starting the server

1. Ensure the project has been initialized with Task Graph: run `tg init` from the project root so `.taskgraph/config.json` exists.
2. Run the MCP server from the **project root** (the directory containing `.taskgraph/`):

   ```bash
   tg-mcp
   ```

   Or with pnpm: `pnpm tg-mcp`. The server runs over stdio and reads config from `.taskgraph/config.json` in the current working directory.

3. The process stays running and communicates via stdin/stdout. Configure your IDE or Claude to launch this command and connect to it.

## Available tools

All tools return JSON. Errors are returned as `{ "status": "error", "code": "...", "message": "..." }`.

| Tool         | Description | Parameters |
| ------------ | ----------- | ---------- |
| **tg_status** | Status overview: plans count, tasks by status, next runnable tasks, active work. Same data as `tg status --json`. | `plan` (optional): Filter by plan title or ID. |
| **tg_context** | Context for a task: doc paths, skills, file tree, risks, related done tasks. Same as `tg context <taskId> --json`. | `taskId` (required): Task UUID or short hash (e.g. `tg-XXXXXX`). |
| **tg_next** | List runnable (unblocked) tasks, optionally filtered by plan and limited. | `planId` (optional): Plan title or UUID. `limit` (optional): Max tasks to return (default 10). |
| **tg_show** | Task details: task fields, blockers, dependents, events. Same as `tg show <taskId> --json`. | `taskId` (required): Task UUID or short hash. |

Task IDs follow the same rules as the CLI: full UUID or short hash (e.g. `tg-XXXXXX`).

## Configuring Cursor

1. Open Cursor Settings → Features → MCP (or edit your MCP config file).
2. Add a server entry that runs `tg-mcp` from your project root. Example for a project at `~/my-project`:

   **Option A — global/user MCP config**  
   Add an entry that uses the project path as the working directory, for example in `~/.cursor/mcp.json` (or the path Cursor uses on your system):

   ```json
   {
     "mcpServers": {
       "taskgraph": {
         "command": "tg-mcp",
         "args": [],
         "cwd": "/absolute/path/to/your/project"
       }
     }
   }
   ```

   Replace `/absolute/path/to/your/project` with the path to the repo that contains `.taskgraph/` (e.g. the Task-Graph repo or a repo where you ran `tg init`).

   **Option B — workspace-specific**  
   If your editor supports per-workspace MCP config, set `cwd` to the workspace root so `tg-mcp` runs in the repo with `.taskgraph/config.json`.

3. Restart Cursor or reload MCP so it spawns `tg-mcp`. The tools (e.g. `tg_status`, `tg_context`) will then be available to the agent.

## Configuring Claude Desktop

1. Open the Claude Desktop config file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
2. Add an MCP server that runs `tg-mcp` with the correct working directory:

   ```json
   {
     "mcpServers": {
       "taskgraph": {
         "command": "tg-mcp",
         "args": [],
         "cwd": "C:\\path\\to\\your\\project"
       }
     }
   }
   ```

   Use the full path to the project that contains `.taskgraph/`. On Windows use backslashes or escaped quotes as required by your shell/config.

3. Restart Claude Desktop. The Task Graph tools will appear for the model to call.

## Notes

- The server is **read-only**: it does not expose start/done/block/cancel or other write operations. Use the `tg` CLI for those.
- The server must run with a working directory where `.taskgraph/config.json` exists (i.e. where you ran `tg init`).
- For multi-repo setups, run one `tg-mcp` per repo and point each client config’s `cwd` to the corresponding repo.
