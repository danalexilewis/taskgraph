# Test Review — Evaluation Criteria Reference

Detailed criteria used by each subagent. The orchestrator reads this if it needs to resolve ambiguity or validate a subagent's findings.

The test-review skill produces a **Cursor-format plan** (in `plans/`) with one task per recommended action. Each task includes an **agent** field (`implementer`, `test-coverage-scanner`, `test-quality-auditor`, or `test-infra-mapper`) so that when the plan is imported into taskgraph, the execution loop can run `tg start <taskId> --agent <agent>` and dispatch the correct sub-agent per task.

## Coverage Scanner Criteria

### What counts as "covered"

- A module has at least one test file that imports from it and exercises its exports
- Pure functions: at least happy-path + one error-path test
- Reducers/projections: every event type has at least one test
- XState machines: at least one test per major state transition
- API routes: at least one integration test per endpoint

### What counts as "critical" (P0 if untested)

- Event sourcing reducers and projection builders
- Command validation (Zod schemas)
- Auth middleware and token verification
- Sync machine push/pull logic
- Payment/purchase flows

### What counts as "important" (P1 if untested)

- API route handlers
- Database queries (sdk-turso operations)
- Search/filter projections
- AI chunking and embedding logic

## Quality Auditor Criteria

### Red flags (per-test)

- **No assertions**: test body has no `expect()` / `assert` calls
- **Single assertion on truthy**: only checks `.toBeDefined()` or `.toBeTruthy()`
- **No error-path testing**: only happy path covered
- **Commented-out assertions**: dead code that gives false confidence
- **Magic values without helpers**: raw UUIDs, timestamps, etc. repeated inline
- **`any` casts in tests**: `(result as any).value` — hides type errors
- **Sleep-based waits**: `setTimeout(resolve, 100)` without retry/polling
- **Missing cleanup**: resources created but never torn down

### Green flags (per-test)

- Factory/builder helpers for test data
- Result type unwrapping done safely (`.isOk()` guard before `.value`)
- Both happy and error paths tested
- Descriptive test names that state expected behavior
- Shared setup with `beforeEach`/`afterEach` properly scoped

### Per-suite patterns

- Consistent describe/it nesting
- Setup and teardown symmetry
- Tests are independent (no ordering dependency)

## Infra Mapper Criteria

### Runner consistency

- Are all packages using the same runner, or is there justified divergence?
- Are runner versions pinned and compatible?
- Do all packages with source code have a meaningful `test` script?

### Configuration quality

- Are test configs (jest.config, vitest.config) consistent across packages?
- Are setup files shared or duplicated?
- Is there a root-level test orchestration (turbo)?

### CI integration

- Is there a CI workflow that runs tests?
- Are coverage thresholds enforced?
- Are integration/e2e tests run separately from unit tests?

### Missing infrastructure

- No coverage reporting tool configured
- No test:watch script for development
- No shared test utilities package
- E2e tests without proper test data seeding
