---
triggers:
  files: ["__tests__/**"]
  change_types: ["create", "modify", "test"]
  keywords: ["test", "vitest", "integration"]
---

# Testing Strategy

The Task Graph system employs a two-tiered testing strategy to ensure reliability and determinism: **Unit Tests** for isolated business logic and **End-to-End (E2E) Tests** for validating the entire CLI workflow against a real Dolt instance.

## Tools

-   **Vitest**: Used as the test runner and assertion library for both unit and E2E tests.
-   **Execa**: Utilized in E2E tests to execute the `tg` CLI commands as a child process.

## Unit Tests

Unit tests focus on individual functions and modules, particularly pure business logic that does not directly interact with the database or file system. These tests are fast and run in isolation, often with mocked dependencies.

**Configuration**: `vitest.config.ts` configures Vitest to run all `.test.ts` files outside of the `e2e` directory.

**Location**: Unit test files are located in `__tests__/` mirroring the `src/` directory structure.

### Key Areas Covered by Unit Tests:

-   **Domain Invariants** ([`__tests__/domain/invariants.test.ts`](__tests__/domain/invariants.test.ts))
    -   `checkNoBlockerCycle`: Tests for cycle detection in task dependencies.
    -   `checkValidTransition`: Verifies all valid and invalid task status transitions (25 combinations).
-   **Domain Types** ([`__tests__/domain/types.test.ts`](__tests__/domain/types.test.ts))
    -   Validation of all Zod schemas (`PlanSchema`, `TaskSchema`, `EdgeSchema`, `EventSchema`, `DecisionSchema`) with valid and invalid inputs.
-   **Plan Import Parser** ([`__tests__/plan-import/parser.test.ts`](__tests__/plan-import/parser.test.ts))
    -   Parsing well-formed markdown plans with tasks, features, areas, and acceptance criteria.
    -   Handling edge cases like missing titles, empty files, or files without task blocks.
-   **SQL Escaping Utility** ([`__tests__/db/escape.test.ts`](__tests__/db/escape.test.ts))
    -   Ensuring proper escaping of single quotes in SQL strings.
-   **Graph Export Generators** ([`__tests__/export/mermaid_dot.test.ts`](__tests__/export/mermaid_dot.test.ts))
    -   Verification of Mermaid and Graphviz DOT string generation (with mocked database interactions).
-   **Error Module** ([`__tests__/domain/errors.test.ts`](__tests__/domain/errors.test.ts))
    -   Confirmation that `AppError` objects are constructed correctly with `ErrorCode` and messages.

### How to Run Unit Tests

```bash
pnpm test
```

## End-to-End (E2E) Tests

E2E tests simulate real-world usage of the `tg` CLI, executing commands against a live Dolt database. They verify the integration of all components, from CLI parsing to database interactions and output formatting.

**Location**: E2E test files are located in `__tests__/e2e/`.

**Setup/Teardown**: Each E2E test suite sets up a temporary directory, initializes a Dolt repository within it using `tg init`, and then cleans up the directory after all tests are run.

### Key Scenarios Covered by E2E Tests:

-   **Core Flow** ([`__tests__/e2e/core-flow.test.ts`](__tests__/e2e/core-flow.test.ts))
    -   Initialization (`tg init`)
    -   Plan creation (`tg plan new`)
    -   Task creation (`tg task new`)
    -   Edge addition (`tg edge add`)
    -   Runnable task selection (`tg next`)
    -   Task detail display (`tg show`)
    -   Task start and completion (`tg start`, `tg done`)
    -   Graph export (`tg export mermaid`)
-   **Error Scenarios**
    -   Attempting to start a blocked task.
    -   Attempting to create a blocking cycle.
    -   Running commands before initialization (`tg init`).
    -   Non-existent task IDs for `show`, `start`, `done`, `block`.
-   **Block/Split Scenarios**
    -   Blocking a task on a newly created task.
    -   Splitting a task into multiple subtasks and verifying task creation and edge wiring.

### How to Run E2E Tests

```bash
pnpm test:e2e
```

## Typecheck and OpenTUI

OpenTUI is **Bun-only** and must stay out of type scope for the Node-based gate. Our tsconfig keeps it isolated: `include: ["src/**/*.ts"]`, `exclude: ["node_modules"]`, `types: ["node"]`. See [Research: Cheap-Gate Typecheck/Lint Failures](research/cheap-gate-typecheck-lint-failures.md) for the full rationale.
