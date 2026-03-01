---
name: README Upgrade - Comprehensive Project Documentation
overview: Transform the sparse 69-line README into a rich, visually engaging project document that serves as both quick-start guide and feature showcase, inspired by the oh-my-cursor README structure.
fileTree: |
  README.md                          (modify - major rewrite)
  src/cli/index.ts                   (modify - fix version to 2.0.0)
risks:
  - description: README drifts from actual features as code evolves
    severity: medium
    mitigation: Keep README as summary with links to docs/; docs-sync.mdc already tracks when to update docs
  - description: README becomes too long and loses quick-scan value
    severity: medium
    mitigation: Use collapsible sections for deep content; keep top-level flow tight (hero → install → quick start → architecture → features → FAQ)
  - description: Mermaid diagrams may not render on npm registry
    severity: low
    mitigation: npm renders Mermaid in READMEs since 2024; fallback is text-based architecture description
tests:
  - "All internal links in README resolve to existing files"
  - "CLI version in src/cli/index.ts matches package.json version"
  - "README renders correctly on GitHub (check after push)"
todos:
  - id: fix-cli-version
    content: "Fix CLI version mismatch: src/cli/index.ts says 0.1.0, package.json says 2.0.0"
    agent: implementer
    intent: |
      In src/cli/index.ts line 80, the program version is hardcoded as "0.1.0" but package.json
      says "2.0.0". Change the hardcoded version to read from package.json instead, or update
      to "2.0.0". Reading from package.json is preferred (import or require the version field)
      so it stays in sync automatically. This is a prerequisite for the README since we'll
      reference the version.
    suggestedChanges: |
      Option A (preferred): Import version from package.json:
        import { version } from '../../package.json' assert { type: 'json' };
        // or use createRequire if ESM issues
        .version(version)
      Option B: Just update the string to "2.0.0"
    changeType: fix
  - id: write-readme-hero-and-intro
    content: "Write README hero section: title, badges, tagline, what-is/what-isnt"
    agent: documenter
    intent: |
      Create the top section of the new README with:
      1. Project title "TaskGraph" with a brief tagline ("Dolt-backed CLI for centaur development")
      2. Badges: npm version, license (MIT), Node >=18, GitHub stars
      3. One-paragraph "elevator pitch" explaining what TaskGraph is and why it exists
         - Inspired by Beads and Gastown but stays minimal and local-first
         - Human + agent shared task graph and execution state
         - Dolt-backed (version-controlled data), CLI-first, fits into Cursor workflows
      4. "What This Is" section (3-5 bullets):
         - A CLI (tg) + Dolt schema for plans, tasks, dependencies, execution state
         - Multi-agent coordination (2-3 agents + human)
         - Rich plan format with file trees, risks, tests, per-task intent
         - MCP server for AI assistants (Cursor, Claude Desktop)
         - Sub-agent architecture with skills, leads, and workers
      5. "What This Isn't" section (adapted from multi-agent.md):
         - Not Gastown-style orchestration (no mayor/coordinator agent)
         - No convoys/swarms — designed for 2-3 agents sharing one working copy
         - Not a project management tool — it's a development execution tool

      Keep the tone technical but approachable. Reference the oh-my-cursor style:
      clear framing, concise bullets, personality without being gimmicky.

      Write ONLY this section. The full README will be assembled from all task outputs.
      Output as markdown starting from the H1 title.
    changeType: create
  - id: write-readme-install-quickstart
    content: "Write README installation and quick start sections"
    agent: documenter
    intent: |
      Write two sections:

      **Installation** section covering:
      1. Prerequisites: Node >=18, Dolt (brew install dolt), optionally Bun for development
      2. Install as dev dependency: pnpm add -D @danalexilewis/taskgraph (or npm)
      3. Run CLI: pnpm tg (or npx tg with npm)
      4. Initialize: pnpm tg init (creates .taskgraph/ and Dolt DB)
      5. Scaffold conventions: pnpm tg setup (optional; adds docs/, .cursor/rules, skills)
         Note: setup adds files alongside existing ones and skips files that already exist

      **Quick Start** section with a concrete workflow example:
      ```bash
      # Install
      pnpm add -D @danalexilewis/taskgraph
      # Initialize
      pnpm tg init
      # Scaffold agent conventions (optional)
      pnpm tg setup
      # Create a plan
      pnpm tg plan new "My Feature" --intent "Build the login flow"
      # Import tasks from a plan file
      pnpm tg import plans/my-feature.md --plan "My Feature" --format cursor
      # See what's runnable
      pnpm tg next
      # Start working
      pnpm tg start <taskId> --agent alice
      # Mark done with evidence
      pnpm tg done <taskId> --evidence "Implemented and tests pass"
      # Check status
      pnpm tg status
      ```

      Keep it concise. Link to docs/cli-reference.md for full CLI docs.
    changeType: create
  - id: write-readme-architecture
    content: "Write README architecture section with Mermaid diagram"
    agent: documenter
    intent: |
      Write an Architecture section that includes:

      1. A Mermaid flowchart showing the high-level system:
         - CLI (tg) as the entry point
         - Dolt DB as the data store (version-controlled)
         - Plan import (markdown → DB)
         - Task execution flow (next → start → work → done)
         - Export (mermaid, dot, markdown)
         - MCP server as alternative interface

      2. A brief text description of the layers:
         - db/ layer: Dolt connection, commit, migration
         - domain/ layer: types, Zod schemas, invariants, neverthrow Result types
         - plan-import/ layer: markdown parser and importer
         - export/ layer: mermaid, dot, markdown export
         - cli/ layer: Commander.js commands

      3. Repository layout (abbreviated tree):
         ```
         src/
           cli/           # Commander.js commands
           db/            # Dolt connection, commit, migration
           domain/        # Types, schemas, invariants
           export/        # Mermaid, DOT, markdown export
           plan-import/   # Plan parsing and import
         .taskgraph/      # Local Dolt DB and config
         plans/           # Plan documents
         docs/            # Domain and skill guides
         .cursor/         # Agent templates, skills, rules
         ```

      Adapt the Mermaid diagram from docs/architecture.md but simplify for README context.
      Link to docs/architecture.md for the full architecture doc.
    changeType: create
  - id: write-readme-agent-system
    content: "Write README agent system section: orchestrator, leads, workers, skills"
    agent: documenter
    intent: |
      Write a section covering the agent architecture. This is a key differentiator.

      **Sub-Agent Architecture** (brief intro paragraph explaining the three tiers):
      - Orchestrator: the main Cursor agent; coordinates, doesn't implement
      - Leads: specialized orchestration patterns created by skills (e.g. /plan, /work)
      - Workers: task-level executors (implementer, reviewer, explorer, etc.)

      **Skills Table** — list all 11 skills with name, trigger, and one-line description:
      | Skill | Trigger | Description |
      | plan | /plan | Rich plan creation with codebase analysis |
      | work | /work | Autonomous task execution loop |
      | investigate | /investigate | Investigation and plan creation from findings |
      | review | /review | Code health and system health review |
      | debug | /debug | Systematic hypothesis-driven debugging |
      | risk | /risk | Risk assessment using 8-metric model |
      | meta | /meta | Cross-plan edge enrichment |
      | rescope | /rescope | Clarify requirements when shipped != intended |
      | report | /report | Write structured reports from findings |
      | review-tests | /review-tests | Audit test coverage, quality, infrastructure |
      | create-hook | /create-hook | Create Cursor lifecycle hooks |

      **Lead Registry** — summary table (from docs/leads/README.md):
      | Lead | Skill | Workers | Purpose |
      (9 leads: investigator, planner-analyst, execution, test-review, review, rescope, risk, meta, debug)

      **Workers** — brief list:
      implementer, reviewer, explorer, planner-analyst, investigator, debugger,
      documenter, fixer, spec-reviewer, quality-reviewer, test-quality-auditor,
      test-infra-mapper, test-coverage-scanner

      Use a collapsible <details> section for the lead registry and worker list
      to keep the README scannable.

      Link to docs/agent-strategy.md and docs/leads/README.md for full details.
    changeType: create
  - id: write-readme-cli-features
    content: "Write README CLI features section: command groups and key features"
    agent: documenter
    intent: |
      Write a section showcasing CLI features. NOT a full reference (that's docs/cli-reference.md),
      but a grouped summary showing the breadth of the CLI.

      **CLI Commands** — grouped table:

      | Group | Commands | Description |
      |-------|----------|-------------|
      | Setup | init, setup | Initialize DB, scaffold conventions |
      | Planning | plan new, plan list, import, template apply | Create plans, import from markdown, reusable templates |
      | Tasks | task new, start, done, cancel, split, block | Full task lifecycle with multi-agent support |
      | Dependencies | edge add | Task-to-task dependency edges |
      | Navigation | next, show, context, status | Find runnable tasks, inspect details, load agent context |
      | Dashboard | dashboard, status --tasks/--projects/--initiatives | Live TUI with 2s refresh |
      | Export | export mermaid, export dot, export markdown | Visualize and export the graph |
      | Analytics | stats, portfolio overlaps, portfolio hotspots, crossplan | Agent metrics, cross-plan analysis |
      | Gates | gate create, gate resolve, gate list | External dependencies (human/CI/webhook) |
      | Multi-agent | start --agent, start --worktree, worktree list, note | Parallel work with isolation |
      | MCP | tg-mcp | MCP server for AI assistants |

      **Key Features** (brief bullets with examples):
      - Git worktrees for parallel tasks: `tg start <id> --worktree`
      - Dolt branching for rollback safety: `tg start <id> --branch`
      - Rich plan format: file trees, risks, tests, per-task intent and suggested changes
      - Cross-plan analysis: domain/skill/file overlap detection
      - External gates: block tasks on human approval, CI, or webhooks
      - Template system: reusable plan structures with variable substitution
      - Live dashboard: `tg dashboard` with auto-refresh TUI

      Link to docs/cli-reference.md for the complete reference.
    changeType: create
  - id: write-readme-mcp-multiagent
    content: "Write README MCP server and multi-agent sections"
    agent: documenter
    intent: |
      Write two brief sections:

      **MCP Server** section:
      - TaskGraph provides an MCP server (tg-mcp) for AI assistants
      - Read-only tools: tg_status, tg_context, tg_next, tg_show
      - Works with Cursor, Claude Desktop, and other MCP-compatible clients
      - Run from project root; reads .taskgraph/config.json
      - Link to docs/mcp.md for setup instructions

      **Multi-Agent Support** section:
      - Designed for 2-3 agents working alongside a human
      - Publish + observe model: agents broadcast intent, observe state
      - Agent identity: --agent flag on start/note for visibility
      - Git worktrees: --worktree flag for parallel file isolation
      - Notes as cross-dimensional communication between agents
      - Agent metrics: tg stats shows tasks completed, review pass/fail, avg elapsed
      - Link to docs/multi-agent.md for full model

      Keep each section to ~10-15 lines. These are summaries, not full docs.
    changeType: create
  - id: write-readme-dev-faq-contributing
    content: "Write README development, FAQ, contributing, and license sections"
    agent: documenter
    intent: |
      Write the bottom sections of the README:

      **Development** (for contributors to TaskGraph itself):
      - Prerequisites: Node >=18, Dolt, Bun (test runner)
      - Clone, pnpm install, pnpm build
      - Tests: pnpm test (unit), pnpm test:integration, pnpm gate (validation pipeline)
      - Validation: pnpm gate (lint → typecheck → affected tests), pnpm gate:full (full suite)
      - Run CLI from repo: pnpm tg

      **FAQ** section (5-8 common questions):
      - "Do I need Dolt?" — Yes, it's the backing store. brew install dolt.
      - "Does this work without Cursor?" — The CLI works standalone. Agent features
        (skills, sub-agents) are Cursor-specific but the task graph is tool-agnostic.
      - "Can multiple agents work simultaneously?" — Yes, up to 2-3 with --agent identity
        and optional --worktree for file isolation.
      - "How do I sync the task graph across machines?" — Dolt supports remotes;
        use dolt pull/push from .taskgraph/dolt/. A tg sync command is planned.
      - "What's the difference between gates and blocks?" — Gates block on external
        conditions (human approval, CI); blocks are task-on-task dependencies.
      - "Can I use this with Claude Code or other AI tools?" — The MCP server (tg-mcp)
        works with any MCP-compatible client. The CLI works from any terminal.

      **Contributing** section:
      - Brief invitation to contribute
      - Point to the validation pipeline: pnpm gate before committing
      - Link to docs/testing.md for test conventions
      - Mention the docs-sync rule: update docs when changing behavior

      **License** section:
      - MIT license, link to LICENSE file

      **Acknowledgments/Inspiration**:
      - Beads (https://github.com/steveyegge/beads) — atomic claims, structured notes
      - Gastown.dev — centaur development model
      - oh-my-cursor — README structure inspiration
    changeType: create
  - id: assemble-readme
    content: "Assemble final README from all section outputs"
    agent: implementer
    intent: |
      Take the outputs from all previous documentation tasks and assemble them into
      a single cohesive README.md. The section order should be:

      1. Hero/title with badges (from write-readme-hero-and-intro)
      2. Table of contents (auto-generated from sections)
      3. What This Is / What This Isn't
      4. Installation (from write-readme-install-quickstart)
      5. Quick Start (from write-readme-install-quickstart)
      6. Architecture (from write-readme-architecture)
      7. Agent System (from write-readme-agent-system)
      8. CLI Features (from write-readme-cli-features)
      9. MCP Server (from write-readme-mcp-multiagent)
      10. Multi-Agent Support (from write-readme-mcp-multiagent)
      11. Development (from write-readme-dev-faq-contributing)
      12. FAQ (from write-readme-dev-faq-contributing)
      13. Contributing (from write-readme-dev-faq-contributing)
      14. Acknowledgments (from write-readme-dev-faq-contributing)
      15. License

      Ensure:
      - Consistent heading levels (H2 for main sections, H3 for subsections)
      - All internal links resolve (docs/*.md files exist)
      - No duplicate content between sections
      - Collapsible <details> sections for long tables (lead registry, worker list)
      - Table of contents with anchor links
      - Smooth transitions between sections
      - Total length target: 400-600 lines (rich but not bloated)

      Read the current README.md, then replace it entirely with the assembled version.
      Verify all linked files exist.
    blockedBy:
      [
        fix-cli-version,
        write-readme-hero-and-intro,
        write-readme-install-quickstart,
        write-readme-architecture,
        write-readme-agent-system,
        write-readme-cli-features,
        write-readme-mcp-multiagent,
        write-readme-dev-faq-contributing,
      ]
    changeType: modify
  - id: verify-readme-links
    content: "Verify all README links resolve and content is accurate"
    agent: implementer
    intent: |
      Final verification pass on the assembled README:

      1. Check every internal link (docs/*.md, docs/leads/*.md, etc.) resolves to an existing file
      2. Check that badge URLs are correct (npm package name, license, etc.)
      3. Verify the CLI command examples match actual CLI behavior (spot-check 3-4 commands)
      4. Verify the skills table matches actual .cursor/skills/ contents
      5. Verify the lead registry matches docs/leads/README.md
      6. Check Mermaid diagram renders (paste into mermaid.live or similar)
      7. Run pnpm gate to ensure no code issues from the version fix

      If any issues found, fix them directly. Report what was checked and any fixes made.
    blockedBy: [assemble-readme]
    changeType: modify
isProject: false
---

## Analysis

The current README is 69 lines — functional but sparse. It covers basic install, dev setup, and conventions but misses the project's most compelling features: the sub-agent architecture, 25+ CLI commands, rich plan format, MCP server, multi-agent coordination, live dashboard, cross-plan analysis, and skills system.

The oh-my-cursor README (https://github.com/tmcfarlane/oh-my-cursor) demonstrates what a well-structured README looks like for an agent orchestration project: clear hero, architecture diagrams, agent tables with expandable sections, command reference, FAQ, and contributing guide. We'll adapt that structure to TaskGraph's strengths.

**Key decisions:**

- **Summary + links, not duplication**: The README should summarize and link to `docs/` rather than duplicate content. This avoids drift (docs-sync.mdc tracks when to update docs).
- **Collapsible sections**: Use `<details>` for deep content (lead registry, worker list) to keep the top-level scannable.
- **Mermaid for architecture**: GitHub and npm both render Mermaid; use it for the architecture diagram.
- **Version fix first**: The CLI version (0.1.0) doesn't match package.json (2.0.0). Fix this before the README references it.
- **Documentation tasks use the documenter agent**: Content-only tasks that don't touch code should use the documenter agent, which is purpose-built for markdown/docs work.

**Version mismatch**: `src/cli/index.ts` line 80 has `.version("0.1.0")` but `package.json` says `"version": "2.0.0"`. The fix-cli-version task addresses this.

## Dependency graph

```
Parallel start (7 unblocked):
  ├── fix-cli-version (code fix)
  ├── write-readme-hero-and-intro (docs)
  ├── write-readme-install-quickstart (docs)
  ├── write-readme-architecture (docs)
  ├── write-readme-agent-system (docs)
  ├── write-readme-cli-features (docs)
  ├── write-readme-mcp-multiagent (docs)
  └── write-readme-dev-faq-contributing (docs)

After all above:
  └── assemble-readme (assembly)

After assemble-readme:
  └── verify-readme-links (verification)
```

## Out of scope

- **CONTRIBUTING.md file**: Could be a follow-up; for now the Contributing section in README is sufficient.
- **Screenshots or GIFs**: Would be valuable but requires running the tool and capturing output; defer to a follow-up.
- **Star history badge**: Requires the repo to be public and have stars; add later if desired.
- **Changelog**: Not part of this README upgrade.
- **docs/ restructuring**: The existing docs structure is fine; we're linking to it, not changing it.

<original_prompt>
I was impressed with the readme for https://github.com/tmcfarlane/oh-my-cursor

we need to upgrade ours big time.

lets make a detailed plan for what we can do
</original_prompt>
