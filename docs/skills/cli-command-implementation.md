---
triggers:
  files: ["src/cli/**"]
  change_types: ["create", "modify"]
  keywords: ["command", "subcommand", "CLI", "tg"]
---

# Skill: CLI command implementation

## Purpose

Add or extend a `tg` subcommand in a way that matches existing patterns: config, SQL safety, JSON/human output parity, and error handling. Ensures new commands feel consistent and avoid invariant or escaping bugs.

## Inputs

- Command spec (name, args, options, behavior)
- Access to `src/cli/`
- Reference implementations (e.g. `next.ts`, `context.ts`)

## Steps

1. Create `cli/<command>.ts` or extend an existing command file.
2. Use `readConfig()` for Dolt path; use `query(config.doltRepoPath)` for DB access.
3. Define the command: `program.command("name").description("...").argument(...).option(...).action(...)`.
4. Build SQL with `sqlEscape()` for any user-provided values (task IDs, plan titles, filter strings).
5. Use `result.match()` on `Result`/`ResultAsync`; on error, `process.exit(1)` and optionally output JSON.
6. Support `--json` via `rootOpts(cmd).json` or `cmd.parent?.opts().json` for machine output.
7. Register the command in `cli/index.ts` (import and call `xyzCommand(program)`).
8. Run `pnpm run build` and test manually.
9. Update `docs/cli-reference.md` with the new command/options.
