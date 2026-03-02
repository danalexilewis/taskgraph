---
name: Breadcrumbs - File-Based Agent Coordination
overview: Add a committed path-scoped breadcrumb system for async agent-to-agent clues via .breadcrumbs.json; convention in agent instructions; optional config tuning; optional tg breadcrumb CLI.
fileTree: |
  .breadcrumbs.json                        (create)
  .gitattributes                           (create)
  docs/
  ├── breadcrumbs.md                       (create)
  └── domains.md                           (modify - add breadcrumbs slug)
  .cursor/
  ├── agent-utility-belt.md                (modify - add breadcrumb convention)
  └── agents/
      ├── implementer.md                   (modify - add breadcrumb check step)
      └── reviewer.md                      (modify - add breadcrumb note)
  src/
  └── cli/
      ├── utils.ts                         (modify - breadcrumbPolicy config keys)
      ├── note.ts                          (modify - update description)
      ├── breadcrumb.ts                    (create - stretch)
      └── index.ts                         (modify - register command, stretch)
  docs/cli-reference.md                    (modify - stretch)
risks:
  - description: Merge conflicts on .breadcrumbs.json in parallel task worktrees
    severity: medium
    mitigation: ".gitattributes merge=union on .breadcrumbs.json; breadcrumb entries are append-only objects so union merge keeps both sides additions cleanly"
  - description: Convention adoption depends on LLM compliance - no structural enforcement
    severity: low
    mitigation: Phase 1 is convention-only by design; config key and CLI in later phases increase enforcement without requiring it
  - description: src/cli/utils.ts overlaps with active CLI Ergonomics plan
    severity: low
    mitigation: breadcrumbPolicy is a new field on Config interface - different lines, no logical conflict; coordinate timing with that plan
tests:
  - "Task 5 (CLI): tg breadcrumb add, list, check, promote round-trip - assigned to task-5-cli"
  - "Task 5 (CLI): tg breadcrumb list --json output shape - assigned to task-5-cli"
