---
triggers:
  files: [".cursor/rules/agent-transcripts.mdc", ".cursor/skills/evolve-cli/**", ".cursor/skills/evolve/**"]
  change_types: ["create", "modify"]
  keywords: ["transcript", "tool_call", "tool_use", "agent-transcripts", "evolve-cli"]
---

# Transcript schema

Assumed structure of Cursor agent transcript `.jsonl` files for **tool-call detection** (e.g. evolve-cli scanner, overlord, or efficiency analysis). Location: `~/.cursor/projects/<project-slug>/agent-transcripts/<uuid>/` and `subagents/*.jsonl`. See [.cursor/rules/agent-transcripts.mdc](../.cursor/rules/agent-transcripts.mdc).

## Message shape

- **File format:** One JSON object per line (JSONL). Each line has `role` and `message`.
- **Roles:** `user` | `assistant`.
- **Message content:** `message.content` is an **array** of content blocks. Blocks are polymorphic on `type`.

## Content block types

| Type        | Use | Notes |
| ----------- | --- | ----- |
| `text`      | Plain text from user or assistant | `{ "type": "text", "text": "..." }` |
| `tool_use`  | Assistant invoking a tool (OpenAI-style) | See below. |
| `tool_call` | Alternative type name for tool invocation | Cursor/export may use `tool_call`; treat as synonymous with `tool_use` for detection. |
| `tool_result` | Tool output (e.g. from MCP or Shell) | Typically follows the matching `tool_use` in the same or next message. |

Detection should accept **either** `tool_use` or `tool_call` so the schema remains robust if Cursor or export format drifts.

## Tool invocation (tool_use / tool_call)

- **Type:** `"tool_use"` or `"tool_call"`.
- **Tool name:** In a `name` (or `tool_name`) field. Common values:
  - **Shell / terminal:** `run_terminal_cmd`, `Shell`, or similar (vendor-specific).
  - **File read:** `read_file`, `Read`, etc.
  - **File edit:** `search_replace`, `Write`, etc.
- **Arguments:** Tool arguments are typically in one of:
  - `args` (object)
  - `input` (object)
  - `arguments` (string, often JSON-encoded)

**Shell command string:** For terminal/shell tools, the command string usually lives at:

- `args.command` or `input.command` (preferred)
- Or `args.commandLine` / `input.commandLine` if present

If the schema uses stringified JSON for arguments, parse `arguments` and then look for `command` (or `commandLine`) inside the parsed object.

## Example (assumed)

```json
{
  "type": "tool_use",
  "id": "call_abc123",
  "name": "run_terminal_cmd",
  "input": {
    "command": "pnpm tg status --tasks",
    "is_background": false
  }
}
```

Or with `tool_call` and `args`:

```json
{
  "type": "tool_call",
  "id": "call_xyz",
  "name": "Shell",
  "args": {
    "command": "cd /path && pnpm test"
  }
}
```

## Tool result

- **Type:** `tool_result`.
- **Link to call:** `tool_use_id` or `call_id` matches the `id` of the corresponding `tool_use`/`tool_call`.
- **Output:** `content` or `output` (string or array).

## Drift and validation

- If a scanner or evolve-cli step fails to find any `tool_use`/`tool_call` in transcripts that are known to contain tool use, re-inspect a recent `.jsonl` (e.g. from `agent-transcripts/` or `.taskgraph/transcripts/`) and update this doc and the scanner to match the current Cursor/export shape.
- The rule [.cursor/rules/agent-transcripts.mdc](../.cursor/rules/agent-transcripts.mdc) currently suggests grepping for `"type":"tool_call"`; scanners should also grep for `"type":"tool_use"`.
