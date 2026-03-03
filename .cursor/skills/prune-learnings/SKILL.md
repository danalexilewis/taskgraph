---
name: prune-learnings
description: Periodic audit to prune stale or duplicate learnings from .cursor/memory.md, .cursor/agent-utility-belt.md, and agent ## Learnings sections. Use when the user says "prune learnings", "audit learnings", or on a schedule (e.g. weekly or after N plans).
---

# Prune Learnings — Periodic Audit

**You** (the lead) do the audit and pruning. Do not dispatch sub-agents.

Audit and prune stale or duplicate learnings from the three learnings surfaces so they stay lean and high-signal. Any agent can execute this skill.

## Scope

| Surface | Location | Guideline |
| -------- | -------- | --------- |
| Memory | `.cursor/memory.md` | Under 150 lines; transient context only |
| Utility belt | `.cursor/agent-utility-belt.md` | Cross-cutting patterns; avoid duplication with agent Learnings |
| Agent Learnings | `.cursor/agents/*.md` → `## Learnings` | Under ~10 entries per file; fold recurring into main template |

## Definitions

- **Stale**
  - **memory.md:** Entry no longer accurate or useful (obsolete tool version, one-off fix that no longer applies, or content already promoted to `docs/`). Optionally treat entries older than ~90 days with no recent reference as candidates for removal or promotion.
  - **agent-utility-belt.md:** Pattern superseded by a doc or by text in an agent template; or redundant with an agent Learnings entry.
  - **Agent ## Learnings:** Entry older than ~6 months and superseded by text in the same file’s main template; or directive that no longer applies (e.g. linter rule changed).

- **Duplicate**
  - Same or near-same directive in two or more places (keyword or close-paraphrase match). Keep the canonical copy: per-agent directives in that agent’s `## Learnings`; cross-cutting in `agent-utility-belt.md`. Remove the duplicate(s). When both memory.md and a doc say the same thing, keep the doc and remove from memory.

## When to run

- **Weekly:** As a recurring audit (e.g. calendar or checklist).
- **After every N plans:** e.g. after every 5 completed plans, run this skill (before or after `/clean-up-shop` if desired).
- **On demand:** User says "prune learnings", "audit learnings", or when a surface exceeds the guideline (memory &gt; 150 lines, or any agent `## Learnings` &gt; ~10 entries).
- **After `/evolve`:** If evolve just added several learnings, consider running prune-learnings to consolidate and avoid bloat.

## Steps

**1. Read all three surfaces**

- `.cursor/memory.md`
- `.cursor/agent-utility-belt.md`
- Each `.cursor/agents/*.md` that has a `## Learnings` section (e.g. implementer.md, quality-reviewer.md, reviewer.md, fixer.md, documenter.md, debugger.md, spec-reviewer.md, planner-analyst.md, explorer.md, investigator.md, sitrep-analyst.md)

**2. Identify stale entries**

- In each file, mark entries that are obsolete, superseded by docs or main template, or (where applicable) older than the age threshold and low-signal.
- Do not remove entries that are still the only record of a useful correction.

**3. Identify duplicates**

- Compare memory.md, agent-utility-belt.md, and agent Learnings for keyword or close-paraphrase matches.
- Decide canonical location (agent file vs utility belt vs memory) and which copy to remove.

**4. Prune**

- Remove stale entries.
- Remove duplicate copies; keep one canonical entry per directive.
- For agent Learnings: if the section still has &gt; ~10 entries after de-duplication, fold recurring directives into the agent’s main prompt template (per `.cursor/agents/README.md` consolidation rule) and delete those learnings entries.

**5. Report**

- List what was removed (file, brief description of entry or directive).
- Note any promotions (memory → docs, or learnings → main template).

## Output format

```markdown
## Prune learnings — YYYY-MM-DD

### Removed (stale)
- `memory.md`: <brief description>
- `implementer.md` ## Learnings: <brief description>

### Removed (duplicate)
- `quality-reviewer.md` ## Learnings: duplicate of implementer.md entry "<directive>"

### Consolidated
- `implementer.md`: folded 2 recurring directives into main template; removed 2 learnings entries

### Unchanged
- `agent-utility-belt.md`: no stale or duplicate entries
```

## Permissions

Read-write on `.cursor/memory.md`, `.cursor/agent-utility-belt.md`, and `.cursor/agents/*.md`. No sub-agent required; the agent that runs the skill does the edits.
