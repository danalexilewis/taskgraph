---
name: Ecosystem Research Improvements
overview: Implement the top 5 actionable improvements from the ecosystem research report — two-stage review enforcement, brainstorming skill, context compaction, effort scaling, and cross-task note surfacing.
fileTree: |
  .cursor/skills/
  ├── work/SKILL.md                    (modify)
  └── brainstorm/SKILL.md             (create)
  .cursor/agents/
  └── implementer.md                   (modify)
  .cursor/rules/
  └── subagent-dispatch.mdc            (modify — minor)
  docs/leads/
  ├── README.md                        (modify)
  └── brainstorm.md                    (create)
  src/
  ├── cli/
  │   └── context.ts                   (modify)
  └── domain/
      └── token-estimate.ts            (modify)
risks:
  - description: Context compaction changes could break tg context --json output shape
    severity: medium
    mitigation: Add intent and related_task_notes as optional fields; existing consumers see no change unless they read new fields
  - description: Cross-task note query could be slow with many events
    severity: low
    mitigation: LIMIT 10 and filter by plan_id to bound the query
  - description: Brainstorming skill adds friction before planning
    severity: low
    mitigation: Skill is opt-in via /brainstorm trigger; plan skill does not require it
tests:
  - "tg context --json includes intent field for a task that has intent set (task: add-intent-to-context)"
  - "tg context --json includes related_task_notes for tasks in same plan with notes (task: cross-task-notes)"
  - "compactContext drops related_task_notes before dropping related_done lists (task: add-intent-to-context)"
