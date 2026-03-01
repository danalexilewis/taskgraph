---
name: Standardize Skills as Agentic Leads
overview: Bring all Cursor skills to the agentic lead pattern with named leads, mermaid decision trees, permissions, sub-agent declarations, and standard anatomy. Consolidate duplicates.
fileTree: |
  .cursor/skills/
  ├── assess-risk/SKILL.md          (restructure)
  ├── review/SKILL.md               (restructure)
  ├── rescope/SKILL.md              (restructure)
  ├── pattern-tasks/SKILL.md        (restructure + merge meta)
  ├── review-tests/SKILL.md         (refine)
  ├── work/SKILL.md                 (refine)
  ├── investigate/SKILL.md          (refine)
  ├── plan/SKILL.md                 (refine)
  ├── create-hook/SKILL.md          (minor update)
  ├── risk/                         (delete)
  └── meta/                         (delete)
  docs/leads/
  ├── README.md                     (modify)
  ├── assess-risk.md                (create)
  ├── review.md                     (create)
  ├── rescope.md                    (create)
  └── pattern-tasks.md              (create)
  .cursor/rules/
  └── available-agents.mdc          (modify)
risks:
  - description: Restructured skills could break dispatch behavior if sections are renamed or removed
    severity: low
    mitigation: Each task preserves all existing workflow content; only adds structure and sections
  - description: Multiple tasks creating files in docs/leads/ could conflict if run truly parallel
    severity: low
    mitigation: Each restructure task creates exactly one lead doc; no file overlap between tasks
  - description: Mermaid graphs could become stale if workflow logic changes later
    severity: medium
    mitigation: Keep graphs to 5-15 nodes focused on main decision branches; note in leads README
tests:
  - "Validate each restructured SKILL.md contains all 9 anatomy sections (task: update-leads-registry)"
  - "Confirm risk/ and meta/ directories are deleted (task: cleanup-and-registries)"
  - "Confirm available-agents.mdc lists fixer, spec-reviewer, quality-reviewer (task: cleanup-and-registries)"
