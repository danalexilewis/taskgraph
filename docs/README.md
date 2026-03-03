# Task Graph Documentation

Welcome to the Task Graph documentation! This system is designed to facilitate "centaur development" in Cursor, allowing an agent to operate an issue graph (tasks + dependencies + events) backed by Dolt.

**Docs as domain knowledge base:** The `docs/` folder follows a DDD-inspired structure. Each doc covers a bounded context — the subsystem it owns, key design decisions, implementation gotchas, and (where applicable) links to related projects in the task graph. See [domains.md](domains.md) for the full slug index.

## Overview

The Task Graph CLI (`tg`) provides a small, safe command surface for agents to interact with plans and tasks. It aims to persist plans as an issue graph in Dolt, keeping Cursor Plan docs as the narrative layer while atomizing into graph records for querying, overlap detection, and execution sequencing.

## Quick Start

From the repo root, use `pnpm tg` (see root [package.json](../package.json)). Requires Dolt (`brew install dolt`) and `pnpm tg` init in the project directory.

1.  **Initialize the repository:**

    ```bash
    pnpm tg init
    ```

2.  **Scaffold recommended conventions (docs + skills + Cursor rules):**

    ```bash
    pnpm tg setup
    ```

3.  **Create a new plan** (or import from Cursor format — see [Plan Import](plan-import.md#cursor-format-recommended)):

    ```bash
    pnpm tg plan new "My First Feature" --intent "Implement basic user authentication."
    ```

4.  **Create a task:**

    ```bash
    pnpm tg task new "Design Auth API" --plan "My First Feature" --feature auth --area backend
    ```

5.  **Find runnable tasks:**
    ```bash
    pnpm tg next
    ```

For more detailed information, refer to the following documentation sections:

**Core**

- [How the system works](overview.md) — single-page narrative: entrypoints, data, flows, outcomes
- [Glossary](glossary.md) — naming conventions and definitions (plan vs project, waves, tasks, etc.)
- [Architecture](architecture.md)
- [Dolt Schema](schema.md)
- [Domain index](domains.md) — full list of domain slugs and doc mapping

**CLI**

- [CLI Reference](cli-reference.md)
- [CLI overview](cli.md)
- [CLI tables](cli-tables.md) — table rendering, boxen layout, column config

**Agent**

The agent system is documented in [AGENT.md](../AGENT.md) (canonical contract), [Agent Contract](agent-contract.md), [Agent strategy](agent-strategy.md), [Multi-agent](multi-agent.md), and [docs/leads/](leads/) (lead registry and per-lead docs).

- [Agent Field Guide](agent-field-guide.md) — **start here** — patterns, gotchas, checklists for implementation work
- [Agent Contract](agent-contract.md)
- [Agent strategy](agent-strategy.md)
- [Multi-agent](multi-agent.md) — coordination, worktrees, notes
- [Cursor Agent CLI](cursor-agent-cli.md) — run sub-agents from the terminal (`agent --print --trust`)
- [MCP](mcp.md) — MCP server tools

**Development**

- [Testing](testing.md)
- [Error Handling](error-handling.md)
- [Infra](infra.md) — build, validation, publishing
- [Re-import and backfill](reimport-and-backfill.md) — procedure after DB restore: re-import plans, backfill task timestamps from git
- [Recommended packages](recommended-packages.md)
- [Skill guides](skills/README.md) — taskgraph-lifecycle-execution, dolt-schema-migration, cli-command-implementation, and more

**Planning**

- [Plan format](plan-format.md)
- [Plan Import](plan-import.md)
