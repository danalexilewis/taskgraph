# task_01_cli_command Spec

Add a `tg ping` subcommand to the minimal stub so that running the command produces the expected output.

## Problem

The stub is a minimal Node/TS CLI (no Dolt, no full tg). It has a placeholder "ping" subcommand. Implement it so that:

- **Name:** `ping`
- **Behavior:** When the user runs the CLI with `ping`, the program must print `PONG` to stdout and exit with code 0.
- **Optional:** If `--json` is passed, print `{"pong":true}` to stdout and exit 0.

## Constraints

- Keep the stub minimal: no database, no full taskgraph; only the ping subcommand and whatever is needed to run it.
- The CLI entry point is `stub/src/cli.ts` (invoked via `bun run cli` or `pnpm run cli` from the stub directory).

## Success

`run.sh` runs the stub and verifies that the CLI `ping` command prints `PONG` (or valid JSON with `pong: true` when `--json` is used) and exits 0.
