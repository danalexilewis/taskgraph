---
name: Docs Formalization - DDD Domain Docs as Knowledge Base
overview: Promote all transient memory entries to formal domain docs, restructure docs/ as the DDD knowledge base with design decisions and project links, and remove template stubs.
fileTree: |
  docs/
  ├── README.md                    (modify)
  ├── domains.md                   (modify)
  ├── schema.md                    (modify)
  ├── testing.md                   (modify)
  ├── plan-import.md               (modify)
  ├── cli-reference.md             (modify)
  ├── infra.md                     (modify)
  ├── multi-agent.md               (modify)
  ├── backend.md                   (delete — template stub, not a real domain)
  ├── frontend.md                  (delete — template stub, not a real domain)
  .cursor/
  ├── memory.md                    (modify — empty after promotion)
  ├── rules/memory.mdc             (modify — update routing table)
  ├── rules/docs-sync.mdc          (modify — add DDD convention)
risks:
  - description: Removing backend.md/frontend.md could break domain slug references in existing tasks
    severity: low
    mitigation: Check task_doc table for any tasks referencing these slugs before deleting
  - description: Moving too much to docs could make memory useless
    severity: low
    mitigation: Memory stays for genuinely transient items (env quirks discovered mid-session); docs get durable knowledge
tests:
  - "All memory entries have been promoted to the correct domain doc"
  - "domains.md index is complete and accurate"
  - "No broken cross-references between docs"
  - "Template stubs removed (or repurposed if tasks reference them)"
