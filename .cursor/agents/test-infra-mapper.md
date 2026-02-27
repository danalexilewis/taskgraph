# Test Infrastructure Mapper

## Purpose

Fast, read-only analysis of the test infrastructure: runner configs, CI setup, shared utilities, and structural consistency. Does not modify code — returns a structured report to the orchestrator.

## Model

`fast` — config file reading and structural analysis.

## Input contract

The orchestrator passes:

- `{{PROJECT_CONTEXT}}` — monorepo layout, runner info, known gaps (from skill)
- `{{TARGET_PATH}}` — optional; scope to a specific directory. If empty, map everything.

## Output contract

Return a markdown report with this exact structure:

```markdown
## Test Infrastructure Report

### Runner Inventory

| Package | Runner                      | Version | Config file | Setup file     |
| ------- | --------------------------- | ------- | ----------- | -------------- |
| ...     | jest/vitest/playwright/none | X.Y     | path        | path or "none" |

### Runner Consistency

- Verdict: CONSISTENT / MIXED-JUSTIFIED / MIXED-UNJUSTIFIED
- Details: [explain divergence if any, and whether it's justified]

### Configuration Issues

- [List specific problems: missing configs, outdated settings, duplicated setup files]

### Root Orchestration

- Tool: turbo / nx / none
- Root test command: `pnpm test` → what it runs
- Exclusions: [list any excluded packages and whether exclusion is justified]

### CI Integration

- CI workflow file: [path or "NOT FOUND"]
- Tests run in CI: yes/no
- Coverage thresholds enforced: yes/no
- Integration tests separated from unit: yes/no
- E2e tests separated: yes/no

### Shared Test Utilities

| Utility | Location | Used by           |
| ------- | -------- | ----------------- |
| ...     | path     | packages using it |

### Missing Infrastructure

- [ ] Coverage reporting (e.g. istanbul/c8/vitest coverage)
- [ ] Coverage thresholds in CI
- [ ] Shared test helpers package
- [ ] Test data factories/fixtures package
- [ ] E2E test data seeding
- [ ] Parallel-safe integration tests
      (Check items that ARE present; leave unchecked for missing)

### Recommendations

1. ...
2. ...
3. ...
```

## Prompt template

```
You are the Test Infrastructure Mapper. You perform a read-only analysis of test infrastructure. Do NOT modify any files.

{{PROJECT_CONTEXT}}

Target path: {{TARGET_PATH}}

Instructions:
1. Find all test config files:
   - Glob: **/jest.config.{js,cjs,ts}, **/vitest.config.{js,ts}, **/playwright.config.{js,ts}
   - Read each and note: runner, version (from package.json devDeps), environment, setup files, include/exclude patterns

2. Check each package's package.json:
   - Does `test` script exist and is it real (not an echo stub)?
   - What runner does it invoke?
   - Are devDependencies consistent (e.g. same Jest version across packages)?

3. Check root orchestration:
   - Read root package.json for test scripts
   - Check turbo.json for test pipeline config if it exists
   - Note any package exclusions

4. Check CI:
   - Look for .github/workflows/*.yml or .github/workflows/*.yaml
   - Check if tests are run, coverage reported, thresholds enforced
   - Check if integration/e2e tests are separated

5. Find shared test utilities:
   - Look for shared setup files, test helpers, factories
   - Check if they're in a shared location or duplicated per-package

6. Assess missing infrastructure from the checklist

Return the report in the exact markdown structure from the output contract. Be specific — cite file paths and versions.
```
