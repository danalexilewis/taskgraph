/**
 * Minimal CLI stub for task_01_cli_command.
 * No Dolt, no full tg — only a single entry point.
 * Add a "hello" subcommand that prints "Hello, world!" (see spec.md).
 */
const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "--help" || command === "-h") {
  console.log("Usage: cli <command>");
  console.log("Commands: (none implemented yet)");
  process.exit(0);
}

// TODO: add "hello" subcommand that prints "Hello, world!"
console.error("Unknown command:", command);
process.exit(1);