todos:
  - id: promote-schema-entries
    content: "Promote Dolt/schema memory entries to docs/schema.md"
    agent: implementer
    intent: |
      Move these memory entries into docs/schema.md under a new "Decisions / gotchas" section at the bottom:
      1. "Dolt JSON columns" — event.body may be object or string; handle both
      2. "DAL writable" — all Dolt invocations use --data-dir and DOLT_READ_ONLY=false
      3. "Plan → project table" — after migration, app code uses project table; plan is a view

      Also add a "Related projects" section at the very bottom linking to the relevant done projects
      in the task graph (use project titles, not IDs). Relevant: "Task Graph Implementation",
      "Thin SQL Query Builder", "Restructure package".

      Do NOT rewrite existing content. Append new sections.
    changeType: modify

  - id: promote-testing-entries
    content: "Promote testing memory entries to docs/testing.md"
    agent: implementer
    intent: |
      Move these memory entries into docs/testing.md under the appropriate existing sections
      (or a new "Environment / gotchas" section):
      1. ".env.local for integration tests" — DOLT_ROOT_PATH and TG_GOLDEN_TEMPLATE must be empty;
         Bun auto-loads .env.local

      Also add a "Related projects" section at the bottom linking to done projects:
      "Fix Failing Unit Tests", "Fix Failing Tests Properly", "Integration Test Performance and
      Harness Improvements", "Concurrent Tests Maximize", "Migrate to Bun Test".

      Do NOT rewrite existing content. Append or insert into existing sections.
    changeType: modify

  - id: promote-plan-import-entries
    content: "Promote plan-import memory entries to docs/plan-import.md"
    agent: implementer
    intent: |
      Move these memory entries into docs/plan-import.md under a "Gotchas" or "Implementation notes"
      section:
      1. Task title is VARCHAR(255) — keep plan todo titles under 255 chars
      2. Task external_key is plan-scoped — import appends 6-char hex hash of plan_id;
         re-import upserts by stable key; export strips the suffix
      3. After plan→project rename, plan is a view — use table "project" for writes

      Also add a "Related projects" section: "Import pre-flight and duplicate prevention",
      "Plan Import Robustness for Simple Models", "Cursor Plan Import and Agent Workflow".

      Do NOT rewrite existing content.
    changeType: modify

  - id: promote-cli-entries
    content: "Promote CLI memory entries to docs/cli-reference.md"
    agent: implementer
    intent: |
      Move these memory entries into docs/cli-reference.md under appropriate command sections
      or a new "Implementation notes" section:
      1. "tg context" — reads doc/skill from task_doc and task_skill junction tables;
         older repos may have task_domain or task.domain/task.skill columns
      2. "CLI scaffolding (tg setup)" — Commander --no-<flag> defaults to true;
         .cursor is opt-in (use --cursor); resolves templates from path.join(__dirname, '..', 'template')
      3. "Worktrunk remove" — run wt remove with no branch arg and cwd = worktree path;
         pass worktreePathOverride from done into removeWorktree()

      Place each near the relevant command's documentation section.
    changeType: modify

  - id: promote-infra-entries
    content: "Rewrite docs/infra.md from template stub to real domain doc"
    agent: implementer
    intent: |
      docs/infra.md is currently a template stub with placeholder content. Rewrite it as a real
      domain doc for this project's infrastructure:

      Sections:
      - Purpose: Build tooling, CI validation, package publishing, Dolt database management
      - Build system: TypeScript compiled with tsc; src/template copied to dist/template;
        pnpm as package manager; CJS output (note: createRequire(import.meta.url) doesn't work
        in CJS — use hardcoded version string)
      - Validation pipeline: pnpm gate (lint + typecheck changed files + affected tests);
        pnpm gate:full (full scope); scripts/cheap-gate.sh
      - Dolt: brew install dolt; .taskgraph/dolt/ repo; auto-migrate on every CLI command
      - Publishing: npm package @danalexilewis/taskgraph
      - Decisions / gotchas: the CLI version/build memory entry goes here

      Add "Related projects" section: "Restructure package", "Publish TaskGraph to npm",
      "Migrate to Bun Test, Add Biome".

      Add YAML frontmatter triggers matching the existing pattern in other docs.
    changeType: modify

  - id: remove-template-stubs
    content: "Remove template stub docs that are not real domains for this project"
    agent: implementer
    blockedBy:
      [
        promote-schema-entries,
        promote-testing-entries,
        promote-plan-import-entries,
        promote-cli-entries,
        promote-infra-entries,
      ]
    intent: |
      Check the task_doc table for any tasks referencing "backend" or "frontend" domain slugs:
      ```sql
      SELECT * FROM task_doc WHERE doc IN ('backend', 'frontend')
      ```
      If no tasks reference them, delete docs/backend.md and docs/frontend.md — they are
      template stubs with placeholder content, not real domains for this project.

      If tasks DO reference them, leave the files but add a note at the top:
      "This is a template stub. No project-specific content has been added."
    changeType: modify

  - id: update-domains-index
    content: "Update docs/domains.md to reflect the full domain doc inventory"
    agent: implementer
    blockedBy: [remove-template-stubs, promote-infra-entries]
    intent: |
      Rewrite docs/domains.md to be the complete index of all domain docs. The current version
      only lists 8 domains. The full set should include every .md file in docs/ that serves as
      a domain guide (has triggers frontmatter or is referenced by tasks).

      Add these missing entries to the table:
      - cli-tables → docs/cli-tables.md — CLI table rendering, boxen layout, column config
      - multi-agent → docs/multi-agent.md — Multi-agent coordination, worktrees, notes
      - mcp → docs/mcp.md — MCP server tools and configuration
      - agent-strategy → docs/agent-strategy.md — Agent patterns, communication model
      - infra → docs/infra.md — Build, validation, publishing, Dolt management

      Remove backend and frontend if they were deleted in the previous task.

      Also add a brief explanation of the DDD approach: docs/ is the domain knowledge base;
      each doc covers a bounded context with design decisions, gotchas, and links to related
      projects in the task graph.
    changeType: modify

  - id: update-docs-readme
    content: "Update docs/README.md with the DDD framing and complete doc list"
    agent: implementer
    blockedBy: [update-domains-index]
    intent: |
      Update docs/README.md to:
      1. Add a section explaining the docs-as-domain-knowledge-base approach:
         "docs/ follows a DDD-inspired structure. Each doc covers a bounded context —
         the subsystem it owns, key design decisions, implementation gotchas, and links
         to related projects in the task graph."
      2. Ensure the doc list is complete (add any missing docs like cli-tables.md,
         glossary.md, multi-agent.md, agent-strategy.md, mcp.md)
      3. Group docs by category: Core (architecture, schema, glossary),
         CLI (cli, cli-reference, cli-tables), Agent (agent-contract, agent-strategy,
         multi-agent), Development (testing, error-handling, infra, recommended-packages),
         Planning (plan-format, plan-import)

      Do NOT rewrite the Quick Start section — it's fine as-is.
    changeType: modify

  - id: empty-memory
    content: "Clear memory.md — all entries have been promoted to formal docs"
    agent: implementer
    blockedBy:
      [
        promote-schema-entries,
        promote-testing-entries,
        promote-plan-import-entries,
        promote-cli-entries,
        promote-infra-entries,
      ]
    intent: |
      Replace .cursor/memory.md contents with:
      ```
      # Persistent Memory

      Transient dev context. Durable knowledge belongs in docs/.
      See .cursor/rules/memory.mdc for the learnings routing system.
      ```

      All entries have been promoted to formal domain docs. Memory is now empty and ready
      for the learnings hook to populate with genuinely transient discoveries.
    changeType: modify

  - id: update-memory-routing
    content: "Update memory.mdc routing table with complete domain doc list"
    agent: implementer
    blockedBy: [update-domains-index]
    intent: |
      Update the "Formal docs routing guide" table in .cursor/rules/memory.mdc to include
      ALL domain docs (not just the subset currently listed). Add:
      - Plan import → docs/plan-import.md
      - Multi-agent coordination → docs/multi-agent.md
      - MCP server → docs/mcp.md
      - Agent strategy → docs/agent-strategy.md
      - Glossary / naming → docs/glossary.md
      - Recommended packages → docs/recommended-packages.md

      Also update the docs-sync.mdc trigger list if any new triggers are needed.
    changeType: modify
