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
