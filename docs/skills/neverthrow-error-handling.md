---
triggers:
  files: ["src/domain/errors.ts", "src/db/**", "src/cli/**", "src/plan-import/**"]
  change_types: ["create", "modify", "refactor"]
  keywords: ["Result", "ResultAsync", "neverthrow", "AppError", "error handling"]
---

# Skill: Neverthrow error handling

## Purpose

Result/ResultAsync, buildError, CLI boundary; no throw for expected failures.

## Examples

- Use `Result`/`ResultAsync` for error propagation.
- Build errors with `buildError` and `ErrorCode` enums.

## Gotchas

- Do not throw for expected errors; return `err()`.
- Match on results with `.match()`.