isProject: false
---

## Analysis

### Current state

Memory (`.cursor/memory.md`) contains 10 entries, all of which are durable knowledge that belongs in formal domain docs. The learnings hook + routing system is in place but the routing table in `memory.mdc` is incomplete — it only lists 9 destination docs when there are 15+ docs in the `docs/` folder.

The `docs/` folder has a mix of:

- **Real domain docs** with triggers frontmatter and project-specific content (schema, testing, architecture, cli-reference, plan-import, etc.)
- **Template stubs** with placeholder content (backend.md, frontend.md) — these came from `tg setup` scaffolding and were never filled in because this project doesn't have separate backend/frontend domains
- **Missing from the index** — several docs (cli-tables, multi-agent, mcp, agent-strategy, glossary) exist but aren't listed in domains.md

### DDD approach

Following DDD conventions, `docs/` serves as the domain knowledge base. Each doc is a bounded context covering:

1. What the subsystem owns and doesn't own
2. Key entrypoints and data model
3. Design decisions and gotchas (the "why" behind non-obvious choices)
4. Related projects in the task graph (linking execution history to domain knowledge)

The "Related projects" section at the bottom of each doc creates a bidirectional link between domain knowledge and execution history — you can go from a doc to see what projects changed it, and from a project to see which domain it touched.

### What moves where

| Memory entry                                     | Destination doc         | Section             |
| ------------------------------------------------ | ----------------------- | ------------------- |
| Plan import (title, external_key, project table) | `docs/plan-import.md`   | Gotchas             |
| tg context (junction tables)                     | `docs/cli-reference.md` | context command     |
| CLI version/build (CJS import.meta)              | `docs/infra.md`         | Build system        |
| CLI scaffolding (tg setup)                       | `docs/cli-reference.md` | setup command       |
| Dolt JSON columns                                | `docs/schema.md`        | Decisions / gotchas |
| DAL writable                                     | `docs/schema.md`        | Decisions / gotchas |
| Plan → project table                             | `docs/schema.md`        | Decisions / gotchas |
| .env.local for tests                             | `docs/testing.md`       | Environment         |
| Worktrunk remove                                 | `docs/cli-reference.md` | worktree command    |

## Dependency graph

```
Parallel start (5 unblocked):
  ├── promote-schema-entries
  ├── promote-testing-entries
  ├── promote-plan-import-entries
  ├── promote-cli-entries
  └── promote-infra-entries

After all 5 promotions:
  ├── remove-template-stubs
  └── empty-memory

After remove-template-stubs + promote-infra-entries:
  └── update-domains-index

After update-domains-index:
  ├── update-docs-readme
  └── update-memory-routing
```

## Out of scope

- Rewriting existing doc content (only appending/inserting new sections)
- Creating new domain docs beyond what's listed (cli-tables already exists)
- Updating the template docs in `src/template/docs/` (those are for consuming projects, not this project)
- Changing the learnings hook or memory rule beyond updating the routing table

<original_prompt>
is there anything else in the memory table that should be cleaned up and moved into more formalised docs. eg domain docs. Loosely I tend to follow DDD. so our docs would be where Domains highest level docs are recorded. Where design decisions and links to associated /plans and projects (in tg) are also recorded at the bottom.
</original_prompt>
