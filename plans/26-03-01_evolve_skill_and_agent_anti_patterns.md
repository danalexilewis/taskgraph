---
name: Evolve Skill and Agent Anti-Pattern Guards
overview: Create the /evolve skill for post-plan pattern mining, add explicit SQL and type anti-pattern checks to quality-reviewer and implementer, and fix existing raw SQL anti-patterns in start.ts and init.ts.
fileTree: |
  .cursor/
  ├── agents/
  │   ├── quality-reviewer.md     (modify - add Known Anti-Patterns section + Learnings entry)
  │   └── implementer.md          (modify - add SQL guard to MUST NOT DO + Learnings entry)
  ├── skills/
  │   ├── evolve/
  │   │   └── SKILL.md            (create - new /evolve skill)
  │   └── work/
  │       └── SKILL.md            (modify - add optional evolve step before plan-merge)
  └── rules/
      └── available-agents.mdc    (modify - register evolve skill)
  src/
  ├── cli/
  │   ├── start.ts                (modify - replace raw SQL INSERT for plan_worktree with query builder)
  │   └── init.ts                 (modify - replace raw SQL INSERT for cycle/initiative seeds with query builder)
  docs/
  └── skills/
      └── README.md               (modify - register evolve skill slug)
risks:
  - description: query builder may not support ON DUPLICATE KEY UPDATE; start.ts uses upsert semantics
    severity: medium
    mitigation: Check query.ts for upsert support; if absent, use query.raw() with named parameters or doltSql() with a bound params pattern rather than template literals
  - description: evolve skill reads plan branch that may already be merged (deleted) if work loop ran plan-merge first
    severity: medium
    mitigation: Skill gracefully falls back to git log on main for the squash commit; document the timing constraint in the skill
  - description: quality-reviewer's anti-pattern checklist may produce false positives on intentional raw SQL (migrations, complex joins)
    severity: low
    mitigation: Reviewer instructions distinguish when raw SQL is acceptable (migrate.ts, complex multi-join in query.raw()) vs flagged (single-table INSERT/UPDATE in CLI files)
tests:
  - "quality-reviewer.md contains a 'Known Anti-Patterns' section with at least 4 named patterns"
  - "implementer.md MUST NOT DO list includes the SQL builder rule"
  - "start.ts plan_worktree INSERT uses query builder or query.raw (no template literal with sqlEscape for VALUES)"
  - "init.ts seed INSERTs use query builder or query.raw"
  - "evolve/SKILL.md exists and includes: resolve plan, get diff, dispatch reviewer, route learnings"