todos:
  - id: task-1-store
    content: "Create .breadcrumbs.json store and .gitattributes with union merge strategy"
    agent: implementer
    changeType: create
    intent: |
      Create the breadcrumb store as a committed flat JSON file at repo root,
      following the breadcrumb-cli v2 format. Also create .gitattributes to
      handle concurrent branch merges cleanly.

      1. Create .breadcrumbs.json at repo root:
         {
           "version": 2,
           "breadcrumbs": []
         }
         This is the canonical empty store. Format per entry:
         {
           "id": "b_a1b2c3",
           "path": "src/db/migrations.ts",
           "message": "Migration X must run before Y - they share the same table lock window",
           "severity": "info",
           "added_by": { "agent_id": "implementer" },
           "added_at": "2026-03-02T10:00:00Z",
           "promoted": false
         }
         - id: short hash (b_ + 6 hex chars)
         - path: relative path from repo root; can be a file or directory prefix
         - severity: "info" | "warn"
         - promoted: false until agent promotes to code comment

      2. Create .gitattributes at repo root:
         .breadcrumbs.json merge=union
         This tells git to union-merge the file on conflicts (keep both sides
         additions). The built-in union driver is available in standard git with
         no extra config. Document this in the .breadcrumbs.json README (Task 2).

      3. Confirm .breadcrumbs.json is NOT listed in .gitignore (breadcrumbs are committed).
         Check .gitignore and remove any matching entry if present.
  - id: task-2-doc
    content: "Write docs/breadcrumbs.md domain doc and add slug to docs/domains.md"
    agent: documenter
    changeType: create
    intent: |
      Create docs/breadcrumbs.md as a domain doc following the documentation-strategy.mdc
      structure: triggers frontmatter, Purpose, Format, Promotion workflow, Relation to
      other channels, Staleness, Decisions/gotchas, Related projects.

      Key content to cover:
      - What breadcrumbs are: committed, path-scoped post-it clues for async
        agent-to-agent coordination. Not a task tracker (that is Dolt / tg note).
      - Storage: .breadcrumbs.json at repo root. Version 2 format (breadcrumb-cli
        compatible). Read the whole file (cheap - will never exceed a few hundred
        entries), filter by path prefix in memory.
      - Format per entry: id (b_xxxxxx), path, message, severity (info|warn),
        added_by.agent_id, added_at (ISO), promoted (bool).
      - When to write: after a non-obvious fix, intentional workaround, or
        security-critical pattern that future agents might "helpfully simplify."
      - When to read: before editing files, read .breadcrumbs.json and filter
        entries whose path matches (or is a prefix of) the files you will edit.
        Factor relevant entries into your approach.
      - Promotion workflow: if a breadcrumb was critical to your decision, copy
        the message as a code comment at the relevant lines, then set promoted: true
        in the entry (or remove the entry). The comment is the durable form; the
        breadcrumb is the coordination signal.
      - Relation to tg note: tg note is task-scoped (tied to a task ID in Dolt,
        visible in tg context / hive). Breadcrumbs are path-scoped (tied to a file
        path, survive task closure and session end).
        Rule of thumb: "task B should know X" -> tg note. "anyone touching this
        file should know Y" -> breadcrumb.
      - Relation to memory.md: memory.md is transient session context; breadcrumbs
        are durable (committed) path context.
      - Staleness: when you notice a breadcrumb no longer applies (code refactored,
        bug fixed upstream), remove the entry from .breadcrumbs.json or set
        promoted: true.
      - .gitattributes merge=union: explain why it is set and what it means.
      - Config policy (Phase 2): optional breadcrumbPolicy in .taskgraph/config.json.
        readScope: "all" | "touched" | "none" (default: touched).
        dropScope: "all" | "non_obvious" | "none" (default: non_obvious).

      Triggers frontmatter:
        files: [".breadcrumbs.json", "docs/breadcrumbs.md"]
        change_types: ["create", "modify"]
        keywords: ["breadcrumb", "breadcrumbs", "path-scoped", "agent clue"]

      After writing docs/breadcrumbs.md, add the slug to docs/domains.md.
  - id: task-3-conventions
    content: "Add breadcrumb convention to agent-utility-belt.md, implementer.md, reviewer.md; update tg note description"
    agent: documenter
    changeType: modify
    blockedBy: [task-2-doc]
    intent: |
      Document the breadcrumb convention in agent instruction files so it is
      automatically surfaced to every sub-agent.

      1. .cursor/agent-utility-belt.md - add a new "## Breadcrumbs" section:
         - Before editing files: read .breadcrumbs.json (the whole file is small),
           filter entries whose path matches or is a prefix of the files you will edit,
           and factor any relevant entries into your approach.
         - After a non-obvious fix, intentional workaround, security-critical pattern,
           or "this looks wrong but is intentional" code: add an entry to .breadcrumbs.json
           for that path. Use severity "warn" for things that must not be changed;
           "info" for context that is helpful but not safety-critical.
         - If a breadcrumb was critical to your decision: promote it by copying the
           message as a code comment at the relevant lines, then set promoted: true
           in the entry (or remove it). The comment is the durable form.
         - Do not create breadcrumbs for obvious, well-documented, or already-commented
           code. Signal-to-noise matters.
         - See docs/breadcrumbs.md for the full format and guidance.

      2. .cursor/agents/implementer.md - in the "Load context" step, add:
         "Read .breadcrumbs.json and filter for entries matching the paths you will
         edit. Factor any relevant breadcrumbs into your approach before making changes."

      3. .cursor/agents/reviewer.md - add a note in the "What to check" section:
         "If code looks intentionally unusual or risky and has no breadcrumb explaining
         it, suggest that the implementer add one."

      4. src/cli/note.ts - update the command description to distinguish it from
         breadcrumbs. Change description to include: "Task-scoped note (visible in
         tg context and tg show). For path-scoped clues that survive task closure,
         use .breadcrumbs.json (see docs/breadcrumbs.md)."
  - id: task-4-config
    content: "Add optional breadcrumbPolicy config keys to Config interface in src/cli/utils.ts"
    agent: implementer
    changeType: modify
    intent: |
      Add an optional breadcrumbPolicy field to the Config interface in src/cli/utils.ts.
      Pure TypeScript interface change - no DB migration, no migration probe, no new file.
      The field is optional so existing configs continue to work unchanged.

      In the Config interface (around line 183-202 of src/cli/utils.ts), add:

        breadcrumbPolicy?: {
          /**
           * "all"     = check .breadcrumbs.json for every file touched
           * "touched" = check only for files the agent explicitly edits (default when omitted)
           * "none"    = skip breadcrumb checks entirely
           */
          readScope?: "all" | "touched" | "none";
          /**
           * "all"         = always drop a breadcrumb after any fix
           * "non_obvious" = only after non-obvious fixes (default when omitted)
           * "none"        = never drop breadcrumbs
           */
          dropScope?: "all" | "non_obvious" | "none";
        };

      No tests required - pure interface extension, no runtime behavior in Phase 1.
      Run pnpm typecheck after to confirm no regressions.
  - id: task-5-cli
    content: "Add tg breadcrumb CLI subcommand (list, add, check, promote)"
    agent: implementer
    changeType: create
    blockedBy: [task-1-store, task-4-config]
    intent: |
      Stretch goal. Only execute if explicitly requested. Tasks 1-4 (convention +
      docs + config) are the core deliverable; this CLI is additive.

      Create src/cli/breadcrumb.ts and register in src/cli/index.ts.

      Subcommands (all read/write .breadcrumbs.json at repo root):

      1. tg breadcrumb list [path] [--json]
         - List all entries (or filtered by path prefix if path given).
         - Table output: path, message (truncated 60 chars), severity, added_by, promoted.
         - --json: full entry array.

      2. tg breadcrumb add <path> <message> [--severity info|warn] [--author <name>]
         - Append a new entry to .breadcrumbs.json.
         - id = "b_" + 6-char hex from hash of path + Date.now().
         - added_at = new Date().toISOString(), promoted = false.
         - Default severity: "info". Default author: "agent".

      3. tg breadcrumb check <path> [--json]
         - Show entries whose path matches or is a prefix of <path>.
         - Concise output (no table borders) for agent context injection.
         - --json: matching entries array.

      4. tg breadcrumb promote <id>
         - Find entry by id in .breadcrumbs.json.
         - Print: "// <message>" (formatted as JS comment) to stdout for agent to paste.
         - Set promoted: true in the entry and rewrite the file.

      Follow project conventions:
      - commander.js subcommand pattern (see plan.ts for parent + addCommand pattern).
      - neverthrow Result types for file read/write operations.
      - --json flag on list and check.
      - printError / exitWithError for error output (see utils.ts).

      Register: import breadcrumbCommand from ./breadcrumb in src/cli/index.ts;
      call program.addCommand(breadcrumbCommand()).

      Update docs/cli-reference.md with a tg breadcrumb section.

      Tests in __tests__/integration/breadcrumb.test.ts:
      - add writes entry to .breadcrumbs.json
      - list returns the added entry
      - check filters by path prefix
      - promote sets promoted: true and prints comment to stdout
  - id: task-run-suite
    content: "Run pnpm gate to verify no regressions from config interface change"
    agent: implementer
    changeType: test
    blockedBy: [task-1-store, task-2-doc, task-3-conventions, task-4-config]
    intent: |
      Run `pnpm gate` (lint + typecheck on changed files + affected tests) from the
      plan worktree and record the result in evidence.

      Steps:
      1. Run: pnpm gate
      2. If gate passes: tg done with evidence "gate passed".
      3. If gate fails: add tg note with the failure summary; record in evidence
         "gate failed: <summary>" so the orchestrator can create fix tasks.

      Note: task-5-cli (CLI stretch goal) has its own integration tests in its intent;
      if task-5-cli is included in the execution wave, re-run gate after it completes.
