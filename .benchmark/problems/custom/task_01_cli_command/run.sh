#!/usr/bin/env bash
# Run task_01_cli_command: verify "ping" subcommand prints PONG and exits 0
set -e
cd "$(dirname "$0")/stub"
start=$(date +%s)
if command -v bun >/dev/null 2>&1; then
  bun install --silent 2>/dev/null || true
  output=$(bun run cli ping 2>&1)
else
  pnpm install --silent 2>/dev/null || true
  output=$(pnpm run cli ping 2>&1)
fi
exit_code=$?
end=$(date +%s)
duration=$((end - start))
echo "Duration: ${duration}s"
if [ $exit_code -ne 0 ]; then
  echo "cli ping exited with $exit_code"
  exit $exit_code
fi
if ! echo "$output" | grep -q "PONG"; then
  echo "Expected output to contain 'PONG', got: $output"
  exit 1
fi
exit 0
