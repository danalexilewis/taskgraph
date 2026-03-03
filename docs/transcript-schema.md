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

## Current reality (as of 2026-03-03)

**All 424 transcript files scanned contain only `text`-type content blocks.** Cursor's transcript export does not currently include structured `tool_use` or `tool_call` blocks — only the assistant's text narrative describing what it did. The structured schema above is the *intended* format but does not match the actual export.

### Text-mining fallback

Since structured tool calls are absent, scanners must extract CLI commands from text blocks using regex. Recommended patterns:

```
# Backtick-wrapped (most precise):
`(?:pnpm\s+)?tg\s+(context|status|next|start|done|note|...)\b([^`]*)`

# Execution indicators:
(?:Running|Ran|running|ran)\s+`(?:pnpm\s+)?tg\s+...`

# Failure indicators:
tg\s+(context|status|next)\b.*(?:fail|error|timeout|timed out|refused)
```

Filter to `role: "assistant"` messages to avoid counting user-provided template text. Even so, ~96% of tg command mentions in assistant text are references/discussion rather than confirmed executions.

### Schema status

Structured `tool_use` and `tool_call` blocks are **not present** in Cursor IDE transcript exports. Only `text` content blocks appear in `.jsonl` files from `agent-transcripts/`. For structured tool-call data with full argument payloads, use the Cursor CLI with `--output-format stream-json` when running agents from the terminal. See `reports/26-03-03_evolve-cli-transcript-analysis.md` for full methodology and scan results.

## Drift and validation

- If a scanner or evolve-cli step fails to find any `tool_use`/`tool_call` in transcripts that are known to contain tool use, re-inspect a recent `.jsonl` (e.g. from `agent-transcripts/` or `.taskgraph/transcripts/`) and update this doc and the scanner to match the current Cursor/export shape.
- The rule [.cursor/rules/agent-transcripts.mdc](../.cursor/rules/agent-transcripts.mdc) currently suggests grepping for `"type":"tool_call"`; scanners should also grep for `"type":"tool_use"`.
- **As of 2026-03-03:** Neither `tool_use` nor `tool_call` blocks exist in any transcript. Text mining is the only viable approach. See `reports/26-03-03_evolve-cli-transcript-analysis.md` for full methodology.