todos:
  - id: enforce-two-stage-review
    content: "Enforce two-stage review in work skill and update lead registry"
    agent: implementer
    changeType: modify
    intent: |
      The two-stage review protocol (spec-reviewer then quality-reviewer) is already fully implemented in `.cursor/rules/subagent-dispatch.mdc` Pattern 1 step 6 and Pattern 2 step 4. But the work skill and lead registry still reference a generic "reviewer". Fix the inconsistency:

      1. **`.cursor/skills/work/SKILL.md`**: In the loop (step 8), replace the generic "if FAIL -> re-dispatch once with feedback" with explicit two-stage language:
         - After each implementer completes, run two-stage review per subagent-dispatch.mdc: dispatch spec-reviewer first; if PASS, dispatch quality-reviewer. Record verdicts via `tg note`. If either FAILs, re-dispatch implementer with that reviewer's feedback.
         - Update the Architecture table: change "reviewer (or spec-reviewer + quality-reviewer)" to "spec-reviewer + quality-reviewer (two-stage, sequential)".

      2. **`docs/leads/README.md`**: In the execution lead row, change agent files from "implementer.md, reviewer.md" to "implementer.md, spec-reviewer.md, quality-reviewer.md".

      Do NOT change subagent-dispatch.mdc — it already has the correct protocol.

  - id: effort-scaling
    content: "Add effort-scaling guidance to implementer prompt and dispatch rules"
    agent: implementer
    changeType: modify
    intent: |
      Add complexity-tier guidance so simple tasks don't get the same overhead as complex ones. Changes:

      1. **`.cursor/agents/implementer.md`**: After the "Step 2 — Load context" section, add a "Complexity tier" section:

         ```
         **Complexity tier** (from orchestrator):
         {{COMPLEXITY_TIER}}

         - **Simple** (low risk, estimate <30min, change_type: document/test/fix): Stay focused. Limit exploration to the files named in intent and suggested_changes. Aim for 3-10 tool calls.
         - **Standard** (default): Normal exploration budget. Read related files as needed.
         - **Complex** (high risk, estimate >60min, or multi-file create): Explore broadly. Read related done tasks, check for patterns in adjacent files, consider edge cases. Use explorer output if provided.
         ```

      2. **`.cursor/rules/subagent-dispatch.mdc`**: In the "Building prompts from context JSON" section, add:

         ```
         **Complexity tier**: Derive from task signals in `tg next --json`:
         - Simple: risk=low AND (estimate_mins <= 30 OR null) AND change_type in (document, test, fix)
         - Complex: risk=high OR estimate_mins > 60 OR change_type=create with multi-file scope
         - Standard: everything else
         Set `{{COMPLEXITY_TIER}}` in the implementer prompt accordingly.
         ```

  - id: brainstorm-skill
    content: "Create brainstorming/design-refinement skill"
    agent: implementer
    changeType: create
    intent: |
      Create `.cursor/skills/brainstorm/SKILL.md` — a new skill that runs before `/plan` to refine the problem before committing to a solution.

      **Frontmatter:**
      ```yaml
      name: brainstorm
      description: Collaborative design refinement before planning. Explores user intent through Socratic questioning, proposes 2-3 approaches with tradeoffs, and presents design in sections for approval. Use when the user says "brainstorm", "design", "explore options", or before complex plans where the problem space is unclear.
      ```

      **Skill structure** (follow the standard agentic lead anatomy from the standardize-skills plan):

      1. Title + type: "Utility skill (procedural, no sub-agents dispatched)."
      2. **When to use**: User says /brainstorm, "explore options", "what approach should we take", or when the orchestrator judges the request is ambiguous enough to benefit from design refinement before planning.
      3. **Workflow** (4 steps):
         - **Step 1: Understand context.** Read recent chat, check `tg status --tasks` for related work. Identify what the user wants to change and why.
         - **Step 2: Ask clarifying questions.** One question at a time. Prefer multiple-choice when possible. Focus on: purpose, constraints, success criteria, scope boundaries. Max 3-5 questions before proposing.
         - **Step 3: Propose 2-3 approaches.** For each: one-line summary, key tradeoff, your recommendation and why. Present as a table or numbered list. Ask which the user prefers (or if they want to combine elements).
         - **Step 4: Present design.** After the user picks an approach, present the design in sections (architecture, scope, what's in/out). Get approval on each section before moving on. When approved, hand off to `/plan` with the design as input.
      4. **Constraints**:
         - Read-only — no code changes, no tg start/done.
         - One question per message. Do not overwhelm.
         - YAGNI: actively remove unnecessary scope from proposals.
         - The terminal state is handing off to `/plan`. Do not invoke other skills.
      5. **Anti-patterns**: Jumping to planning without exploring alternatives. Asking 5 questions at once. Proposing only one approach.

      **Create `docs/leads/brainstorm.md`** with:
      - Purpose: Design-refinement lead. Socratic questioning before planning.
      - Skill: /brainstorm
      - Agent files: None (orchestrator runs directly)
      - Pattern: Understand → Ask → Propose → Present → Hand off to /plan

      **Update `docs/leads/README.md`**: Add brainstorm to the lead registry table.

  - id: add-intent-to-context
    content: "Add intent field and extend compaction in tg context"
    agent: implementer
    changeType: modify
    intent: |
      The `tg context` command is missing the `intent` field despite plan-authoring.mdc saying "intent stored on task, shown in tg context". Fix this and extend compaction.

      1. **`src/domain/token-estimate.ts`**:
         - Add `intent: string | null;` to `ContextOutput` interface (after `suggested_changes`).
         - Add `related_task_notes?: Array<{ task_id: string; title: string; msg: string; created_at: string }>;` to `ContextOutput` (optional field, for the cross-task-notes task to populate later).
         - Extend `compactContext` with new stages between current stage 1 and stage 3:
           - New stage: If over budget after stage 1, truncate `intent` to first 500 chars (append "...").
           - New stage: If still over budget, truncate `suggested_changes` to first 300 chars.
           - New stage: If still over budget, drop `related_task_notes` (set to []).
           - Then proceed to existing stage 2 (reduce related_done to 1) and stage 3 (drop related_done).

      2. **`src/cli/context.ts`**:
         - Add `intent` to the task SELECT columns: `"intent"` (the column exists in the task table as TEXT).
         - Add `intent: task.intent ?? null` to the `ContextOutput` data object (around line 119-133).
         - In the human-readable output section, add: `if (d.intent) { console.log("Intent:"); console.log(d.intent); }` after the agent line.

      Do NOT add the related_task_notes query — that's the next task. Just add the field to the type so it's ready.

  - id: cross-task-notes
    content: "Surface notes from related tasks in tg context"
    agent: implementer
    blockedBy: [add-intent-to-context]
    changeType: modify
    intent: |
      Add `related_task_notes` to `tg context` output — notes from sibling tasks in the same plan, so implementers see warnings and findings from prior work.

      1. **`src/cli/context.ts`**: After the existing related-done queries (around line 106-115), add a new query:

         ```sql
         SELECT e.task_id, t.title, e.body AS msg, e.created_at
         FROM event e
         JOIN task t ON e.task_id = t.task_id
         WHERE e.kind = 'note'
           AND t.plan_id = '<current_task_plan_id>'
           AND e.task_id != '<current_task_id>'
         ORDER BY e.created_at DESC
         LIMIT 10
         ```

         Use `sqlEscape` for the plan_id and task_id values. Use `q.raw<...>()` like the existing related-done queries.

      2. Parse `msg` safely: `event.body` can be string or object (see memory.md). If it's an object, JSON.stringify it. If it's a string, use it directly.

      3. Add the result to the `ContextOutput` data object as `related_task_notes`.

      4. In the human-readable output, add a section:
         ```
         if (d.related_task_notes && d.related_task_notes.length > 0) {
           console.log("Notes from related tasks:");
           d.related_task_notes.forEach(n => {
             console.log(`  [${n.title}] ${n.msg}`);
           });
         }
         ```

      5. In `compactContext` (token-estimate.ts), the field is already typed as optional. The new compaction stage (from add-intent-to-context task) drops it when over budget.

  - id: run-gate
    content: "Run gate and confirm changes pass"
    agent: implementer
    blockedBy:
      [
        enforce-two-stage-review,
        effort-scaling,
        brainstorm-skill,
        add-intent-to-context,
        cross-task-notes,
      ]
    changeType: test
    intent: |
      Run `pnpm gate` (or `bash scripts/cheap-gate.sh`) to validate lint, typecheck, and affected tests pass after all changes. Record outcome in evidence: "gate passed" or "gate failed: <summary>". If failed, add `tg note` with the failure reason.
isProject: false
---

## Analysis

This plan implements 5 of the 6 top recommendations from the ecosystem research report (`reports/ecosystem-research-2026-03-01.md`). Item 4 (systematic debugging skill) is excluded because the debug skill already exists and has its own plan (`26-03-01_sub_agent_profiles_systematic_debugging.md`).

The analyst found key existing infrastructure:

- **Two-stage review**: Already fully implemented in subagent-dispatch.mdc. Only the work skill and lead registry need alignment.
- **Context compaction**: `compactContext` exists in `token-estimate.ts` but only prunes related-done lists. The `intent` field is missing from context output despite being documented as present.
- **Cross-task notes**: Event table stores notes; context.ts doesn't query them. Clear path via `q.raw()`.

Architectural decisions:

- **Brainstorming is opt-in**, not mandatory before `/plan`. Adding mandatory friction would slow down well-understood requests. The skill exists for ambiguous or complex requests.
- **Effort scaling uses existing signals** (`risk`, `estimate_mins`, `change_type` from `tg next --json`). No new schema or CLI flags.
- **Cross-task notes are scoped to same plan** (not same files) to keep the query simple and bounded. Same-file matching would require parsing file_tree strings.
- **`intent` is added to context** as a prerequisite — it was missing despite documentation claiming it was present.

## Dependency graph

```
Parallel start (4 unblocked):
  ├── enforce-two-stage-review   (work skill + leads README)
  ├── effort-scaling             (implementer.md + subagent-dispatch.mdc)
  ├── brainstorm-skill           (new skill + lead doc + leads README)
  └── add-intent-to-context      (context.ts + token-estimate.ts)

After add-intent-to-context:
  └── cross-task-notes           (context.ts — adds note query)

After all above:
  └── run-gate                   (validate changes)
```

## Out of scope

- **Systematic debugging skill** — already exists; has its own plan.
- **MCP context compaction** — `src/mcp/tools.ts` also runs context but with no budget. Deferred to a follow-up.
- **LLM-based summarization** for compaction — simple truncation is sufficient for now.
- **Mandatory brainstorming** — opt-in only. Can revisit if plans consistently miss scope.

<original_prompt>
/plan (from ecosystem research report recommendations 1-6)
</original_prompt>
