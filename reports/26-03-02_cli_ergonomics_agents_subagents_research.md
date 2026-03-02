# CLI Ergonomics for Agents and Subagents — Research Report

**Date:** 2026-03-02  
**Scope:** How orchestrators and subagents (implementers, reviewers, planner-analyst, etc.) use the Task-Graph CLI; pain points and improvement opportunities.  
**Method:** Internal doc/code review (AGENT.md, agent-contract, subagent-dispatch, implementer/reviewer templates, CLI reference, context/next/start/worktree implementation) + external research (agent-CLI design, Gastown gt CLI, CLI skills protocol).

---

## 1. Current Agent/Subagent CLI Usage (Summary)

| Actor                 | Commands used                                                                                                                                                                                                                             | Notes                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Orchestrator**      | `tg status --tasks`, `tg next --plan "<Plan>" --json --limit 20`, `tg context <taskId> --json` (per task), `tg start`, `tg worktree list --json`, `tg note`, `tg done`, `tg show`, `tg block`, `tg task new`, `tg export markdown --plan` | Builds prompts from context JSON; passes WORKTREE_PATH when pre-starting.                |
| **Implementer**       | `tg status --tasks`, `tg start <taskId> --agent <name> --worktree`, `tg worktree list --json` (to get path), `tg context --hive --json` (documented, **not yet implemented**), `tg done`, `tg note`                                       | Must `cd` to worktree and run `tg done` from there; self-start or receive WORKTREE_PATH. |
| **Reviewer / others** | Read-only: `tg status --json`, `tg context <taskId> --json`, `tg show`, `tg next`                                                                                                                                                         | Need task context + diff for review.                                                     |
| **Planner-analyst**   | `tg status --tasks` (optional)                                                                                                                                                                                                            | Receives request + optional status from orchestrator.                                    |

Key flows:

- **Get runnable tasks:** `tg next --plan "<Plan>" --json --limit 20`
- **Get task context for prompt:** `tg context <taskId> --json`
- **Claim + worktree:** `tg start <taskId> --agent <name> --worktree` then `tg worktree list --json` → find path → `cd <path>`
- **Complete:** `tg done <taskId> --evidence "..."` **from worktree directory** (critical; see memory and agent-contract)

---

## 2. Internal Pain Points (from docs and memory)

1. **`tg done` from wrong directory**  
   Running `tg done` from repo root when the task used a worktree skips the merge step and can destroy work. Memory and agent-contract stress: always run `tg done` from the worktree path (from `tg worktree list --json`).

2. **No `tg context --hive` yet**  
   Implementer template and agent-strategy describe hive coordination via `tg context --hive --json` to get a snapshot of all doing tasks (agents, phases, files, notes). This is **not implemented**; a plan exists (`plans/26-03-02_hive_context.md`). The agent-contract currently describes a no-args `tg context --json` returning "aggregated context for all currently doing tasks", but the CLI requires `<taskId>` for `context`; the intended behavior is the planned `--hive` flag.

3. **Worktree path not in `tg start --json`**  
   When using `tg start <taskId> --agent <name> --worktree --json`, the output is `[{"id":"...","status":"doing"}]`. The worktree path is stored in the started event body in the DB but not returned in the CLI response. Implementers therefore must run `tg worktree list --json` and match their task (e.g. by branch name) to get the path — an extra round-trip and parsing step.

4. **Plan branch verification**  
   Memory: after the first `tg start --worktree` for a new plan, verify with `tg worktree list --json` that a `plan-p-*` entry exists; otherwise task worktrees can be cleaned up without merging.

5. **Stale references**  
   Implementer learnings: CLI renames (e.g. `tg plan list` → `tg status --projects`) must be followed by a grep of `.cursor/agents/*.md` and `.cursor/rules/*.mdc` so agent templates don’t reference old commands.

6. **Consistent short IDs**  
   Commands accept short hash (e.g. `tg-XXXXXX`); agents benefit from status/next showing short id so they can copy-paste. Documented in CLI reference; ensuring status/next/show use short id consistently avoids confusion.

---

## 3. External Patterns (Relevance to tg)

### 3.1 Agent-CLI design (machine-readable output)

- **Structured output as default or consistent envelope:** JSON with schema version, status, exit codes, error details so agents don’t parse prose.
- **Explicit errors:** Machine-readable codes, error class (input/auth/network), recovery hints, `retryable` where applicable.
- **Progressive context:** Avoid dumping full help; let agents query what they need (e.g. skills protocol).
- **State and lifecycle:** Session IDs, clear lifecycle ops, validate/run splits, idempotency keys for recovery.
- **Minimize context pollution:** Every extra token competes with reasoning; keep JSON shapes lean and predictable.

**Fit for tg:** We already use `--json` widely and have error shapes in some places. Gaps: no schema version in JSON; error envelope not documented as a standard; no single “skills” entrypoint for agents.

### 3.2 CLI skills protocol (CLIWatch)

- **`skills` subcommand:** Returns structured JSON: capabilities, workflow ordering, common vs advanced commands.
- **Progressive discovery:** e.g. `mycli skills` → overview; `mycli skills deploy` → steps, args, flags, examples.
- **Benchmark claim:** 82–98% token reduction vs full help when discovery is structured; reduces backtracking.
- **AGENTS.md as step one:** A one-liner in AGENTS.md telling agents how to discover the CLI (e.g. “Run `tg next --json` for runnable tasks; `tg context <id> --json` for task context”) is a low-cost improvement.

