# Task Graph Documentation

Welcome to the Task Graph documentation! This system is designed to facilitate "centaur development" in Cursor, allowing an agent to operate an issue graph (tasks + dependencies + events) backed by Dolt.

## Overview

The Task Graph CLI (`tg`) provides a small, safe command surface for agents to interact with plans and tasks. It aims to persist plans as an issue graph in Dolt, keeping Cursor Plan docs as the narrative layer while atomizing into graph records for querying, overlap detection, and execution sequencing.

## Quick Start

1.  **Initialize the repository:**
    ```bash
    tg init
    ```

2.  **Create a new plan:**
    ```bash
    tg plan new "My First Feature" --intent "Implement basic user authentication."
    ```

3.  **Create a task:**
    ```bash
    tg task new "Design Auth API" --plan "My First Feature" --feature auth --area backend
    ```

4.  **Find runnable tasks:**
    ```bash
    tg next
    ```

For more detailed information, refer to the following documentation sections:

-   [Architecture](architecture.md)
-   [Dolt Schema](schema.md)
-   [CLI Reference](cli-reference.md)
-   [Error Handling](error-handling.md)
-   [Testing](testing.md)
-   [Agent Contract](agent-contract.md)
-   [Plan Import](plan-import.md)
