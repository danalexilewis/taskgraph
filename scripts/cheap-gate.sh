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
  echo "=== [TEST:full] bun test __tests__ ==="
  bun test __tests__
else
  echo "=== [TEST:targeted] affected tests ==="
  AFFECTED=$(echo "$CHANGED" | bun scripts/affected-tests.ts 2>/dev/null || true)
  if [[ -n "$AFFECTED" ]]; then
    echo "$AFFECTED" | xargs bun test
  else
    echo "No affected tests, skipping."
  fi
fi

echo "Cheap gate passed."
