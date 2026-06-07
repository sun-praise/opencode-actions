#!/usr/bin/env bash

# Cleanup opencode SQLite database to prevent migration failures.
# Called from github-run-opencode/action.yml before opencode runs.
#
# Behavior:
#   1. If the db file exceeds the size threshold → delete it.
#   2. Always: log what happened.
#
# Environment variables:
#   OPENCODE_DB_PATH  — path to opencode.db (default: ~/.local/share/opencode/opencode.db)
#   OPENCODE_DB_MAX_SIZE_MB — max allowed size in MB before cleanup (default: 50)

set -euo pipefail

db_path="${OPENCODE_DB_PATH:-$HOME/.local/share/opencode/opencode.db}"
max_mb="${OPENCODE_DB_MAX_SIZE_MB:-50}"

if [[ ! -f "$db_path" ]]; then
  exit 0
fi

size_bytes="$(stat -f%z "$db_path" 2>/dev/null || stat -c%s "$db_path" 2>/dev/null || echo 0)"
size_mb="$((size_bytes / 1024 / 1024))"

if [[ "$size_mb" -ge "$max_mb" ]]; then
  printf '::warning::opencode.db is %dMB (threshold %dMB), deleting to prevent migration failures\n' "$size_mb" "$max_mb"
  rm -f "$db_path"
  printf 'cleanup-db: deleted %s (%dMB)\n' "$db_path" "$size_mb"
else
  printf 'cleanup-db: %s is %dMB, within threshold (%dMB)\n' "$db_path" "$size_mb" "$max_mb"
fi
