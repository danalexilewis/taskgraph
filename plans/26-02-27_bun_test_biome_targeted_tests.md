---
name: Migrate to Bun Test, Add Biome, Targeted Test Execution
overview: Replace vitest with bun:test for faster test execution, add Biome for lint+format as a cheap gate, implement a golden-template Dolt repo to eliminate redundant init+migrate per test file, and implement targeted test selection so agents and CI only run tests affected by changed files.
fileTree: |
  ./
  ├── biome.json                           (create)
  ├── package.json                         (modify)
  ├── bunfig.toml                          (create)
  ├── tsconfig.json                        (modify)
  ├── scripts/
  │   ├── pre-commit.js                    (modify)
  │   ├── affected-tests.ts                (create)
  │   └── cheap-gate.sh                    (create)
  ├── __tests__/
  │   ├── db/
  │   │   ├── escape.test.ts               (modify)
  │   │   └── query.test.ts                (modify)
  │   ├── domain/
  │   │   ├── errors.test.ts               (modify)
  │   │   ├── invariants.test.ts           (modify)
  │   │   └── types.test.ts                (modify)
  │   ├── export/
  │   │   └── mermaid-format.test.ts       (modify)
  │   ├── plan-import/
  │   │   └── parser.test.ts               (modify)
  │   ├── integration/
  │   │   ├── test-utils.ts                (modify)
  │   │   ├── batch-cli.test.ts            (modify)
  │   │   ├── crossplan.test.ts            (modify)
  │   │   ├── cursor-import.test.ts        (modify)
  │   │   ├── export-markdown.test.ts      (modify)
  │   │   ├── graph-export.test.ts         (modify)
  │   │   ├── invariants-db.test.ts        (modify)
  │   │   ├── multi-agent.test.ts          (modify)
  │   │   ├── no-hard-deletes.test.ts      (modify)
  │   │   ├── plan-agent-docs.test.ts      (modify)
  │   │   ├── rich-plan-import.test.ts     (modify)
  │   │   ├── setup-scaffold.test.ts       (modify)
  │   │   └── task-dimensions.test.ts      (modify)
  │   └── e2e/
  │       └── core-flow.test.ts            (modify)
  ├── vitest.config.ts                     (delete)
  ├── .cursor/
  │   ├── hooks/
  │   │   └── rebuild-if-src-changed.js    (modify)
  │   └── rules/
  │       └── taskgraph-workflow.mdc       (modify)
  └── AGENT.md                             (modify)
