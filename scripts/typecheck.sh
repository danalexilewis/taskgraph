#!/usr/bin/env bash
# Typecheck: by default only files changed vs HEAD (git). Use --all for full repo.
# Assumption: unmodified files have already been typechecked.
# Uses a temp tsconfig that includes only changed files so we keep same compilerOptions
# and exclude node_modules (passing files to tsc directly would pull in node_modules).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ALL=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      ALL=1
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -n "$ALL" ]]; then
  echo "=== [TYPECHECK] tsc --noEmit (all) ==="
  npx tsc --noEmit
  exit 0
fi

# Files changed vs HEAD (staged + unstaged), same as cheap-gate / affected-tests
CHANGED=$(git diff --name-only HEAD 2>/dev/null || true)
# Restrict to files that are part of the typecheck scope (tsconfig include: src/**/*.ts)
TYPECHECK_FILES=$(echo "$CHANGED" | grep -E '^src/.*\.ts$' || true)

if [[ -z "$TYPECHECK_FILES" ]]; then
  echo "=== [TYPECHECK] no changed src/*.ts files, skipping ==="
  exit 0
fi

echo "=== [TYPECHECK] tsc --noEmit (changed files) ==="
# Build a minimal tsconfig that includes only changed files; same options as base so
# we don't type-check node_modules (project scope stays src-only). Must live in repo
# root so "extends" and relative include paths resolve.
INCLUDES=$(echo "$TYPECHECK_FILES" | sed 's/^/"/; s/$/"/' | paste -sd ',' -)
TMPCFG="$ROOT/.tsconfig.changed.json"
trap 'rm -f "$TMPCFG"' EXIT
cat > "$TMPCFG" << EOF
{
  "extends": "./tsconfig.json",
  "include": [$INCLUDES]
}
EOF
npx tsc -p "$TMPCFG" --noEmit