isProject: false
---

# Breadcrumbs — File-Based Agent Coordination

## Analysis

Agents in this project currently coordinate through **task-scoped `tg note`** (Dolt, visible in context/hive) and **session-scoped `memory.md`** (transient). There is no **path-scoped, persistent** channel — no way for an agent to leave a clue attached to a file that any future agent touching that file will see, regardless of task or session.

The breadcrumb system fills this gap. It is inspired by `breadcrumb-cli` (tylergibbs1) but adapted to project idioms: committed flat JSON (cheap single-file read, simple filtering in memory), `.gitattributes merge=union` for merge safety, and YAML-free entries (plain JSON objects).

**Key design decisions:**
- **Committed, not git-ignored** — breadcrumbs survive sessions, branches, and machines.
- **Flat `.breadcrumbs.json`** — one file at repo root, always cheap to read (will never exceed a few hundred entries). The entire file is a few KB at most. Filter by path prefix in memory. Union merge strategy handles concurrent branch additions without conflicts.
- **Convention-first** — the minimum viable version is agent instructions (utility belt + implementer/reviewer templates). CLI is a stretch goal.
- **No Beads** — Beads is a full parallel task graph in Python; we already have Dolt for that. Breadcrumbs are post-it notes.

## Dependency graph

```
Parallel start (3 unblocked):
  ├── task-1-store        (create .breadcrumbs.json + .gitattributes)
  ├── task-2-doc          (write docs/breadcrumbs.md)
  └── task-4-config       (add breadcrumbPolicy to Config interface)

After task-2-doc:
  └── task-3-conventions  (agent-utility-belt, implementer.md, reviewer.md, note.ts)

After task-1-store + task-4-config (stretch only):
  └── task-5-cli          (tg breadcrumb list/add/check/promote)

After task-1-store + task-2-doc + task-3-conventions + task-4-config:
  └── task-run-suite      (pnpm gate)
```

