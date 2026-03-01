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

echo "=== [LINT] biome check ==="
npx @biomejs/biome check src/ __tests__/ scripts/

if [[ -n "$FULL" ]]; then
  bash scripts/typecheck.sh --all
else
  bash scripts/typecheck.sh
fi

if [[ -n "$FULL" ]]; then
  echo "=== [SETUP] integration golden template ==="
  bun run scripts/run-integration-global-setup.ts
  echo "=== [TEST:full] bun test __tests__ ==="
  set +e
  bun test __tests__ --concurrent
  EXIT=$?
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