todos:
  - id: quality-reviewer-anti-patterns
    content: "Add Known Anti-Patterns section and SQL learning to quality-reviewer.md"
    agent: documenter
    changeType: modify
    intent: |
      Edit .cursor/agents/quality-reviewer.md to add an explicit "Known Anti-Patterns (always flag)"
      section in the prompt template (between the 5 existing checks and the VERDICT block).

      Patterns to add:
      1. Raw SQL template literals for single-table INSERT/UPDATE — e.g. `doltSql(\`INSERT INTO t VALUES ('${sqlEscape(x)}')\`)` or any template literal passed to `doltSql` / `query.raw` where the query builder's `.insert()` / `.update()` would suffice. Flag: "Use query(repoPath).insert(table, data) or .update() instead. Reserve doltSql/query.raw for complex multi-join queries and migrations."
      2. Direct doltSql() calls in CLI files (src/cli/) — SQL should go through query(repoPath).raw() or the typed builder. Direct doltSql() is acceptable only in src/db/.
      3. Non-null assertions (`!` postfix) on values that could realistically be null at runtime without a preceding guard. Flag: "Use optional chaining or explicit null-check instead."
      4. `as any` / `as unknown as T` type coercions — flag and direct to type guards or Zod.
      5. Empty catch blocks — flag as must-fix (already in implementer MUST NOT DO; add here as double-check layer).

      Also add to the `## Learnings` section:
      - **[2026-03-01]** start.ts wrote raw SQL template literals for plan_worktree INSERT (VALUES ('${sqlEscape(planId)}'...)) instead of using the query builder. Always flag raw template-literal SQL in CLI files for single-table INSERT/UPDATE and direct to query(repoPath).insert(). Exception: migrate.ts migrations and status.ts complex multi-join queries are acceptable raw SQL.

  - id: implementer-sql-guard
    content: "Add SQL builder rule to implementer.md MUST NOT DO and Learnings"
    agent: documenter
    changeType: modify
    intent: |
      Edit .cursor/agents/implementer.md:

      1. Add to the MUST NOT DO list (after "Do not suppress type errors"):
         "Do not write raw SQL template literals for single-table INSERT or UPDATE operations —
         use query(repoPath).insert(table, data) / .update(table, data, where) from src/db/query.ts.
         Reserve doltSql() and query.raw() for complex queries (multi-join, subquery, complex WHERE)
         or for migrate.ts migrations. Do not call doltSql() directly in src/cli/ files; route
         through query(repoPath) from src/db/query.ts."

      2. Add to the `## Learnings` section:
         - **[2026-03-01]** Wrote raw SQL template literals for plan_worktree INSERT (`VALUES ('${sqlEscape(planId)}',...)`). Use query(repoPath).insert(table, { col: value, ... }) for single-table inserts — it handles escaping internally via formatValue(). Only use sqlEscape inside query.raw() template literals for values the builder cannot express.

  - id: fix-sql-anti-patterns
    content: "Replace raw SQL template literals in start.ts and init.ts with query builder calls"
    agent: implementer
    changeType: modify
    intent: |
      Fix the two CLI files that use raw SQL template literals for single-table INSERTs:

      1. src/cli/start.ts — ensurePlanBranch uses raw SQL for plan_worktree INSERT with ON DUPLICATE KEY UPDATE.
         - Read src/db/query.ts to understand what the builder supports.
         - If query.ts supports upsert (INSERT ... ON DUPLICATE KEY UPDATE), use it.
         - If not, use query(repoPath).raw(`INSERT INTO \`plan_worktree\` ...`) with the values
           passed via a params array or as named placeholders — NOT as template literal interpolation.
           The goal is that sqlEscape() calls inside VALUES clauses are eliminated; the driver handles escaping.
         - If doltSql() is the only path (no query builder wrapper), at minimum wrap the raw SQL call
           in a helper function `upsertPlanWorktree(planId, path, branch, repoPath)` so the raw SQL
           is isolated and clearly named.
         - Both INSERT paths in ensurePlanBranch (the new row path and the race-condition path) must be fixed.

      2. src/cli/init.ts — Check line ~114 for raw SQL INSERTs (cycle/initiative data seeds).
         - Apply the same treatment: use query builder for simple single-table inserts, or wrap
           raw SQL in a named helper if the builder cannot express the semantics.

      Do not change the business logic or behavior — only change how SQL is constructed. Run
      pnpm typecheck after to confirm no type errors introduced.
    suggestedChanges: |
      In src/db/query.ts, look for an existing insert method signature.
      It likely looks like: query(repoPath).insert(table, { col: value })
      which internally builds: INSERT INTO `table` (`col`) VALUES ('escaped_value')

      For upsert (ON DUPLICATE KEY UPDATE) — if not in query builder, use a helper:
        async function upsertPlanWorktree(
          planId: string,
          worktreePath: string,
          branch: string,
          repoPath: string,
        ): Promise<void> {
          const created = new Date().toISOString().replace("T", " ").slice(0, 19);
          await doltSql(
            "INSERT INTO `plan_worktree` (plan_id, worktree_path, worktree_branch, created_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE worktree_path = VALUES(worktree_path), worktree_branch = VALUES(worktree_branch), created_at = VALUES(created_at)",
            repoPath,
            [planId, worktreePath, branch, created],
          );
        }
      (Use parameterized queries / placeholder syntax if doltSql supports it; check its signature.)

  - id: evolve-skill-create
    content: "Create .cursor/skills/evolve/SKILL.md — the /evolve post-plan pattern mining skill"
    agent: documenter
    changeType: create
    intent: |
      Create .cursor/skills/evolve/SKILL.md as a new orchestrator skill.
      Read .cursor/skills/work/SKILL.md and .cursor/skills/investigate/SKILL.md first for format/style reference.
      Read .cursor/agents/quality-reviewer.md and .cursor/agents/implementer.md for the Learnings format.

      The skill is invoked when the user says "/evolve [plan-name-or-id]" or "evolve the last plan"
      or "find patterns from this plan". It may also be invoked by the work skill orchestrator
      before the plan-merge step.

      Skill structure (MUST include all sections):

      ## Purpose
      Post-plan pattern mining. After a plan completes, before the plan branch is merged,
      analyse the plan's task diffs to find implementation anti-patterns that required follow-up
      fixes, and route learnings to agent templates and docs.

      ## Architecture
      - Lead (orchestrator): resolves plan, collects diffs, dispatches reviewer in research mode, routes learnings
      - Sub-agent: reviewer (read-only, inherit model) — tactical directive: analyse diffs for anti-patterns

      ## When to use
      - User invokes /evolve explicitly
      - Work skill orchestrator runs evolve optionally after all tasks done, before plan-merge
      - TIMING: must run before plan-merge (plan branch deleted after wt merge)

      ## Step-by-step workflow

      Step 1 — Resolve the plan
        - If user gave a plan name: pnpm tg status --tasks --json to find it
        - Get plan hash_id from plan row (needed for branch name plan-<hash_id>)
        - Get list of all done tasks in the plan

      Step 2 — Get the plan diff
        - Primary: git diff main...plan-<hash_id> (full plan diff)
        - Per-task: git log plan-<hash_id> --not main --oneline (list task commits)
        - Fallback (if branch already merged): git log main --grep="plan: <plan-name>" --patch -1
        - Also run: pnpm tg status --tasks --json | filter by planId to get task notes (look for
          VERDICT: FAIL, STATUS: FIXED, follow-up, anti-pattern keywords in event bodies)

      Step 3 — Dispatch reviewer in research mode
        Pass to a reviewer sub-agent (no model=fast; inherit session model):
        - Full diff (or per-task diffs)
        - List of follow-up fix tasks and their notes
        - Tactical directive: "Analyse these diffs from plan <name>. For each implementation
          that was later fixed or flagged: identify the anti-pattern, classify it
          (SQL pattern | Type pattern | Error handling | Scope drift | Other),
          note the file and first-pass code, note the corrected code, suggest a one-line
          agent-file directive. Return a structured findings list."

      Step 4 — Route learnings (orchestrator does this, not sub-agent)
        For each finding:
        - SQL pattern → append to implementer.md ## Learnings AND quality-reviewer.md ## Learnings
        - Type pattern → append to implementer.md ## Learnings; optionally quality-reviewer.md
        - Error handling → append to quality-reviewer.md ## Learnings
        - Scope drift → append to implementer.md ## Learnings
        - Durable / structural (same issue in 3+ files or across plans) → suggest docs/skills/ update
        Before appending: scan the existing ## Learnings section; if the same directive already exists
        (keyword match), skip to avoid duplicates.
        When Learnings section exceeds ~10 entries: fold recurring directives into the main agent
        template and prune old entries (per the agent README consolidation rule).

      Step 5 — Report
        Output a structured table to the user (see Output format below) and stop.
        Do not import or create plan tasks unless the user asks for follow-up work.

      ## Output format
      ```markdown
      ## Evolve: Plan "<name>" — <date>

      ### Findings
      | Category | Pattern | File | Routed to |
      |---|---|---|---|
      | SQL pattern | raw INSERT template literal | src/cli/start.ts | implementer.md + quality-reviewer.md |

      ### Learnings written
      - implementer.md ## Learnings: N entries added
      - quality-reviewer.md ## Learnings: N entries added

      ### Durable patterns (suggest doc update)
      - (none) / docs/skills/cli-command-implementation.md: add SQL builder rule
      ```

      ## Permissions
      - Lead: read-write (appends to agent files)
      - Sub-agent (reviewer): read-only

  - id: evolve-skill-register
    content: "Register evolve skill in docs/skills/README.md, available-agents.mdc, and add to work/SKILL.md"
    agent: documenter
    changeType: modify
    blockedBy: [evolve-skill-create]
    intent: |
      Three doc edits to wire the evolve skill into the system:

      1. docs/skills/README.md — add an "evolve" row to the skills table:
         | evolve | Post-plan pattern mining; routes implementation anti-patterns as learnings to agent files |

      2. .cursor/rules/available-agents.mdc — add an "evolve" entry in the skills section (near the
         other skills like /work, /plan, /investigate):
         ## evolve
         Post-plan pattern mining. Analyses task diffs from a completed plan, identifies implementation
         anti-patterns that required fixes, and routes learnings to agent templates and docs/skills.
         Use when: user says /evolve, or after plan completion before plan-merge.
         Skill file: .cursor/skills/evolve/SKILL.md

      3. .cursor/skills/work/SKILL.md — in the "Plan-complete" section, add a note before "Plan-merge step":
         "**Optionally run `/evolve` before plan-merge** — reads the plan branch's diffs to surface
         implementation anti-patterns before the branch is deleted. Invoke if the plan had reviewer
         FAIL events or follow-up fix tasks. Syntax: read .cursor/skills/evolve/SKILL.md and follow
         the workflow with the just-completed plan as input."

  - id: run-full-suite
    content: "Run gate:full to validate evolve skill additions and SQL anti-pattern fixes"
    agent: implementer
    changeType: test
    blockedBy:
      [
        quality-reviewer-anti-patterns,
        implementer-sql-guard,
        fix-sql-anti-patterns,
        evolve-skill-register,
      ]
    intent: |
      From repo root, run `pnpm gate:full`. Record the result as evidence.
      If it passes: mark done with "gate:full passed".
      If it fails: add a tg note with the failure summary and mark done with
      "gate:full failed: <brief reason>" so the orchestrator can create fix tasks.
      Note: 47 pre-existing failures were present before this plan; compare against that baseline.
