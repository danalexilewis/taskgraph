---
triggers:
  files: [".breadcrumbs.json", "docs/breadcrumbs.md"]
  change_types: ["create", "modify"]
  keywords: ["breadcrumb", "breadcrumbs", "path-scoped", "agent clue"]
---

# Breadcrumbs

Path-scoped, committed post-it clues for async agent-to-agent coordination. When you fix something non-obvious or make an intentional workaround, drop a breadcrumb so the next agent touching that file doesn't undo your work.

## Purpose

**Owns:** `.breadcrumbs.json` at repo root — a flat list of path-scoped notes that travel with the repo and survive session end.

**Does not own:** task coordination (that is `tg note`), session-scoped transient context (that is `memory.md`), or durable architectural knowledge (that is `docs/`).

## Storage

Single file: `.breadcrumbs.json` at repo root. Version 2 format (breadcrumb-cli compatible).

Reading is cheap — the file will never exceed a few hundred entries. Read the whole file and filter by `path` prefix in memory. No globbing, no subdirectories.

## Format

Each entry is a JSON object in the top-level array:

```json
{
  "id": "b_a1b2c3",
  "path": "src/db/migrations.ts",
  "message": "Migration X must run before Y - share same table lock window",
  "severity": "info",
  "added_by": { "agent_id": "implementer" },
  "added_at": "2026-03-02T10:00:00Z",
  "promoted": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | `b_` prefix + 6 hex chars (e.g. `b_a1b2c3`) |
| `path` | string | Relative from repo root — may be a file or directory prefix |
| `message` | string | The clue itself |
| `severity` | `"info"` \| `"warn"` | Informational or warning-level |
| `added_by.agent_id` | string | Agent or human that wrote the entry |
| `added_at` | string | ISO 8601 datetime |
| `promoted` | bool | `true` when the message has been copied to a code comment |

## When to Write

Drop a breadcrumb after:

- A **non-obvious fix** — the code looks like it could be simplified but must not be.
- An **intentional workaround** — a hack that is load-bearing; future agents might "helpfully" clean it up.
- A **security-critical pattern** — constraint that must hold at this call site.

Do not breadcrumb routine changes. Rule of thumb: "would a reasonable agent reading this code be tempted to change it in a way that breaks things?" If yes, breadcrumb it.

## When to Read

Before editing files, read `.breadcrumbs.json` and filter for entries whose `path` matches (is equal to, or is a prefix of) the files you plan to edit. Factor relevant entries into your approach before touching anything.

```bash
# Quick filter — entries touching src/db/
cat .breadcrumbs.json | jq '[.[] | select(.path | startswith("src/db/"))]'
```

## Promotion Workflow

If a breadcrumb was critical to your decision:

1. Copy the `message` as a code comment at the relevant line(s).
2. Set `promoted: true` in the `.breadcrumbs.json` entry (or remove the entry).

The comment is the **durable form**; the breadcrumb is the **coordination signal**. Once promoted, the breadcrumb has done its job.

## Staleness

When you notice a breadcrumb no longer applies (bug fixed upstream, code refactored):

- Remove the entry from `.breadcrumbs.json`, or
- Set `promoted: true` to mark it resolved.

Stale breadcrumbs erode trust in the channel. Clean them up opportunistically.

## Coordination Channel Comparison

| Channel | Scope | Lifetime | Use for |
|---------|-------|----------|---------|
| `tg note` | Task-scoped | Until task archived | "Task B should know X" |
| Breadcrumb | Path-scoped | Durable (committed) | "Anyone touching this file should know Y" |
| `memory.md` | Session-scoped | Transient | Env quirks, recent corrections |
| `docs/` | Repo-wide | Durable | Architectural knowledge |

**`tg note` vs breadcrumb rule of thumb:**
- "Task B should know X" → `tg note`
- "Anyone touching this file should know Y" → breadcrumb

**`memory.md` vs breadcrumb:** `memory.md` is transient session context, lost when the session ends. Breadcrumbs are committed; they persist across sessions, clones, and checkouts.

## `.gitattributes` merge=union

`.breadcrumbs.json` uses `merge=union` in `.gitattributes`. Reason: concurrent task worktrees on different branches may each add entries. Without `merge=union`, merging those branches produces a conflict on the JSON file. With `merge=union`, git keeps both sides' additions — both entries survive. This is safe because entries are append-only and identified by unique `id`s; duplicates are benign.

## Config Policy (Phase 2)

Optional `breadcrumbPolicy` in `.taskgraph/config.json`:

```json
{
  "breadcrumbPolicy": {
    "readScope": "touched",
    "dropScope": "non_obvious"
  }
}
```

| Key | Values | Default | Meaning |
|-----|--------|---------|---------|
| `readScope` | `"all"` \| `"touched"` \| `"none"` | `"touched"` | Which breadcrumbs to check before editing. `touched` = only for files you explicitly edit. |
| `dropScope` | `"all"` \| `"non_obvious"` \| `"none"` | `"non_obvious"` | When to write breadcrumbs. `non_obvious` = only after non-obvious fixes or workarounds. |

These keys are advisory for Phase 2 tooling; currently agents follow the policy by convention.

## Decisions / Gotchas

**Why flat JSON, not a directory of files?**
A single file read is cheaper than globbing + reading multiple files. At the scale this project will reach (tens to low hundreds of entries), in-memory filtering is trivial. A directory would require a glob on every agent invocation.

**Why committed, not git-ignored?**
Durability across sessions and machines is the core value proposition. A git-ignored `.breadcrumbs.json` would be lost on clone or fresh checkout — exactly when a new agent most needs the context.

**Why not Beads or a similar system?**
Beads is a full parallel task graph (Python, JSONL, SQLite). Task-Graph already has Dolt for task coordination. Breadcrumbs are post-it notes, not an execution engine.

**Breadcrumbs are not a task tracker.**
Do not use breadcrumbs to record task status, block/unblock relationships, or review verdicts. Those belong in the Dolt task graph (`tg note`, `tg block`).

## Related Projects

- Breadcrumbs Agent Coordination (2026-03-02)
