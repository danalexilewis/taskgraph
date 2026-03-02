# Research: File-Based Breadcrumbs for Agent Coordination

**Date:** 2026-03-02  
**Scope:** Leveraging cheap file reads for sub-agent coordination via git-ignored breadcrumbs; optional reinforcing behavior.  
**Method:** Research skill — external projects, vendor/ecosystem patterns, comparison with current Task-Graph coordination.

---

## 1. Executive summary

**Idea:** Agents read and write **breadcrumbs** (post-it-style clues) in the repo. Breadcrumbs live in a **git-ignored** directory so they are ephemeral and don’t clutter commits. If an agent finds a clue useful, it can **promote** it into the codebase (e.g. as a comment or doc). Otherwise they stay uncommitted. **Reinforcing behavior:** agents that find notes helpful can learn to use them more (read/drop more); if not helpful, ignore. Tunable later.

**Finding:** This fits well with existing patterns (Breadcrumb protocol, MassGen filesystem memory, Beads-style location of memory in the repo). Our current coordination is **task-scoped notes in Dolt + hive snapshot**. Breadcrumbs add **location-scoped, file-based, async** clues that don’t require knowing task IDs and are cheap to read. Git-ignoring them is a deliberate choice (unlike some reference projects that commit notes) and matches “promote when valuable” and low review noise.

**Recommendations:** (1) Introduce a single git-ignored breadcrumb directory and a minimal convention (path-scoped clues, optional promotion). (2) Document “read breadcrumbs for touched paths; drop after non-obvious fixes” in agent instructions/utility belt. (3) Keep reinforcing behavior as a tunable (config or small state file) for later; no RL required.

---

## 2. Current Task-Graph coordination (baseline)

From `docs/agent-strategy.md`, `docs/multi-agent.md`, and `AGENT.md`:

