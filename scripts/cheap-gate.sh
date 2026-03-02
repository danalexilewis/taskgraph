#!/usr/bin/env bash
set -euo pipefail

FULL=
FILES=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --full)
      FULL=1
      shift
      ;;
    --files)
      shift
      while [[ $# -gt 0 ]] && [[ "$1" != --* ]]; do
        FILES+=("$1")
        shift
      done
      ;;
    *)
      shift
      ;;
  esac
done

if [[ ${#FILES[@]} -eq 0 ]]; then
  CHANGED=$(git diff --name-only HEAD 2>/dev/null || true)
else
  CHANGED=$(printf '%s\n' "${FILES[@]}")
fi

# Lint and typecheck are independent; run in parallel for gate:full to save wall time
if [[ -n "$FULL" ]]; then
  echo "=== [LINT] biome check (parallel with typecheck) ==="
  npx @biomejs/biome check src/ __tests__/ scripts/ &
  LINT_PID=$!
  bash scripts/typecheck.sh --all &
  TC_PID=$!
  wait "$LINT_PID" || exit $?
  wait "$TC_PID" || exit $?
else
  echo "=== [LINT] biome check ==="
  npx @biomejs/biome check src/ __tests__/ scripts/
  bash scripts/typecheck.sh
fi

if [[ -n "$FULL" ]]; then
  echo "=== [SETUP] integration golden template ==="
  bun run scripts/run-integration-global-setup.ts
  echo "=== [TEST:full] bun test __tests__ (db and mcp isolated so mock.module applies) ==="
  set +e
  # Run db/ tests first in isolation so connection is not pre-loaded (mock applies)
  bun test __tests__/db/
  DB_EXIT=$?
  # Run mcp/ tests in isolation: tools.test.ts mocks domain/invariants which bleeds into domain tests
  bun test __tests__/mcp/
  MCP_EXIT=$?
  # Then run the rest (exclude db and mcp to avoid double-run)
  bun test __tests__/cli/ __tests__/domain/ __tests__/e2e/ __tests__/export/ __tests__/integration/ __tests__/plan-import/ __tests__/skills/
  REST_EXIT=$?
  EXIT=$((DB_EXIT | MCP_EXIT | REST_EXIT))
  set -e
  bun run scripts/run-integration-global-teardown.ts
  exit "$EXIT"
else
  echo "=== [TEST:targeted] affected tests ==="
  AFFECTED=$(echo "$CHANGED" | bun scripts/affected-tests.ts 2>/dev/null || true)
  RAN_INTEGRATION_SETUP=
  if [[ -n "$AFFECTED" ]] && echo "$AFFECTED" | grep -q "__tests__/integration"; then
    echo "=== [SETUP] integration golden template ==="
    bun run scripts/run-integration-global-setup.ts
    RAN_INTEGRATION_SETUP=1
  fi
  if [[ -n "$AFFECTED" ]]; then
    set +e
    echo "$AFFECTED" | xargs bun test
    EXIT=$?
    set -e
    if [[ -n "$RAN_INTEGRATION_SETUP" ]]; then
      bun run scripts/run-integration-global-teardown.ts
    fi
    exit "$EXIT"
  else
    echo "No affected tests, skipping."
  fi
fi

echo "Cheap gate passed."
