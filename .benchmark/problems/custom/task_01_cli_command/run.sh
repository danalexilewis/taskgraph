#!/usr/bin/env bash
# Run task_01_cli_command: verify "hello" subcommand prints "Hello, world!"
set -e
cd "$(dirname "$0")/stub"
output=$(bun run cli hello 2>&1)
exit_code=$?
if [ $exit_code -ne 0 ]; then
  echo "cli hello exited with $exit_code"
  exit $exit_code
fi
if ! echo "$output" | grep -q "Hello, world!"; then
  echo "Expected output to contain 'Hello, world!', got: $output"
  exit 1
fi
exit 0