**Fit for tg:** We have rich AGENT.md and docs. Adding a minimal `tg skills` (or a single “agent entrypoint” subsection in AGENT.md) that lists the exact commands and JSON shapes for next/context/start/done could reduce agent backtracking and keep one place to update when CLI changes.

### 3.3 Gastown (gt) CLI

- **Concepts:** Mayor (coordinator), Rigs (projects), Polecats (workers), Convoys (work batches), Hooks (git worktree–backed state).
- **Commands:** `gt convoy create/list/show`, `gt sling <bead> <rig>` (assign work), `gt agents`, `gt feed` (TUI), `gt prime` (context recovery in session).
- **Takeaway:** gt is a full orchestration layer; tg is the task graph and CLI. The ergonomic idea that applies: **one clear command to “get my context” after spawn** (e.g. `gt prime`). For tg, `tg context --hive --json` is that primitive for implementers.

---

## 4. Recommendations (by impact / effort)

### High impact, planned or low effort

| Improvement                                                | Rationale                                                                                                                                                                                                                                  | Effort               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| **Implement `tg context --hive --json`**                   | Already specified in `plans/26-03-02_hive_context.md`. Implementer and agent-strategy docs refer to it (“when the CLI supports it”). Unblocks hive coordination without changing semantics of `tg context <taskId>`.                       | Medium (plan exists) |
| **Return `worktree_path` in `tg start --worktree --json`** | Removes the need for implementers to call `tg worktree list --json` and match by branch. One round-trip instead of two; simpler agent logic.                                                                                               | Low                  |
| **Document “Agent CLI entrypoint” in AGENT.md**            | Single place: “For execution: `tg next --plan \"<Plan>\" --json --limit 20`; then `tg context <taskId> --json` per task; `tg start/done` from worktree; use short ids (tg-XXXXXX).” Reduces guessing and keeps docs in sync after renames. | Low                  |

### Medium impact

| Improvement                                | Rationale                                                                                                                                                                                                            | Effort                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Standardize JSON error envelope**        | When `--json` and an error occurs, use a single shape everywhere (e.g. `{ "status": "error", "code": string, "message": string, "retryable"?: boolean }`). Document in cli-reference and agent-field-guide.          | Low–medium                            |
| **Optional envelope for `tg next --json`** | Today: raw array. Consider `{ "tasks": [...], "schema_version": 1 }` for future-proofing and consistency with other commands. Weigh against existing parsers (orchestrator, scripts).                                | Low (additive if opt-in or versioned) |
| **`tg skills` or equivalent**              | Structured list of workflows: e.g. “get runnable tasks”, “get task context”, “start with worktree”, “done from worktree”. Could be a small JSON emitted by a subcommand or generated from existing command metadata. | Medium                                |

### Lower priority / later

| Improvement                           | Rationale                                                                                                                               | Effort            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **Batch context**                     | Orchestrator runs `tg context <taskId> --json` once per task. A `tg context --batch <id1> <id2> ... --json` could reduce N round-trips. | Medium            |
| **Idempotency keys for `tg done`**    | For scripted/agent replay, optional `--idempotency-key` could deduplicate duplicate done calls.                                         | Low–medium        |
| **Short id in every relevant output** | Ensure status, next, show always expose short id (hash_id) prominently so agents can copy-paste into start/done/note.                   | Low (audit + doc) |

---

## 5. Synthesis

**What we already do well**

- Consistent `--json` on the commands agents use (next, context, status, start, done, worktree list).
- Clear lifecycle: start → work → done, with worktree and merge semantics documented.
- Short task IDs (tg-XXXXXX) accepted everywhere; global options documented.
- Agent contract and subagent-dispatch rules spell out exact commands and protocols.

**Gaps to address first**

1. **Hive context** — Implement `tg context --hive --json` per existing plan so implementers can do hive sync without relying on a non-existent no-args context.
2. **Start output** — Include `worktree_path` (and optionally `plan_branch` / `plan_worktree_path`) in `tg start --worktree --json` so implementers don’t need a separate `tg worktree list --json` to find their path.
3. **Single agent entrypoint** — One short subsection in AGENT.md (and optionally a `tg skills`-style command) that lists the exact agent-facing commands and when to use them, to reduce backtracking and keep CLI renames from leaving stale references in agent templates.

**External patterns we can adopt without overbuilding**

- **Structured errors:** Standardize and document the JSON error shape for all `--json` commands.
- **Progressive discovery:** AGENT.md entrypoint + optional `tg skills` as a machine-readable summary of workflows.
- **Minimize tokens:** Keep JSON shapes lean; avoid adding verbose human-only fields to agent-facing outputs.

---

## 6. References

- Internal: AGENT.md, docs/agent-contract.md, docs/cli-reference.md, .cursor/rules/subagent-dispatch.mdc, .cursor/agents/implementer.md, docs/agent-field-guide.md, .cursor/memory.md, plans/26-03-02_hive_context.md
- External: CLIWatch “Designing a CLI Skills Protocol for AI Agents”; “CLI Design for AI Agents: Machine-Readable Output and Ergonomics” (web search); Gastown README (gt CLI, convoys, hooks)