risks:
  - description: Bun test runner has subtle API differences from vitest (vi.mock, vi.fn, vi.spyOn)
    severity: medium
    mitigation: query.test.ts is the only file using vi.mock/vi.fn; rewrite to use bun:test mock/spyOn. All other tests use only describe/it/expect which are bun:test compatible.
  - description: Bun may not be installed in all environments
    severity: medium
    mitigation: Add bun install to setup docs; engines field in package.json. Keep node as runtime for the CLI itself; bun is only for dev/test.
  - description: Integration tests spawn dolt processes; bun test won't eliminate that bottleneck
    severity: low
    mitigation: Golden-template pattern eliminates repeated dolt init + 7 migrations (biggest win). Targeted test selection means agents rarely run the full integration suite at all.
  - description: Golden-template Dolt repo could become stale if migrations change
    severity: medium
    mitigation: Template is rebuilt from scratch at the start of each test run (globalSetup), not cached across runs. Any migration change is picked up automatically.
  - description: Biome may flag many existing style issues on first run
    severity: low
    mitigation: Run biome migrate from prettier first; use biome check --write to auto-fix; commit the reformatted code as a standalone commit.
  - description: affected-tests.ts mapping could miss indirect dependencies
    severity: medium
    mitigation: Start with a conservative static mapping (src/db/* -> integration tests); add import-graph analysis later if needed. Full suite still runs on high-risk changes.
tests:
  - "bun test runs unit tests and passes (db, domain, export, plan-import)"
  - "bun test --filter integration runs integration tests"
  - "biome check passes on all src/ and __tests__/ files"
  - "affected-tests.ts correctly maps src/db/connection.ts changes to integration tests"
  - "affected-tests.ts maps src/domain/types.ts to domain unit tests + integration"
  - "cheap-gate.sh exits early on lint failure before running tests"
  - "pre-commit hook uses biome instead of prettier"
  - "golden-template: integration tests use cp -r instead of dolt init + 7 migrations per file"
  - "golden-template: setupIntegrationTest completes in <100ms (vs ~5-10s before)"
todos:
  - id: install-bun-biome
    content: Install bun and biome, configure biome.json with project conventions
    agent: implementer
    changeType: create
    intent: |
      Install bun (runtime) and @biomejs/biome (devDependency). Create biome.json
      configured to match current prettier settings (printWidth, tabs vs spaces, etc).
      Run `biome migrate --from prettier` if available, otherwise manually configure.
      Add biome.json with: formatter (indent=2, lineWidth=80), linter (recommended rules),
      organizeImports enabled. Remove prettier from devDependencies. Update package.json
      engines to note bun for dev.
    suggestedChanges: |
      biome.json:
      ```json
      {
        "$schema": "https://biomejs.dev/schemas/2.0/schema.json",
        "organizeImports": { "enabled": true },
        "formatter": {
          "indentStyle": "space",
          "indentWidth": 2,
          "lineWidth": 80
        },
        "linter": {
          "enabled": true,
          "rules": { "recommended": true }
        },
        "files": {
          "ignore": ["dist/", "node_modules/", ".taskgraph/"]
        }
      }
      ```
      package.json: remove prettier, add @biomejs/biome to devDependencies.
  - id: golden-template-dolt
    content: Create golden-template Dolt repo pattern to eliminate per-file init+migrate overhead
    agent: implementer
    changeType: modify
    intent: |
      The single biggest integration test speedup. Currently each of the 12 integration
      test files runs dolt init + 7 sequential migrations in beforeAll (~5-10s each,
      ~60-120s total). Instead:

      1. Create __tests__/integration/global-setup.ts that runs ONCE before all
         integration test files:
         - Creates a temp dir with dolt init + all 7 migrations applied
         - Writes the path to an env var (e.g. GOLDEN_DOLT_TEMPLATE) or a temp file
         - This is the "golden template" — a fully migrated, empty Dolt repo

      2. Rewrite setupIntegrationTest() in test-utils.ts to:
         - Read the golden template path from the env var
         - cp -r (fs.cpSync) the golden template to a new temp dir per test file
         - Write config pointing to the copied repo
         - Return the same IntegrationTestContext interface (no test changes needed)

      3. Create __tests__/integration/global-teardown.ts that cleans up the template dir.

      For bun:test, use bunfig.toml preload or a test setup file. For vitest (if this
      lands before the bun migration), use globalSetup in vitest.config.ts. The task
      should work with whichever runner is active.

      Expected impact: integration beforeAll goes from ~5-10s to ~50ms (fs.cpSync of
      a ~2MB directory). Total integration suite drops from ~114s to ~30-50s just from
      this change alone.
    suggestedChanges: |
      __tests__/integration/global-setup.ts:
      ```ts
      import * as fs from "fs";
      import * as os from "os";
      import * as path from "path";
      import { execa } from "execa";
      import { applyMigrations, applyTaskDimensionsMigration, ... } from "../../src/db/migrate";

      export async function setup() {
        const templateDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-golden-"));
        const doltRepoPath = path.join(templateDir, ".taskgraph", "dolt");
        fs.mkdirSync(doltRepoPath, { recursive: true });

        await execa(DOLT_PATH, ["init"], { cwd: doltRepoPath });
        (await applyMigrations(doltRepoPath))._unsafeUnwrap();
        // ... all 7 migrations ...

        process.env.TG_GOLDEN_TEMPLATE = templateDir;
      }

      export async function teardown() {
        const dir = process.env.TG_GOLDEN_TEMPLATE;
        if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      }
      ```

      test-utils.ts setupIntegrationTest():
      ```ts
      export async function setupIntegrationTest(): Promise<IntegrationTestContext> {
        const goldenTemplate = process.env.TG_GOLDEN_TEMPLATE;
        if (!goldenTemplate) throw new Error("Golden template not initialized — run global setup first");

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-integration-"));
        // Copy the pre-initialized Dolt repo
        fs.cpSync(goldenTemplate, tempDir, { recursive: true });

        const doltRepoPath = path.join(tempDir, ".taskgraph", "dolt");
        const cliPath = path.resolve(__dirname, "../../dist/cli/index.js");
        writeConfig({ doltRepoPath }, tempDir)._unsafeUnwrap();

        return { tempDir, doltRepoPath, cliPath };
      }
      ```
  - id: migrate-unit-tests-to-bun
    content: Migrate 7 unit test files from vitest imports to bun:test
    agent: implementer
    changeType: modify
    intent: |
      Change all unit test files (db/escape, db/query, domain/errors, domain/invariants,
      domain/types, export/mermaid-format, plan-import/parser) to import from "bun:test"
      instead of "vitest".

      Key API differences:
      - `import { describe, it, expect } from "bun:test"` (same API)
      - `import { mock, spyOn } from "bun:test"` instead of `vi.mock`/`vi.fn`/`vi.spyOn`
      - `expect(fn).toHaveBeenCalled()` works the same
      - `vi.fn()` -> `mock(() => {})` from bun:test

      The only file with mocking is __tests__/db/query.test.ts which uses vi.mock and vi.fn.
      Rewrite its mocking to use bun:test's mock() and spyOn().

      All other files only use describe/it/expect which map 1:1.
    suggestedChanges: |
      For most files, just change the import:
      ```ts
      // Before:
      import { describe, it, expect } from "vitest";
      // After:
      import { describe, it, expect } from "bun:test";
      ```

      For query.test.ts:
      ```ts
      // Before:
      import type { Mock } from "vitest";
      import { describe, it, expect, vi, beforeEach } from "vitest";
      vi.mock("../../src/db/connection", () => ({ doltSql: vi.fn() }));
      // After:
      import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test";
      import { mock as createMock } from "bun:test";
      // Use bun:test module mocking pattern
      ```
  - id: migrate-integration-tests-to-bun
    content: Migrate 12 integration test files and test-utils.ts to bun:test
    agent: implementer
    changeType: modify
    blockedBy: [migrate-unit-tests-to-bun, golden-template-dolt]
    intent: |
      Change all integration test files to import from "bun:test" instead of "vitest".
      Also update test-utils.ts if it imports from vitest (it currently doesn't import
      vitest, just execa and src modules).

      Integration tests only use describe/it/expect/beforeAll/afterAll — no mocking.
      This is a straightforward import swap.

      Also migrate __tests__/e2e/core-flow.test.ts.
    suggestedChanges: |
      For each file:
      ```ts
      // Before:
      import { describe, it, expect, beforeAll, afterAll } from "vitest";
      // After:
      import { describe, it, expect, beforeAll, afterAll } from "bun:test";
      ```
  - id: update-test-scripts-config
    content: Update package.json scripts and remove vitest config
    agent: implementer
    changeType: modify
    blockedBy: [migrate-integration-tests-to-bun]
    intent: |
      Replace vitest-based scripts with bun test equivalents:
      - "test": "bun test __tests__/db __tests__/domain __tests__/export __tests__/plan-import"
      - "test:integration": "bun test __tests__/integration"
      - "test:e2e": "bun test __tests__/e2e"
      - "test:all": "bun test __tests__"

      Create bunfig.toml for test configuration:
      ```toml
      [test]
      timeout = 30000
      ```

      Delete vitest.config.ts. Remove vitest from devDependencies.

      Update tsconfig.json to add "bun-types" to compilerOptions.types if needed
      for bun:test type resolution (or add @types/bun to devDependencies).
  - id: biome-format-codebase
    content: Run biome format and lint on entire codebase, fix all auto-fixable issues
    agent: implementer
    changeType: modify
    blockedBy: [install-bun-biome]
    intent: |
      Run `npx @biomejs/biome check --write src/ __tests__/ scripts/` to auto-fix
      formatting and lint issues across the codebase. This is a standalone commit
      so the diff is clean (only formatting changes, no logic changes).

      Review any lint errors that can't be auto-fixed and either fix them or add
      biome-ignore comments with justification.

      This must be a separate commit from the biome.json creation so git blame
      stays useful.
  - id: build-affected-tests-script
    content: Create scripts/affected-tests.ts that maps changed files to relevant test files
    agent: implementer
    changeType: create
    intent: |
      Create a script that accepts a list of changed files (from git diff or stdin)
      and outputs the test files that should run.

      Mapping strategy (static, conservative):
      1. If a test file itself changed -> include it
      2. src/db/* -> __tests__/db/*.test.ts + __tests__/integration/*.test.ts
      3. src/domain/* -> __tests__/domain/*.test.ts + __tests__/integration/*.test.ts
      4. src/export/* -> __tests__/export/*.test.ts + __tests__/integration/graph-export.test.ts + __tests__/integration/export-markdown.test.ts
      5. src/plan-import/* -> __tests__/plan-import/*.test.ts + __tests__/integration/cursor-import.test.ts + __tests__/integration/rich-plan-import.test.ts
      6. src/cli/* -> __tests__/integration/*.test.ts (CLI changes need integration tests)
      7. package.json, tsconfig.json, biome.json -> run all tests
      8. docs/*, plans/*, .cursor/* -> no tests needed

      Output: newline-separated list of test file paths, suitable for `bun test <paths>`.

      The script should be runnable as: `git diff --name-only HEAD | bun scripts/affected-tests.ts`
      or `bun scripts/affected-tests.ts src/db/connection.ts src/domain/types.ts`
    suggestedChanges: |
      ```ts
      #!/usr/bin/env bun
      const changedFiles = process.argv.slice(2).length
        ? process.argv.slice(2)
        : (await Bun.stdin.text()).trim().split("\n").filter(Boolean);

      const testFiles = new Set<string>();
      const MAPPING: [RegExp, string[]][] = [
        [/^__tests__\//, [/* include the file itself */]],
        [/^src\/db\//, ["__tests__/db/", "__tests__/integration/"]],
        [/^src\/domain\//, ["__tests__/domain/", "__tests__/integration/"]],
        // ... etc
      ];
      // resolve globs, dedupe, print
      ```
  - id: build-cheap-gate-script
    content: Create scripts/cheap-gate.sh implementing the 4-tier validation pipeline
    agent: implementer
    changeType: create
    blockedBy:
      [
        install-bun-biome,
        build-affected-tests-script,
        update-test-scripts-config,
      ]
    intent: |
      Create a shell script that implements the cheap-gate pipeline for agents:

      1. `biome check` (format + lint) — fast, catches syntax/style issues
      2. `tsc --noEmit` (typecheck) — catches type errors without building
      3. Targeted tests: run affected-tests.ts to find relevant tests, run only those
      4. Full tests: only when risk is high (flag --full or when >50% of src/ changed)

      The script should:
      - Accept --full flag to force full test suite
      - Accept --files <paths> to specify changed files (default: git diff --name-only)
      - Exit on first failure (fail-fast)
      - Print clear stage headers: [LINT] [TYPECHECK] [TEST:targeted] [TEST:full]
      - Return exit code 0 only if all stages pass
      - Skip test stages if no test files are affected (e.g. only docs changed)

      This becomes the standard validation command for agents and pre-commit.
    suggestedChanges: |
      ```bash
      #!/usr/bin/env bash
      set -euo pipefail

      CHANGED=$(git diff --name-only HEAD 2>/dev/null || echo "")
      FULL=false
      [[ "${1:-}" == "--full" ]] && FULL=true

      echo "=== [LINT] biome check ==="
      npx @biomejs/biome check src/ __tests__/ scripts/

      echo "=== [TYPECHECK] tsc --noEmit ==="
      npx tsc --noEmit

      if [[ "$FULL" == "true" ]]; then
        echo "=== [TEST:full] bun test ==="
        bun test __tests__
      else
        AFFECTED=$(echo "$CHANGED" | bun scripts/affected-tests.ts)
        if [[ -n "$AFFECTED" ]]; then
          echo "=== [TEST:targeted] ==="
          echo "$AFFECTED" | xargs bun test
        else
          echo "=== [TEST] No affected tests, skipping ==="
        fi
      fi
      ```
  - id: update-precommit-and-hooks
    content: Update pre-commit hook and agent hooks to use biome and cheap-gate
    agent: implementer
    changeType: modify
    blockedBy: [build-cheap-gate-script, biome-format-codebase]
    intent: |
      Update scripts/pre-commit.js to use biome instead of prettier:
      - Replace `npx prettier --write` with `npx @biomejs/biome check --write`
      - Keep the git-add-back pattern for staged files

      Update .cursor/hooks/rebuild-if-src-changed.js to also run cheap-gate
      after rebuilding (or document that agents should run cheap-gate manually).

      Update .cursor/rules/taskgraph-workflow.mdc to document the new validation
      pipeline and recommend agents use `bash scripts/cheap-gate.sh` after making
      changes.

      Update package.json scripts:
      - "lint": "biome check src/ __tests__/"
      - "lint:fix": "biome check --write src/ __tests__/"
      - "typecheck": "tsc --noEmit"
      - "gate": "bash scripts/cheap-gate.sh"
      - "gate:full": "bash scripts/cheap-gate.sh --full"
  - id: verify-and-document
    content: Run full test suite with bun, verify all pass, update README and AGENT.md
    agent: implementer
    changeType: modify
    blockedBy: [update-precommit-and-hooks]
    intent: |
      Final verification:
      1. Run `bun test __tests__` — all tests should pass
      2. Run `biome check` — no errors
      3. Run `tsc --noEmit` — no type errors
      4. Run `bash scripts/cheap-gate.sh` — full pipeline passes
      5. Run `bash scripts/cheap-gate.sh --full` — full suite passes

      Update AGENT.md to document:
      - New validation pipeline (biome -> tsc -> targeted tests -> full tests)
      - How to use cheap-gate.sh
      - That bun is required for dev (test runner)
      - That vitest is no longer used

      Update README if it references vitest or test commands.
isProject: false
---

## Analysis

### Why the tests are slow

Current test execution profile:

| Suite                                  | Files  | Wall time   | What's slow                                                  |
| -------------------------------------- | ------ | ----------- | ------------------------------------------------------------ |
| Unit (db, domain, export, plan-import) | 7      | ~0.4s       | Nothing — these are fast                                     |
| Integration                            | 12     | ~114s       | Each file: `dolt init` + 7 migrations + N CLI process spawns |
| E2e                                    | 1      | ~81s        | Runs `pnpm build` in beforeAll + same Dolt pattern           |
| **Total**                              | **20** | **~3+ min** |                                                              |

The bottleneck is **redundant Dolt setup**: each of the 12 integration test files creates a temp dir, runs `dolt init`, applies 7 sequential migrations — **identically, every time**. That's 12x `dolt init` + 84 migration invocations. Then each test case spawns N `node dist/cli/index.js` commands via `execa`.

**Golden-template fix**: Run `dolt init` + all migrations **once** into a template directory, then `fs.cpSync` it per test file (~1ms vs ~5-10s). This alone should cut integration time from ~114s to ~30-50s.

### Why bun:test helps

1. **Faster startup**: bun's test runner starts ~10x faster than vitest (no vite transform pipeline)
2. **Native TypeScript**: bun runs .ts directly — no transform step, no vitest config
3. **Same API surface**: `describe`, `it`, `expect`, `beforeAll`, `afterAll` are all built-in. Only `vi.mock`/`vi.fn` need rewriting (1 file).
4. **Parallel by default**: bun test runs files in parallel with worker threads

### Why targeted tests matter more than runner speed

Even with bun, integration tests will still be slow (Dolt spawning is the bottleneck, not the test runner). The real win is **not running them at all** when you've only changed domain logic or formatting code.

The 4-tier pipeline:

```
┌─────────────────────────────────────────────────┐
│ 1. biome check          (~1s)   format + lint   │
├─────────────────────────────────────────────────┤
│ 2. tsc --noEmit         (~2s)   type safety     │
├─────────────────────────────────────────────────┤
│ 3. targeted tests       (~0.5-10s) only what's  │
│    (affected-tests.ts)           affected       │
├─────────────────────────────────────────────────┤
│ 4. full tests           (~3min)  only when      │
│    (--full flag)                 risk is high    │
└─────────────────────────────────────────────────┘
```

For a typical agent change (modify 1-2 src files), the pipeline runs in **~5s** instead of **~3min**.

### Why biome over eslint

- Single tool for format + lint + import sorting (replaces prettier + would-be eslint)
- ~100x faster than eslint (Rust-based)
- `biome migrate --from prettier` handles config migration
- Excellent TypeScript support out of the box

### Migration risk: vitest -> bun:test API compatibility

| vitest API             | bun:test equivalent   | Files affected    |
| ---------------------- | --------------------- | ----------------- |
| `describe, it, expect` | Same                  | All 20            |
| `beforeAll, afterAll`  | Same                  | 13                |
| `beforeEach`           | Same                  | 1 (query.test.ts) |
| `vi.fn()`              | `mock(() => {})`      | 1 (query.test.ts) |
| `vi.mock()`            | `mock.module()`       | 1 (query.test.ts) |
| `vi.spyOn()`           | `spyOn()`             | 0                 |
| `Mock` type            | `jest.Mock` or inline | 1 (query.test.ts) |

Only `query.test.ts` needs non-trivial changes. Everything else is an import swap.

## Dependency graph

```
Parallel start (4 unblocked):
  ├── install-bun-biome
  ├── golden-template-dolt
  ├── migrate-unit-tests-to-bun
  └── build-affected-tests-script

After install-bun-biome:
  ├── biome-format-codebase
  └── (unblocks build-cheap-gate-script)

After migrate-unit-tests-to-bun + golden-template-dolt:
  └── migrate-integration-tests-to-bun

After migrate-integration-tests-to-bun:
  └── update-test-scripts-config

After update-test-scripts-config + build-affected-tests-script + install-bun-biome:
  └── build-cheap-gate-script

After build-cheap-gate-script + biome-format-codebase:
  └── update-precommit-and-hooks

After update-precommit-and-hooks:
  └── verify-and-document
```

## Expected outcome

| Scenario                               | Before                                | After                                      |
| -------------------------------------- | ------------------------------------- | ------------------------------------------ |
| Agent changes `src/domain/types.ts`    | 3+ min (full suite)                   | ~5s (biome + tsc + domain unit tests)      |
| Agent changes `src/db/connection.ts`   | 3+ min                                | ~15s (biome + tsc + db unit + integration) |
| Agent changes only `docs/` or `plans/` | 3+ min                                | ~3s (biome + tsc, no tests)                |
| Pre-commit                             | ~2s (prettier only)                   | ~5s (biome + tsc)                          |
| Full integration suite                 | ~114s (12x dolt init + 84 migrations) | ~30-50s (1x init + 12x cp -r)              |
| Full validation (release/high-risk)    | 3+ min                                | ~1 min (golden template + bun speed)       |

<original_prompt>
plan an upgrade to our test suite. its too slow.

lets make a plan to migrate to bun test instead.

and add biome and some more logic about testing just the tests that affect the files that have changed

ie

2. Good "cheap gate" before tests

For agents, the highest ROI loop is:

1. biome check (format + lint)
2. tsc -p ... (or project typecheck)
3. targeted tests only for touched areas
4. full tests only when risk is high

Follow-up: "each spawns dolt init, runs 7 migrations — it feels like this shouldn't
have to be done 7 times. but rather once and then maybe cloned per test?"
</original_prompt>
