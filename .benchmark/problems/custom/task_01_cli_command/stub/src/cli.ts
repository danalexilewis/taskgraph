/**
 * Minimal CLI stub for task_01_cli_command.
 * No Dolt, no full tg — only a single entry point.
 * "ping" subcommand must print PONG and exit 0 (see spec.md).
 * This is a placeholder: prints wrong output so run.sh fails until an agent implements it.
 */
const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "--help" || command === "-h") {
  console.log("Usage: cli <command> [options]");
  console.log("Commands: ping");
  process.exit(0);
}

if (command === "ping") {
  // Placeholder: print wrong output so run.sh fails until agent implements real ping
  console.log("PLACEHOLDER");
  process.exit(1);
}

console.error("Unknown command:", command);
process.exit(1);
