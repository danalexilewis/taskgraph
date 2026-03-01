#!/usr/bin/env bash
# overseer.sh — Background daemon that monitors task worktree filesystem activity.
# Writes a JSON status file every INTERVAL seconds so the orchestrator can quickly
# assess which agents are making progress (file changes) vs. stalled.
#
# Usage: bash scripts/overseer.sh [output-path]
#   output-path: path for JSON status file (default: /tmp/tg-overseer-status.json)
#
# The orchestrator reads the status file as a fast-path before deciding whether to
# read individual terminal files. It is best-effort and not authoritative.
set -euo pipefail

OUTPUT="${1:-/tmp/tg-overseer-status.json}"
INTERVAL=180
LOCK_FILE="/tmp/tg-overseer.lock"
PID_FILE="${OUTPUT}.pid"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Require jq
if ! command -v jq &>/dev/null; then
  echo '{"timestamp":'"$(date +%s)"',"worktrees":[],"error":"jq-not-found"}' > "$OUTPUT"
  exit 0
fi

# Single-instance guard via flock
exec {LOCK_FD}>"$LOCK_FILE"
flock -n $LOCK_FD || exit 0  # Another instance is running; exit silently

# Write own PID immediately
echo $$ > "$PID_FILE"

# Cleanup on exit
trap 'rm -f "$PID_FILE" "$LOCK_FILE"; exec {LOCK_FD}>&-' EXIT

empty_cycles=0

while true; do
  timestamp=$(date +%s)

  # Get active worktrees from task graph
  worktrees_json=$(cd "$REPO_ROOT" && pnpm --silent tg worktree list --json 2>/dev/null || echo "[]")

  if [[ "$worktrees_json" == "[]" ]] || [[ -z "$worktrees_json" ]]; then
    echo '{"timestamp":'"$timestamp"',"worktrees":[],"error":"worktree-list-unavailable"}' > "${OUTPUT}.tmp.$$"
    mv "${OUTPUT}.tmp.$$" "$OUTPUT"
    sleep $INTERVAL
    continue
  fi

  # Build JSON entries for each worktree (skip main branch)
  entries=""
  active_count=0

  while IFS= read -r wt; do
    path=$(echo "$wt" | jq -r '.path')
    branch=$(echo "$wt" | jq -r '.branch')
    task_id=$(echo "$wt" | jq -r '.task_id // ""')

    # Skip main repo and non-task branches
    [[ "$branch" == "main" ]] && continue
    [[ "$path" == "$REPO_ROOT" ]] && continue

    active_count=$((active_count + 1))
    marker="$path/.tg-dispatch-marker"

    if [[ -f "$marker" ]]; then
      # Count files changed since marker was written (excluding the marker itself)
      files_changed=$(find "$path" -newer "$marker" -type f 2>/dev/null | grep -v '\.tg-dispatch-marker$' | wc -l | tr -d ' ')

      # Compute marker age (macOS vs Linux)
      if [[ "$(uname)" == "Darwin" ]]; then
        marker_mtime=$(stat -f %m "$marker" 2>/dev/null || echo 0)
      else
        marker_mtime=$(stat -c %Y "$marker" 2>/dev/null || echo 0)
      fi
      marker_age=$((timestamp - marker_mtime))
    else
      files_changed=-1
      marker_age=-1
    fi

    # Stale: no file changes AND marker is over 5 minutes old
    if [[ "$files_changed" -eq 0 ]] && [[ "$marker_age" -gt 300 ]]; then
      stale="true"
    else
      stale="false"
    fi

    entry='{"task_id":"'"$task_id"'","path":"'"$path"'","branch":"'"$branch"'","files_changed_since_marker":'"$files_changed"',"marker_age_seconds":'"$marker_age"',"stale":'"$stale"'}'
    if [[ -n "$entries" ]]; then
      entries="$entries,$entry"
    else
      entries="$entry"
    fi

  done < <(echo "$worktrees_json" | jq -c '.[]')

  # Write status atomically
  json='{"timestamp":'"$timestamp"',"worktrees":['"$entries"']}'
  echo "$json" > "${OUTPUT}.tmp.$$"
  mv "${OUTPUT}.tmp.$$" "$OUTPUT"

  # Auto-exit after 2 consecutive cycles with no active (non-main) worktrees
  if [[ $active_count -eq 0 ]]; then
    empty_cycles=$((empty_cycles + 1))
    if [[ $empty_cycles -ge 2 ]]; then
      exit 0
    fi
  else
    empty_cycles=0
  fi

  sleep $INTERVAL
done
