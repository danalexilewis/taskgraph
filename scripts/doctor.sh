#!/usr/bin/env bash
# TaskGraph doctor: check required/optional tooling and print brew install commands.
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()  { printf "${GREEN}✓${NC} %s\n" "$1"; }
miss() { printf "${RED}✗${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}!${NC} %s\n" "$1"; }

# Required for core workflow
check() {
  local name="$1"
  local cmd="$2"
  local brew_cmd="$3"
  if command -v "$cmd" &>/dev/null; then
    ok "$name ($cmd)"
  else
    miss "$name ($cmd)"
    printf "    ${YELLOW}brew install %s${NC}\n" "$brew_cmd"
  fi
}

echo "TaskGraph doctor — tooling check"
echo ""

# Required: package manager and runtime
check "pnpm"   "pnpm"   "pnpm"
check "bun"    "bun"    "bun"
check "dolt"   "dolt"   "dolt"

# Optional: worktree backend (tg falls back to raw git if missing)
if command -v wt &>/dev/null; then
  ok "worktrunk (wt)"
else
  warn "worktrunk (wt) — optional; tg uses raw git worktrees when missing"
  printf "    ${YELLOW}brew install worktrunk && wt config shell install${NC}\n"
fi

echo ""
echo "After installing, re-run this script to verify."
