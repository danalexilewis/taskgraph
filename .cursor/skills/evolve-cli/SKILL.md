---
name: evolve-cli
description: Transcript-based CLI and context pattern mining. Use when the user wants to analyse agent transcript patterns (e.g. repeated tg context, tg status, or shell commands) to improve CLI context or agent behaviour. Complements the evolve skill (diff-based pattern mining).
---

# Evolve-CLI — Transcript-based pattern mining

Analyses agent transcripts to detect patterns of CLI usage and context requests (e.g. many small sequential `tg context` or `tg status` calls). Findings feed into improving `tg context` and agent guidance so one context call delivers the needed information.

**Related:** [evolve](../evolve/SKILL.md) (plan-diff pattern mining). **Transcript location:** `.cursor/rules/agent-transcripts.mdc`.

## Transcript schema

Tool-call detection in transcript `.jsonl` files depends on a known message shape. The **canonical schema** (content block types, tool names, and where the shell command string lives) is documented in **[docs/transcript-schema.md](../../../docs/transcript-schema.md)**.

Summary for scanners:

- **Message structure:** Each line is JSON with `role` and `message.content[]`. Content blocks are polymorphic on `type`.
- **Tool invocation:** Look for blocks with `type` **`tool_use`** or **`tool_call`** (both accepted; schema may drift).
- **Tool name:** Field `name` (or `tool_name`) — e.g. `run_terminal_cmd`, `Shell` for shell/terminal.
- **Shell command string:** Typically `args.command`, `input.command`, or (if arguments are stringified) inside parsed `arguments` as `command` or `commandLine`.
- **Tool result:** `type` `tool_result`; link via `tool_use_id` or `call_id`.

If the scanner fails to find tool calls in transcripts that are known to contain them, re-inspect a sample `.jsonl` and update `docs/transcript-schema.md` and the scanner to match the current Cursor/export format.

## Pattern definitions (thresholds)

### many small sequential context/CLI calls

**Pattern:** An agent issues many small, sequential invocations of `tg context`, `tg status`, or `tg next` within a sliding window of tool calls, instead of relying on a single richer context/status/next call.

**Rationale:** Repeated small calls signal that "all in one" context may be missing something — the agent keeps asking for more because a single `tg context` (or status/next) did not surface the needed information. Detecting this pattern helps improve what one context call returns (e.g. docs, task list, or runnable set) so agents do not need to call repeatedly.

**Default thresholds:**

| Metric | Default | Description |
|--------|---------|-------------|
| Window size (tool calls) | 20 | Sliding window of consecutive tool calls to scan. |
| Combined `tg context` \| `tg status` \| `tg next` | ≥ 3 | Triggers pattern if this many invocations occur in the window. |
| `tg context` only (stricter) | ≥ 2 in 10 | In a window of 10 tool calls, ≥ 2 `tg context` invocations. |

Use the combined threshold for a general "lots of CLI/context chatter"; use the stricter `tg context`-only rule when focusing on context-call redundancy.

**Configuration:** Window size and thresholds are configurable (e.g. in skill config or a dedicated config file). Tune them without code changes so we can adjust sensitivity as we gather more transcript data.