| Mechanism                             | Scope               | Storage                                                          | Visibility                                       |
| ------------------------------------- | ------------------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| **`tg note <taskId> --msg "..."`**    | Task-scoped         | Dolt `event` table                                               | `tg context`, `tg show`, hive snapshot           |
| **Hive** (`tg context --hive --json`) | All doing tasks     | Dolt + live query                                                | Orchestrator / sub-agents who ping               |
| **memory.md / pending-learnings**     | Session / transient | `.cursor/memory.md`, `.cursor/pending-learnings.md` (gitignored) | Next session / learnings hook                    |
| **docs/**                             | Durable             | Committed                                                        | All agents via `tg context` / doc-skill-registry |

Notes are the main **cross-dimensional** channel: implementers write introspectively (one task); orchestrator and other tasks read connectively. Hive coordination is **read group → reflect on self → optionally note on other tasks**. There is no **file- or path-scoped** ephemeral channel that lives next to the code and is independent of task IDs.

---

## 3. External patterns

### 3.1 Breadcrumb (tylergibbs1/breadcrumb)

**What it is:** CLI + optional Claude plugin. Agents attach notes to **files**; notes are shown when an agent reads that file (e.g. injected as a warning). “Don’t simplify this regex”, “money as integers”, etc.

**Key patterns:**

- **Path- or line-anchored notes** — one note per path (or line range). Stored in `.breadcrumbs.json` at repo root.
- **Discoverability** — `breadcrumb ls`, `breadcrumb check <path>`, `breadcrumb search`. Concise mode (`-c`) for token-efficient output.
- **Staleness** — file content hash; `verify` flags when the file changed so the note may be outdated.
- **Severity, TTL, evidence** — optional metadata (info/warn, expiry, test input/expected).
- **Vendor-agnostic** — any agent that can run shell commands can `breadcrumb check <path>` before editing and `breadcrumb add <path> "msg"` after non-obvious work.

**Gap it fills:** Prevents “helpful” simplifications that break intentional edge cases. Aligns with “clues that others see when they touch the same code.”

**Adoption cost:** Medium. We could adopt the **convention** (path-scoped clues, read-before-edit, drop-after-fix) without the CLI. If we want tooling, we could depend on `breadcrumb-cli` or implement a minimal subset.

**Difference from our idea:** Breadcrumb’s store is **committed** (`.breadcrumbs.json`). User wants **git-ignored** breadcrumbs so they’re ephemeral; promotion to a comment is the path to durability.

---

### 3.2 VibeCoding Breadcrumb Protocol (Dasith)

**What it is:** Structured **per-task** breadcrumb **files** in `.github/.copilot/breadcrumbs/` (e.g. `yyyy-mm-dd-HHMM-title.md`). Each file is a living doc: References, Before/After, Changes Made, Decisions, Plan, Requirements. Single source of truth for that task’s context between human and AI.

**Key patterns:**

- **One breadcrumb file per task** — named by time + title; contains sections (plan, decisions, changes).
- **Centralized knowledge** — domain knowledge and specs in `.github/.copilot/domain_knowledge/` and `specifications/`.
- **Workflow rules** — “update breadcrumb after each significant change”; “get approval on plan before implementation.”

**Gap it fills:** Context alignment across sessions and between human and AI; reduces re-explaining.

**Adoption cost:** Medium–High. More structured and workflow-heavy than “post-it clues.” Good for planned tasks; less so for ad-hoc “here’s a clue for whoever touches this file.”

**Difference from our idea:** Task-centric, committed, living doc. We want **location-centric**, **ephemeral** clues and optional promotion.

---

### 3.3 Beads (Steve Yegge)

**What it is:** Git-backed agent memory. Task graph and thoughts in `.beads/` as JSONL; **versioned with the repo**. Branch/merge code and agent context together.

**Key patterns:**

- **Memory in repo** — `.beads/` committed; branches carry agent context.
- **Structured task graph** — dependencies, blocking, hash-based IDs (merge-friendly).
- **Compaction** — “semantic memory decay”: closed tasks summarized to save context.

**Gap it fills:** Long-horizon, multi-session work; agent “remembers” across branches.

**Adoption cost:** High for our case. We already have a task graph in Dolt and plan branches. Beads overlaps with our graph and is committed; we want **uncommitted** clues.

**Takeaway:** “Memory next to code” is validated; we’re choosing **uncommitted** for breadcrumbs so they’re cheap and promotion is explicit.

---

### 3.4 MassGen memory filesystem mode

**What it is:** Two-tier **filesystem** memory: Markdown files in `memory/short_term/` and `memory/long_term/` with YAML frontmatter. **Short-term** auto-injected into every agent’s system prompt; **long-term** summary in prompt, full content on-demand. Cross-agent: all agents see all memories.

**Key patterns:**

- **Short-term vs long-term** — small, tactical, always in-context vs larger, load-when-needed. Balances context window and visibility.
- **Cross-agent visibility** — orchestrator reads all workspace memory dirs each turn; every agent gets the same memory section.
- **Standard file ops** — create/update/delete by writing/deleting files. No special DB.
- **Archiving** — on agent restart, memories copied to session archive; deduplicated for display.

**Gap it fills:** Coordination without a central DB; file-based and transparent; token budget via tiers.

**Adoption cost:** Low for the **pattern** (directory, two tiers, frontmatter). We don’t need MassGen itself; we can adopt “breadcrumbs dir + optional short/long split.”

**Difference from our idea:** Their memory is **session/workspace** and injected by the orchestrator. We want **repo-local**, **git-ignored** breadcrumbs that any agent can read when touching a path; no mandatory injection.

---

### 3.5 Reinforcement / adaptive behavior

**What it is:** “If an agent finds notes helpful → use them more; if not → ignore.” Literature (e.g. agentic RL) focuses on **training** (rewards, policy). For our case we don’t need full RL.

**Practical options:**

- **Convention** — “Before editing, read breadcrumbs for touched paths; after non-obvious fixes, add a breadcrumb.” In agent instructions and utility belt.
- **Config** — e.g. in `.taskgraph/config.json` or a small `breadcrumbs-policy` file: `read_scope: all | touched | none`, `drop_scope: always | non_obvious | never`. Orchestrator or agents read it.
- **Lightweight feedback** — when promoting a breadcrumb to a comment, mark it (e.g. `promoted: true` in frontmatter or a separate `feedback.json`). A later pass or heuristic can tune policy (e.g. “in this repo, agents often promote under `src/db/` → suggest reading breadcrumbs there”). Start with convention + config; add feedback later if we want reinforcement.

**Adoption cost:** Low for convention; Low–Medium for config; Medium for feedback loop.

---

## 4. Synthesis: breadcrumbs in Task-Graph

### 4.1 What to add

- **Single breadcrumb directory** — e.g. `.taskgraph/breadcrumbs/` or `.cursor/breadcrumbs/`, **git-ignored**.
- **One file per clue** (or one index file). One-file-per-clue avoids merge conflicts when multiple agents write; allows “list/read all under path” easily. Format: Markdown with optional frontmatter (`path`, `scope`, `author`, `created`, `promoted`).
- **Path-scoped** — e.g. `breadcrumbs/src-db-migrations.md` or `breadcrumbs/src/db/notes.md` so “breadcrumbs for files under `src/db/`” is a simple glob or directory read.
- **Promotion** — when an agent finds a breadcrumb useful, it adds the content as a comment (or doc) in the codebase and can mark the breadcrumb as promoted (or delete it) so we don’t duplicate.
- **Convention in agent instructions** — “When you touch files under X, read `breadcrumbs/` for that path (if present). After a non-obvious fix or intentional workaround, write a short breadcrumb for that path.” Document in `.cursor/agent-utility-belt.md` and implementer/reviewer prompts.
- **Reinforcing** — Phase 1: convention only. Phase 2: config (read_scope / drop_scope). Phase 3 (optional): small state or feedback file to tune “read/drop more here.”

### 4.2 What we don’t need

- **Committed** breadcrumb store (we want ephemeral; promote for durability).
- **Orchestrator-injected** breadcrumbs (agents read on demand when touching paths; keeps context window under control).
- **Full RL** for “helpful or not” (convention + config + optional feedback is enough).

### 4.3 Relation to existing coordination

| Channel                   | Breadcrumbs                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **tg note**               | Notes are task-scoped and in Dolt; breadcrumbs are path-scoped and local. Use note for “task B should know X”; use breadcrumb for “anyone touching this file should know Y.” |
| **Hive**                  | Hive is “who is doing what now”; breadcrumbs are “what past work left as clues here.” Complementary.                                                                         |
| **memory.md / learnings** | Transient session/repo context and learnings routing. Breadcrumbs are **location-scoped** and **ephemeral until promoted**; learnings become **docs** or **memory**.         |

---

## 5. Recommendations

1. **Add breadcrumb directory and .gitignore**  
   Create e.g. `.taskgraph/breadcrumbs/` (or `.cursor/breadcrumbs/`). Add to `.gitignore`:  
   `.taskgraph/breadcrumbs/` or `.cursor/breadcrumbs/`.  
   Document in `docs/` (e.g. `docs/agent-strategy.md` or a short `docs/breadcrumbs.md`): purpose (async, location-scoped clues), format (one file per clue, optional frontmatter), promotion (copy to comment/doc, then delete or mark promoted).

2. **Agent convention**  
   In `.cursor/agent-utility-belt.md` and implementer (and optionally reviewer) instructions:
   - Before editing: if you touch files under path P, list/read breadcrumbs under the same path (if any).
   - After non-obvious fix or intentional workaround: write a short breadcrumb for that path (file or directory).  
     Optionally: “If a breadcrumb was critical to your decision, promote it to a code comment and remove or mark the breadcrumb.”

3. **Reinforcing behavior (tunable later)**
   - **Now:** Convention only (read/drop by path).
   - **Later:** Config in `.taskgraph/config.json` or a small `breadcrumbs-policy` file (e.g. `read_scope`, `drop_scope`) that agents or orchestrator read.
   - **Optional:** Feedback (e.g. `promoted: true` or a `feedback.json`) to adjust policy or surface “breadcrumbs in this area are often promoted” so agents read more there.

4. **Optional tooling**  
   If we want a tiny CLI: `tg breadcrumb list [path]`, `tg breadcrumb add <path> "message"`, `tg breadcrumb promote <file>` (copy to comment and mark promoted). Not required for v1; convention + directory + docs can be enough.

---

## 6. References

| Source                         | URL                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Breadcrumb (tylergibbs1)       | https://github.com/tylergibbs1/breadcrumb                                                                               |
| VibeCoding Breadcrumb (Dasith) | https://dasith.me/2025/04/02/vibe-coding-breadcrumbs/                                                                   |
| Beads (Yegge)                  | https://github.com/steveyegge/beads ; https://yuv.ai/blog/beads-git-backed-memory-for-ai-agents-that-actually-remembers |
| MassGen memory filesystem      | https://docs.massgen.ai/en/latest/user_guide/files/memory_filesystem_mode.html                                          |
| Agent strategy (ours)          | docs/agent-strategy.md                                                                                                  |
| Multi-agent (ours)             | docs/multi-agent.md                                                                                                     |
| Agent utility belt (ours)      | .cursor/agent-utility-belt.md                                                                                           |
