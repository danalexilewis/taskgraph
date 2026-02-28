# Cursor Agent CLI

The **Cursor Agent CLI** (`agent`) starts the Cursor Agent. It can be used to run sub-agents from the terminal so the orchestrator can dispatch implementer, reviewer, and planner-analyst work without the in-IDE Task tool.

## Help output

```
Usage: agent [options] [command] [prompt...]

Start the Cursor Agent

Arguments:
  prompt                       Initial prompt for the agent

Options:
  -v, --version                Output the version number
  --api-key <key>              API key for authentication (can also use CURSOR_API_KEY env var)
  -H, --header <header>        Add custom header to agent requests (format: 'Name: Value', can be used multiple times)
  -p, --print                  Print responses to console (for scripts or non-interactive use). Has access to all tools, including write and shell. (default: false)
  --output-format <format>     Output format (only works with --print): text | json | stream-json (default: "text")
  --stream-partial-output      Stream partial output as individual text deltas (only works with --print and stream-json format) (default: false)
  -c, --cloud                  Start in cloud mode (open composer picker on launch) (default: false)
  --mode <mode>                Start in the given execution mode. plan: read-only/planning (analyze, propose plans, no edits). ask: Q&A style for explanations and questions
                               (read-only). (choices: "plan", "ask")
  --plan                       Start in plan mode (shorthand for --mode=plan). Ignored if --cloud is passed. (default: false)
  --resume [chatId]            Select a session to resume (default: false)
  --continue                   Continue previous session (default: false)
  --model <model>              Model to use (e.g., gpt-5, sonnet-4, sonnet-4-thinking)
  --list-models                List available models and exit (default: false)
  -f, --force                  Force allow commands unless explicitly denied (default: false)
  --yolo                       Alias for --force (Run Everything) (default: false)
  --sandbox <mode>             Explicitly enable or disable sandbox mode (overrides config) (choices: "enabled", "disabled")
  --approve-mcps               Automatically approve all MCP servers (default: false)
  --trust                      Trust the current workspace without prompting (only works with --print/headless mode) (default: false)
  --workspace <path>           Workspace directory to use (defaults to current working directory)
  -h, --help                   Display help for command

Commands:
  install-shell-integration    Install shell integration to ~/.zshrc
  uninstall-shell-integration  Remove shell integration from ~/.zshrc
  login                        Authenticate with Cursor. Set NO_OPEN_BROWSER to disable browser opening.
  logout                       Sign out and clear stored authentication
  mcp                          Manage MCP servers
  status|whoami                View authentication status
  models                       List available models for this account
  about                        Display version, system, and account information
  update                       Update Cursor Agent to the latest version
  create-chat                  Create a new empty chat and return its ID
  generate-rule|rule           Generate a new Cursor rule with interactive prompts
  agent [prompt...]            Start the Cursor Agent
  ls                           Resume a chat session
  resume                       Resume the latest chat session
  help [command]               Display help for command
```

## Using the CLI for sub-agent dispatch

When the orchestrator runs in an environment where the in-IDE Task tool is not available (e.g. terminal-only), it can spawn sub-agents via the `agent` CLI instead.

### Non-interactive (scripted) dispatch

Use `--print` so the agent runs headless and prints the response to stdout. Use `--trust` so the run does not block on workspace trust prompts.

```bash
agent --model <model> --print --trust [--workspace .] [prompt...]
```

- **`--model <model>`**: Use the intended “fast” model for sub-agents. Run `agent --list-models` (or `agent models`) to see available model IDs and pick the one designated for cheap/sub-agent use (e.g. in this repo’s memory or project docs).
- **`--print`**: Required for non-interactive use; responses go to stdout.
- **`--trust`**: Required with `--print` so the process does not block on trust prompts.
- **`--workspace <path>`**: Set to the repo root (e.g. `.` or `$(pwd)`) so `tg` and file paths resolve correctly.
- **`prompt`**: The full prompt (same content you would pass to the Task tool). Positional arguments; for long prompts see below.

### Finding the “fast” model

The dispatch rules refer to `model="fast"` as a label. The CLI needs a concrete model ID. Run:

```bash
agent --list-models
```

or

```bash
agent models
```

Choose the model ID that corresponds to your “fast” / low-cost sub-agent model and document it (e.g. in `.cursor/memory.md` or this doc) so the orchestrator uses it in `--model <id>`.

### Long or multi-line prompts

- **Short prompts**: Pass as a single positional argument. Be careful with shell quoting (escape internal quotes and newlines as needed for your shell).
- **Long prompts**: To avoid command-line length limits (ARG_MAX) and escaping issues, pass the prompt via stdin if the CLI supports it, e.g.:

  ```bash
  agent --model <id> --print --trust --workspace . < prompt.txt
  ```

  or a heredoc. If your `agent` version does not accept stdin for the prompt, keep prompts in a file and use the quoting or mechanism the CLI documents.

### Implementer, reviewer, planner-analyst

Build the prompt the same way as for the Task tool (from `.cursor/agents/implementer.md`, `reviewer.md`, or `planner-analyst.md` plus `tg context <taskId> --json` or request/status). Then run:

- **Implementer**: `agent --model <fast-model> --print --trust --workspace . -- "<implementer prompt>"`
- **Reviewer**: `agent --model <fast-model> --print --trust --workspace . -- "<reviewer prompt>"`
- **Planner-analyst**: `agent --model <fast-model> --print --trust --workspace . -- "<planner-analyst prompt>"`

Use the same batching rules as in [subagent-dispatch](.cursor/rules/subagent-dispatch.mdc): feed all runnable tasks that don't share files; Cursor decides concurrency.

## When running in this environment (mcp_task)

In environments where the Cursor Task tool or `agent` CLI is not available (e.g. an orchestrator that has only mcp_task), use **mcp_task** with the same built prompt and a short `description` (e.g. "Implement task: &lt;title&gt;" or "Planner analyst: gather context for plan"). Use `subagent_type` **explore** for planner-analyst (or explorer), and **generalPurpose** for implementer or reviewer. The prompt and workflow are unchanged; only the invocation differs. Do not skip dispatch because the Task tool is not visible — use mcp_task so execution and planning still go through sub-agents.

## Relation to taskgraph

Dispatch is the same prompt and workflow; choose the mechanism by what is available:

- **Task tool (in-IDE)**: Dispatch via the Cursor Task tool with `model="fast"` and the same prompts when running inside the IDE.
- **agent CLI (terminal)**: Use the `agent` CLI when the orchestrator runs from a terminal or script and needs to spawn sub-agents without the Task UI.
- **mcp_task (this environment)**: Use mcp_task when the Task tool and agent CLI are not available; same prompt and description.

See [Sub-Agent Dispatch](.cursor/rules/subagent-dispatch.mdc) and [Sub-agent dispatch (skill)](skills/subagent-dispatch.md) for when to use which agent and how to build prompts.