isProject: false
---

## Analysis

The user identified a concrete anti-pattern in the just-shipped Per-plan Worktree Model: `src/cli/start.ts` inserted rows into `plan_worktree` using raw SQL template literal interpolation (`INSERT INTO \`plan_worktree\` ... VALUES ('${sqlEscape(planId)}',...)`). The codebase has a query builder (`src/db/query.ts`) that handles escaping internally — this pattern bypasses it.

The failure had two compounding causes:

1. The implementer's MUST NOT DO list didn't explicitly prohibit raw SQL in CLI files.
2. The quality-reviewer's prompt has no explicit anti-pattern checklist — it checks generic quality categories but doesn't enumerate known gotchas.

Both are fixable with small, focused doc edits. The deeper insight is that as more plans execute, implementation failures follow repeating patterns. A systematic way to mine those patterns and route them back into agent templates is more durable than one-off memory entries.

### The evolve skill fills the gap between session-end learnings and agent improvement

The existing `learningMode` + session-end hook captures broad conversational context ("what happened in this session") and routes it through `pending-learnings.md`. The evolve skill is different:

- **Plan-scoped** not session-scoped
- **Diff-grounded** — reads actual code that was first written vs corrected
- **Structured findings** — categorises by anti-pattern type, not narrative summary
- **Agent-file targeted** — writes to `## Learnings` sections directly, not to memory.md