todos:
  - id: cleanup-and-registries
    content: "Delete risk/ and meta/ skill dirs; update available-agents.mdc and create-hook"
    agent: implementer
    changeType: modify
    intent: |
      Three small cleanups in one task:

      1. **Delete `.cursor/skills/risk/`** — duplicate of assess-risk. Remove the entire directory.
      2. **Delete `.cursor/skills/meta/`** — merged into pattern-tasks. Remove the entire directory.
      3. **Update `.cursor/rules/available-agents.mdc`** — add these three missing entries to the agent list:
         - `fixer`: Escalation agent; resolves tasks after implementer/reviewer failure using a stronger model. See `.cursor/agents/fixer.md`.
         - `spec-reviewer`: Spec compliance check sub-agent (PASS/FAIL). See `.cursor/agents/spec-reviewer.md`.
         - `quality-reviewer`: Code quality check sub-agent (PASS/FAIL). See `.cursor/agents/quality-reviewer.md`.
      4. **Update `.cursor/skills/create-hook/SKILL.md`** — add a line after the title: `**Type:** Utility skill (procedural, no agentic lead or sub-agents).` Add a brief "## When to use" section if not present.

  - id: restructure-assess-risk
    content: "Restructure assess-risk SKILL.md to standard agentic lead anatomy"
    agent: implementer
    changeType: modify
    intent: |
      Rewrite `.cursor/skills/assess-risk/SKILL.md` to the standard anatomy. Preserve all existing workflow content (the 5-step process, risk metrics table, output template) but wrap in the standard structure.

      **Create `docs/leads/assess-risk.md`** with:
      - Purpose: Read-only risk assessment lead. Orchestrator gathers cross-plan data, reads plan files, rates 8 risk metrics, and produces a risk report.
      - Skill: `/assess-risk` (`.cursor/skills/assess-risk/SKILL.md`)
      - Agent files: None (orchestrator performs analysis directly)
      - Pattern: 1. Gather scope data 2. Read plan files 3. Rate metrics 4. Cross-plan interactions 5. Produce report
      - Input: Plan scope (single or multi-plan), optional crossplan summary
      - Output: Risk Assessment Report (markdown)

      **Standard anatomy for SKILL.md** (preserve existing content within this structure):

      1. Frontmatter (name, description) — keep existing
      2. `# Assess Risk` title
      3. `**Lead documentation:** See [docs/leads/assess-risk.md](docs/leads/assess-risk.md).`
      4. `## When to use` — keep existing triggers
      5. `## Architecture` — add:
         ```
         - **You (orchestrator / assess-risk lead)**: Gathers data, rates metrics, produces report.
         - **Sub-agents**: None. This lead runs the full workflow directly.
         ```
      6. `## Permissions` — add:
         ```
         - **Lead**: read-only
         - **Rule**: No file edits, no database writes, no destructive commands.
         ```
      7. `## Decision tree` — add this mermaid:
         ```mermaid
         flowchart TD
             A[User: assess risk] --> B{crossplan CLI available?}
             B -->|Yes| C[Run tg crossplan summary --json]
             B -->|No| D[Gather from tg status + plan files]
             C --> E[Read plan files for fileTree and risks]
             D --> E
             E --> F[Rate 8 risk metrics per plan]
             F --> G{Multiple plans?}
             G -->|Yes| H[Assess cross-plan interactions]
             G -->|No| I[Skip cross-plan]
             H --> J[Produce Risk Assessment Report]
             I --> J
         ```
      8. `## Workflow` — keep existing 5 steps
      9. `## Risk metrics` — keep existing table
      10. `## Output template` — keep existing
      11. `## Reference` — keep existing, add link to lead doc

  - id: restructure-review
    content: "Restructure review SKILL.md to standard agentic lead anatomy"
    agent: implementer
    changeType: modify
    intent: |
      Rewrite `.cursor/skills/review/SKILL.md` to the standard anatomy. Preserve all existing workflow content.

      **Create `docs/leads/review.md`** with:
      - Purpose: Read-only review lead for code health, system health, and optional risk assessment.
      - Skill: `/review` (`.cursor/skills/review/SKILL.md`)
      - Agent files (workers): investigator.md (code health, system health), optionally assess-risk skill or generalPurpose (risk)
      - Pattern: 1. Gather baseline (tg status) 2. Dispatch sub-agents parallel 3. Synthesize report 4. Deliver
      - Input: User request; scope (general vs feature/proposal)
      - Output: Review Report (markdown)
      - When: User says "review", "health check", "code health", "system health"

      **Standard anatomy for SKILL.md**:

      1. Frontmatter — keep existing
      2. Title + `**Lead documentation:** See [docs/leads/review.md](docs/leads/review.md).`
      3. `## When to use` — keep existing
      4. `## Scope` — keep existing scope table
      5. `## Architecture` — add:
         ```
         - **You (orchestrator / review lead)**: Gathers baseline, dispatches sub-agents, synthesizes report.
         - **Sub-agents**:
           | Agent | Purpose | Permission |
           |-------|---------|------------|
           | investigator | Code health analysis | read-only |
           | investigator | System health analysis | read-only |
           | generalPurpose (or assess-risk skill) | Risk assessment (when feature/proposal in scope) | read-only |
         ```
      6. `## Permissions` — add:
         ```
         - **Lead**: read-only
         - **Propagation**: All sub-agents MUST use readonly=true.
         - **Rule**: No file edits, no `tg start`/`tg done`, no DB writes.
         ```
      7. `## Decision tree` — add:
         ```mermaid
         flowchart TD
             A[User: review / health check] --> B{New feature or proposal?}
             B -->|No| C[Scope: code + system health]
             B -->|Yes| D[Scope: code + system + risk]
             C --> E[Dispatch investigator: code health]
             C --> F[Dispatch investigator: system health]
             D --> E
             D --> F
             D --> G[Run assess-risk or dispatch generalPurpose]
             E --> H[Synthesize report]
             F --> H
             G --> H
             H --> I[Deliver: chat + optional reports/]
         ```
      8. `## Workflow` — keep existing steps 1-4
      9. `## Sub-agent constraints` — keep existing
      10. `## Reference` — keep existing, add lead doc link

  - id: restructure-rescope
    content: "Restructure rescope SKILL.md to standard agentic lead anatomy"
    agent: implementer
    changeType: modify
    intent: |
      Rewrite `.cursor/skills/rescope/SKILL.md` to the standard anatomy. Preserve all existing workflow content.

      **Create `docs/leads/rescope.md`** with:
      - Purpose: Product-manager lead that clarifies desired functionality when shipped behavior does not match intent. Read-only; does not write code.
      - Skill: `/rescope` (`.cursor/skills/rescope/SKILL.md`)
      - Agent files: explorer.md, planner-analyst.md, spec-reviewer.md, quality-reviewer.md (all optional)
      - Pattern: 1. Capture directive 2. Decide assessment 3. Run sub-agents 4. Produce rescope document
      - Input: User directive describing desired behavior
      - Output: Rescope document (current state, gaps, recommended next steps)
      - When: User says "rescope", "clarify scope", "this isn't quite right"

      **Standard anatomy for SKILL.md**:

      1. Frontmatter — keep existing
      2. Title + `**Lead documentation:** See [docs/leads/rescope.md](docs/leads/rescope.md).`
      3. `## When to use` — keep existing (rename "When to run" to "When to use")
      4. `## Architecture` — add:
         ```
         - **You (orchestrator / rescope lead)**: Acts as product manager. Captures directive, decides assessment needs, synthesizes findings.
         - **Sub-agents** (all optional, dispatched based on need):
           | Agent | Purpose | Permission | When |
           |-------|---------|------------|------|
           | explorer | Map current implementation and behavior | read-only | Need to see what exists |
           | spec-reviewer | Check if implementation matches intent | read-only | Have task + diff |
           | quality-reviewer | Check implementation quality | read-only | Spec is fine; need quality check |
           | planner-analyst | Broader codebase context for plan | read-only | Directive implies multi-task plan |
         ```
      5. `## Permissions` — add:
         ```
         - **Lead**: read-only (clarifies functionality; does not write code or run tg start/done)
         - **Propagation**: All sub-agents read-only. No implementer in this skill.
         - **Constraint**: Stay in PM role. Do not write code.
         ```
      6. `## Decision tree` — add:
         ```mermaid
         flowchart TD
             A[User: rescope directive] --> B[Step 1: Capture directive]
             B --> C{Step 2: What assessment needed?}
             C -->|Current behavior| D[Dispatch explorer]
             C -->|Spec compliance| E[Dispatch spec-reviewer]
             C -->|Quality check| F[Dispatch quality-reviewer]
             C -->|Broader context| G[Dispatch planner-analyst]
             C -->|None needed| H[Directive sufficient]
             D --> I[Synthesize: current vs gaps]
             E --> I
             F --> I
             G --> I
             H --> I
             I --> J[Produce rescope document]
             J --> K[Present options to user]
         ```
      7. `## Workflow` — keep existing Steps 1-4 (rename from "Step" to consistency)
      8. `## Output format` — move existing markdown template here
      9. `## Rules` — keep existing
      10. `## Reference` — add: explorer.md, planner-analyst.md, spec-reviewer.md, quality-reviewer.md, lead doc

  - id: restructure-pattern-tasks
    content: "Restructure pattern-tasks SKILL.md with merged meta content and standard anatomy"
    agent: implementer
    changeType: modify
    intent: |
      Rewrite `.cursor/skills/pattern-tasks/SKILL.md` to the standard anatomy. Merge content from the now-deleted meta skill. Preserve all existing workflow content.

      **Merge from meta**: The deleted meta skill described cross-project edge enrichment. Pattern-tasks currently says "cross-plan". Merge by adding scope:
      - Cross-plan (default): analyze tasks across plans in the current project
      - Cross-project (extended): when multiple projects are loaded, analyze across projects
      Add a scope table similar to review-tests.

      **Create `docs/leads/pattern-tasks.md`** with:
      - Purpose: Enrichment lead that analyzes cross-plan (and optionally cross-project) task relationships. Proposes edges and notes; writes only after user approval.
      - Skill: `/pattern-tasks` (`.cursor/skills/pattern-tasks/SKILL.md`)
      - Agent files: None (orchestrator does analysis directly; uses crossplan CLI or manual analysis)
      - Pattern: 1. Gather cross-plan data 2. Analyze and categorize 3. Present proposals 4. Write on approval
      - Input: Cross-plan summary or manual analysis
      - Output: Proposed edges and notes; written to task graph on approval
      - When: User says "find patterns", "enrich tasks", cross-plan analysis

      **Standard anatomy for SKILL.md**:

      1. Frontmatter — update description to mention cross-project scope
      2. Title + `**Lead documentation:** See [docs/leads/pattern-tasks.md](docs/leads/pattern-tasks.md).`
      3. `## When to use` — keep existing + add cross-project trigger
      4. `## Scope` — add:
         ```
         | User intent | Scope |
         |-------------|-------|
         | "find patterns" / "enrich tasks" | Cross-plan (current project) |
         | "cross-project patterns" | Cross-project (multiple projects) |
         | After assess-risk | Cross-plan with risk context |
         ```
      5. `## Architecture` — add:
         ```
         - **You (orchestrator / pattern-tasks lead)**: Gathers data, analyzes patterns, presents proposals.
         - **Sub-agents**: None. This lead runs analysis directly using crossplan CLI or manual plan reading.
         ```
      6. `## Permissions` — add:
         ```
         - **Lead**: read until approval; write (edges + notes) only after explicit user approval
         - **Rule**: NEVER write edges or notes without user approval. Present proposals first.
         ```
      7. `## Decision tree` — add:
         ```mermaid
         flowchart TD
             A[User: find patterns / enrich tasks] --> B{Scope?}
             B -->|Cross-plan| C[tg crossplan summary --json]
             B -->|Cross-project| D[Manual analysis from plans and tasks]
             B -->|Fallback no CLI| D
             C --> E[Analyze: file conflicts, domain clusters, ordering]
             D --> E
             E --> F[Categorize patterns]
             F --> G[Present proposals to user]
             G --> H{User approves?}
             H -->|Yes| I[Write edges + notes to task graph]
             H -->|No| J[Do nothing]
         ```
      8. `## Workflow` — keep existing 4 steps, add cross-project variant in step 1
      9. `## Important` — keep existing approval gate rule
      10. `## Reference` — add lead doc link, crossplan CLI, meta skill reference

  - id: refine-review-tests
    content: "Add permissions section and mermaid decision tree to review-tests SKILL.md"
    agent: implementer
    changeType: modify
    intent: |
      The review-tests skill is already near-exemplar quality. Add the two missing sections without restructuring the rest.

      **Add `## Permissions` section** after the Architecture section:
      ```
      ## Permissions

      - **Lead**: read-write (writes report to reports/ and plan to plans/)
      - **Propagation**: Phase 1 scanners MUST use readonly=true. Implementer tasks (from plan) are read-write.
      - **Sub-agents**:
        | Agent | Permission | Phase |
        |-------|------------|-------|
        | test-coverage-scanner | read-only | 1 (scanning) |
        | test-quality-auditor | read-only | 1 (scanning) |
        | test-infra-mapper | read-only | 1 (scanning) |
        | implementer | read-write | Plan execution (after import) |
      ```

      **Add `## Decision tree` section** after Permissions:
      ```mermaid
      flowchart TD
          A[User: review tests] --> B{Scope?}
          B -->|Full| C[Dispatch 3 scanners parallel]
          B -->|Coverage only| D[Dispatch coverage-scanner]
          B -->|Quality only| E[Dispatch quality-auditor]
          B -->|Infra only| F[Dispatch infra-mapper]
          B -->|Path-scoped| G[3 scanners with TARGET_PATH]
          C --> H[Synthesize: corroborate + rank P0-P3]
          D --> H
          E --> H
          F --> H
          G --> H
          H --> I[Write report to reports/]
          I --> J[Create plan with agent-per-task]
          J --> K[Present report + import command]
      ```

  - id: refine-work
    content: "Add architecture table, permissions section, and mermaid to work SKILL.md"
    agent: implementer
    changeType: modify
    intent: |
      The work skill is already exemplar quality. Add three missing sections without restructuring.

      **Add `## Architecture` section** after the lead doc link (before "Task orchestration UI"):
      ```
      ## Architecture

      - **You (orchestrator / execution lead)**: Coordinates the execution loop. Dispatches implementers, reviews results, escalates failures.
      - **Sub-agents**:
        | Agent | Purpose | Permission |
        |-------|---------|------------|
        | implementer | Execute task (code, tests, docs) | read-write |
        | reviewer (or spec-reviewer + quality-reviewer) | Evaluate implementation | read-only |
        | fixer | Escalation after 2 implementer failures | read-write |
      ```

      **Add `## Permissions` section** after Architecture:
      ```
      ## Permissions

      - **Lead**: read-write (orchestrates task execution, writes to task graph)
      - **Propagation**: Mixed. Implementer and fixer are read-write. Reviewers are read-only.
      - **Sub-agents**:
        | Agent | Permission |
        |-------|------------|
        | implementer | read-write |
        | reviewer / spec-reviewer / quality-reviewer | read-only |
        | fixer | read-write |
      ```

      **Add `## Decision tree` section** after Permissions:
      ```mermaid
      flowchart TD
          A[Start: check for plan to import] --> B{Import needed?}
          B -->|Yes| C[tg import plan]
          B -->|No| D[tg next --json]
          C --> D
          D --> E{Tasks empty?}
          E -->|Yes| F[Plan complete - report summary]
          E -->|No| G[File conflict check - build batch]
          G --> H[TodoWrite + dispatch N implementers]
          H --> I[Wait for batch]
          I --> J{Each task outcome}
          J -->|SUCCESS| K[Check notes and evidence]
          J -->|FAIL 1| L[Re-dispatch with feedback]
          J -->|FAIL 2| M{Escalation ladder}
          M -->|Fixer| N[Dispatch fixer agent]
          M -->|Direct| O[Orchestrator does task]
          M -->|Human| P[Stop + present options]
          K --> D
          L --> I
          N --> I
          O --> D
      ```

  - id: refine-investigate
    content: "Add architecture table, permissions section, and mermaid to investigate SKILL.md"
    agent: implementer
    changeType: modify
    intent: |
      The investigate skill is good quality. Add three missing sections.

      **Add `## Architecture` section** after the lead doc link (before "When to run"):
      ```
      ## Architecture

      - **You (orchestrator / investigator lead)**: Reads chat context, scans docs, drafts investigation plan, dispatches investigator, synthesizes findings.
      - **Sub-agents**:
        | Agent | Purpose | Permission |
        |-------|---------|------------|
        | investigator | Tactical investigation (files, function chains, schemas, APIs) | read-only |

      **Constraint**: Only the investigator sub-agent is used. No other sub-agents in this skill.
      ```

      **Add `## Permissions` section** after Architecture:
      ```
      ## Permissions

      - **Lead**: read-only
      - **Propagation**: All sub-agents MUST use readonly=true.
      - **Rule**: No file edits, no destructive commands. Investigator gathers evidence only.
      ```

      **Add `## Decision tree` section** after Permissions:
      ```mermaid
      flowchart TD
          A[User: /investigate] --> B[Step 1: Read end-of-chat context]
          B --> C[Step 2: Quick docs/ scan]
          C --> D[Step 3: Draft investigation areas + hypotheses]
          D --> E[Build tactical directives]
          E --> F[Step 4: Dispatch investigator sub-agent]
          F --> G[Receive structured findings]
          G --> H[Step 5: Synthesize + finalize plan and tasks]
          H --> I[Present investigation plan to user]
      ```

      Also rename "When to run" to "## When to use" for consistency.

  - id: refine-plan
    content: "Add architecture table, permissions section, and mermaid to plan SKILL.md"
    agent: implementer
    changeType: modify
    intent: |
      The plan skill is good quality. Add three missing sections.

      **Add `## Architecture` section** after the lead doc link (before Phase 1):
      ```
      ## Architecture

      - **You (orchestrator / planner lead)**: Dispatches analyst, applies critique checklist, writes the plan, presents for review.
      - **Sub-agents**:
        | Agent | Purpose | Permission |
        |-------|---------|------------|
        | planner-analyst | Gathers codebase context and rough task breakdown | read-only |

      The analyst gathers facts; the orchestrator owns architecture, dependencies, and task design.
      ```

      **Add `## Permissions` section** after Architecture:
      ```
      ## Permissions

      - **Lead**: read-write (writes plan file to plans/)
      - **Propagation**: Planner-analyst MUST use readonly=true (model="fast", subagent_type="explore").
      - **Rule**: Analyst does not write files. Only the orchestrator writes the plan.
      ```

      **Add `## Decision tree` section** after Permissions:
      ```mermaid
      flowchart TD
          A[User: plan / create plan] --> B[Phase 1: Dispatch planner-analyst]
          B --> C[Analyst returns structured analysis]
          C --> D[Phase 2: Apply critique checklist]
          D --> E[Write plan to plans/*.md]
          E --> F[Phase 3: Summarize and present]
          F --> G{User response}
          G -->|proceed / execute| H[Import + execute]
          G -->|add tasks only| I[Import only]
          G -->|thanks / ok| J[Do nothing]
      ```

      Also add a `## When to use` section if not explicit (currently implicit from the frontmatter description).

  - id: update-leads-registry
    content: "Update docs/leads/README.md with all new leads and standard anatomy note"
    agent: implementer
    blockedBy:
      [
        restructure-assess-risk,
        restructure-review,
        restructure-rescope,
        restructure-pattern-tasks,
      ]
    changeType: modify
    intent: |
      Update `docs/leads/README.md` to register the 4 new leads created by restructure tasks.

      **Add to the lead registry table** (after the existing 4 rows):

      | Lead | Skill | Agent file(s) | Purpose |
      |------|-------|----------------|---------|
      | review | /review | investigator.md | Read-only code health, system health, and optional risk assessment. |
      | rescope | /rescope | explorer.md, spec-reviewer.md, quality-reviewer.md, planner-analyst.md | PM-role lead that clarifies desired functionality vs shipped behavior. |
      | assess-risk | /assess-risk | (none; orchestrator direct) | Read-only risk assessment using 8-metric model across plans. |
      | pattern-tasks | /pattern-tasks | (none; orchestrator direct) | Cross-plan and cross-project edge enrichment; writes only after user approval. |

      **Add a note about standard SKILL.md anatomy** at the bottom of the file (or in a new section):

      ```markdown
      ## Standard skill anatomy

      Every agentic skill should follow this section order:

      1. Frontmatter (name, description)
      2. Lead documentation link
      3. When to use (triggers)
      4. Architecture (lead + sub-agents table)
      5. Permissions (lead + propagation rule + sub-agent table)
      6. Decision tree (mermaid flowchart)
      7. Workflow (numbered phases)
      8. Output format / template
      9. Reference (links to agent files, lead doc, rules)

      Utility skills (e.g. create-hook) may omit Architecture, Permissions, and Decision tree.
      ```

      **Validate**: Check that each of the 8 agentic skills (assess-risk, review, review-tests, work, rescope, investigate, plan, pattern-tasks) now has the standard anatomy by scanning section headers. Report any missing sections as a tg note.
