# task_01_cli_command Spec

Add a CLI subcommand to the minimal stub so that running the command produces the expected output.

## Problem

The stub is a minimal CLI (no Dolt, no full tg). It currently has no subcommands. Add one subcommand:

- **Name:** `hello`
- **Behavior:** When the user runs `bun run cli hello`, the program must print exactly `Hello, world!` to stdout and exit with code 0.

## Constraints

- Keep the stub minimal: no database, no full taskgraph; only the one subcommand and whatever is needed to run it.
- The CLI entry point is `stub/src/cli.ts` (invoked via `bun run cli` from the stub directory).

## Success

`run.sh` runs the stub and verifies that `bun run cli hello` prints `Hello, world!` and exits 0.
