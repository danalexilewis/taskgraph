# Task Graph Documentation

Welcome to the Task Graph documentation! This system is designed to facilitate "centaur development" in Cursor, allowing an agent to operate an issue graph (tasks + dependencies + events) backed by Dolt.

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

- [Glossary](glossary.md) — naming conventions and definitions (plan vs project, waves, tasks, etc.)
- [Architecture](architecture.md)
- [Dolt Schema](schema.md)
- [Skill guides](skills/README.md) — taskgraph-lifecycle-execution, dolt-schema-migration, cli-command-implementation, and more
- [CLI Reference](cli-reference.md)
- [Error Handling](error-handling.md)
- [Testing](testing.md)
- [Agent Contract](agent-contract.md)
- [Plan Import](plan-import.md)
- [Cursor Agent CLI](cursor-agent-cli.md) — run sub-agents from the terminal (`agent --print --trust`)