isProject: false
---

## Analysis

This plan brings all 9 remaining skills (after deleting 2 duplicates) to the "agentic lead" pattern. The two exemplar skills (review-tests, work) need only refinement (3 missing sections each). The good skills (investigate, plan) also need refinement. The needs-work skills (assess-risk, review, rescope, pattern-tasks) need full restructuring plus new lead docs.

The `/create-hook` skill is explicitly labeled as a utility — not every skill needs to be an agentic lead.

Key architectural decisions:

- **assess-risk and pattern-tasks have no sub-agents** — they run the orchestrator directly. This is documented explicitly rather than forced into a sub-agent pattern.
- **Permission propagation is a standard section** — every agentic skill declares lead permission + propagation rule + sub-agent table.
- **Mermaid graphs target 5-15 nodes** — enough to show the decision structure without becoming a maintenance burden.

## Dependency graph

```
Parallel start (9 unblocked):
  ├── cleanup-and-registries (delete risk/, meta/; update agents registry; label create-hook)
  ├── restructure-assess-risk (lead doc + SKILL.md)
  ├── restructure-review (lead doc + SKILL.md)
  ├── restructure-rescope (lead doc + SKILL.md)
  ├── restructure-pattern-tasks (merge meta + lead doc + SKILL.md)
  ├── refine-review-tests (add 2 sections)
  ├── refine-work (add 3 sections)
  ├── refine-investigate (add 3 sections)
  └── refine-plan (add 3 sections)

After restructure-assess-risk, restructure-review, restructure-rescope, restructure-pattern-tasks:
  └── update-leads-registry (update docs/leads/README.md)
```

## Mermaid — Plan execution flow

```mermaid
flowchart LR
    A[cleanup-and-registries] --> Z[update-leads-registry]
    B[restructure-assess-risk] --> Z
    C[restructure-review] --> Z
    D[restructure-rescope] --> Z
    E[restructure-pattern-tasks] --> Z
    F[refine-review-tests] --> Z
    G[refine-work] --> Z
    H[refine-investigate] --> Z
    I[refine-plan] --> Z
```

<original_prompt>
/plan for all improvements.

also consolidate these into the short versions /risk and /meta

/risk and /assess-risk — Nearly identical content. Keep assess-risk (better name, matches skill trigger), delete risk.
/meta and /pattern-tasks — Nearly identical. Keep pattern-tasks (more descriptive), update meta to be an alias or merge cross-project behavior into pattern-tasks as a scope option.
</original_prompt>
