---
triggers:
  files: ["src/cli/**"]
  change_types: ["create", "modify"]
  keywords: ["command", "subcommand"]
---

# Skill: CLI command

## Purpose

Add or extend a `tg` subcommand using Commander.js, following existing patterns for config, options, and output.

## Examples

- Register with `program.command("name").description("...").option(...).action(...)`.
- Use `readConfig()` for Dolt path; use `query(config.doltRepoPath)` for DB access.
- Use `rootOpts(cmd).json` or `cmd.parent?.opts().json` for JSON output; use `sqlEscape` for any user input in SQL.

## Gotchas

- CLI handlers use `.match()` on Result/ResultAsync and call `process.exit(1)` on error.
- Add the command in `cli/index.ts` so it is registered.
- Rebuild (`pnpm run build`) after changes; the app runs from `dist/`.