The two systems are complementary. The session-end hook catches strategy and workflow learnings. Evolve catches code-quality patterns.

### Timing constraint

The plan branch (`plan-<hash>`) is the primary diff source. It is **deleted** when `wt merge main` runs. The work skill must remind the orchestrator to run `/evolve` (if desired) before the plan-merge step. The skill also has a fallback for already-merged plans (grep the squash commit from `git log main`).

### SQL anti-pattern fix in start.ts

The analyst confirmed `src/cli/start.ts` and `src/cli/init.ts` contain raw SQL template literals for INSERT operations. These should use the query builder or parameterized placeholders. The `fix-sql-anti-patterns` task handles this. The query builder may not support `ON DUPLICATE KEY UPDATE` natively; the fix task's `suggestedChanges` provides a parameterized fallback pattern.

### Query builder vs doltSql() — acceptable uses

| Context                                        | Acceptable pattern                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/db/migrate.ts` — migrations               | Raw SQL inline — intentional, schema-defining                                 |
| `src/cli/status.ts` — complex multi-join       | `query.raw(sql)` is preferred; bare `doltSql()` is a smell but lower priority |
| `src/cli/*.ts` — single-table INSERT/UPDATE    | **Must use** `query(repoPath).insert()` / `.update()`                         |
| `src/cli/*.ts` — complex WHERE, subquery, JOIN | `query(repoPath).raw(sql)` with named params                                  |
| Direct `doltSql()` in `src/cli/`               | Anti-pattern — route through `query(repoPath)`                                |

## Dependency graph

```
Parallel start (4 unblocked):
  ├── quality-reviewer-anti-patterns  (quality-reviewer.md only)
  ├── implementer-sql-guard           (implementer.md only)
  ├── fix-sql-anti-patterns           (start.ts, init.ts — code fix)
  └── evolve-skill-create             (new .cursor/skills/evolve/SKILL.md)

After evolve-skill-create:
  └── evolve-skill-register           (README.md, available-agents.mdc, work/SKILL.md)

After all above:
  └── run-full-suite
```

## Open questions

1. **Does `query.ts` support upsert (ON DUPLICATE KEY UPDATE)?** The fix task checks this and falls back to a parameterized helper if not.
2. **Should evolve be mandatory before every plan-merge?** Decision: optional — work skill says "optionally run /evolve" so CI-style execution is not blocked. The user can invoke it explicitly when needed.
3. **What about `src/cli/status.ts` raw SQL?** The multi-join queries there use `doltSql()` directly (not via query.raw()). Lower priority — flagged as a smell in the quality-reviewer anti-pattern list but not in scope for this plan's fix task.

<original_prompt>
I looked at one of the implementer agents and saw this:

return doltSql(
`INSERT INTO \`plan_worktree\` (plan_id, worktree_path, worktree_branch, created_at) VALUES ('${sqlEscape(planId)}', '${sqlEscape(entry.path)}', '${sqlEscape(branchName)}', '${sqlEscape(created_at)}') ON DUPLICATE KEY UPDATE worktree_path = VALUES(worktree_path), worktree_branch = VALUES(worktree_branch), created_at = VALUES(created_at)`,
config.doltRepoPath,

When code changes like this are reported we should have a implementer improvement agent that looks through code diffs and looks for. implementation failures that have created type errors or formatting errors for anything sql related. the more of these gotchas we learn the patterns from the less likely we make them and the faster our agents get.

Create a evolve skill that review projects execution to find opportunities for evolving to a better set of agents.

I just realised for this to work every code change the implementar made would need to be commited and tracked so we colud look at what had to be changed after the one shot first pass on something.

this may be a useful purpose for using worktrunk as it means we can encapsulate the resulting messy volume of commits in a pr that we can then do a squash and merge on.

make me a plan to improve these functions
</original_prompt>