## Proposed format

Entry in `.breadcrumbs.json`:

```json
{
  "version": 2,
  "breadcrumbs": [
    {
      "id": "b_a1b2c3",
      "path": "src/db/migrations.ts",
      "message": "Lock order matters - acquire plan_worktree lock before task lock",
      "severity": "warn",
      "added_by": { "agent_id": "implementer" },
      "added_at": "2026-03-02T10:00:00Z",
      "promoted": false
    }
  ]
}
```

## Relation to existing coordination channels

| Channel | Scope | Lifetime | Use for |
|---------|-------|----------|---------|
| `tg note` | Task-scoped | Until task archived | "Task B should know X" |
| **Breadcrumb** | Path-scoped | Durable (committed) | "Anyone touching this file should know Y" |
| `memory.md` | Session-scoped | Transient | Env quirks, recent corrections |
| `docs/` | Repo-wide | Durable | Architectural knowledge |

## Open questions

- Staleness detection (content hashes a la breadcrumb-cli `verify`) — defer to a future plan once we can observe which breadcrumbs go stale in practice.
- Should `tg breadcrumb check` be automatically called as part of `tg context`? Deferred — convention first, wire into context if adoption proves useful.

<original_prompt>
User: plan the breadcrumbs / file-based agent coordination system. Breadcrumbs are committed flat JSON (.breadcrumbs.json), not git-ignored. .gitattributes union merge for conflict safety. No Beads (too heavy, overlaps with Dolt). Convention-first; CLI is stretch. Config tuning (breadcrumbPolicy readScope/dropScope) in Phase 2.
</original_prompt>
