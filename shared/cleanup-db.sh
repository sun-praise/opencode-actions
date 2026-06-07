#!/usr/bin/env bash

# Cleanup opencode SQLite database to prevent migration failures.
# Called from github-run-opencode/action.yml before opencode runs.
#
# Behavior:
#   1. If the db file exceeds the size threshold → delete it.
#   2. Always: log what happened.
#
# Environment variables:
#   OPENCODE_DB_PATH       — path to opencode.db (default: ~/.local/share/opencode/opencode.db)
#   OPENCODE_DB_MAX_SIZE_MB — max allowed size in MB before cleanup (required, set by action.yml)

# Intentionally no -e: stat falls back via || chains, and we handle all
# error paths explicitly. Adding -e would break the || fallback pattern.
set -uo pipefail

# Resolve and validate db path (shared with run-opencode.sh migration recovery)
# shellcheck source=resolve-db-path.sh
source "$(dirname "$0")/resolve-db-path.sh"
resolve_db_path || exit 1
db_path="$RESOLVED_DB_PATH"

max_mb="${OPENCODE_DB_MAX_SIZE_MB:-50}"
# Validate threshold is a non-negative integer
if ! [[ "$max_mb" =~ ^[0-9]+$ ]]; then
  printf '::error::OPENCODE_DB_MAX_SIZE_MB must be a number, got: %s\n' "$max_mb" >&2
  exit 1
fi
# Treat 0 as "disable cleanup" — user intent is likely to skip, not delete everything.
if [[ "$max_mb" -eq 0 ]]; then
  printf 'cleanup-db: threshold is 0MB, treating as disabled\n'
  exit 0
fi

if [[ ! -f "$db_path" ]]; then
  exit 0
fi

# Capture size and inode atomically from a single stat call
# GNU stat: stat -c '%s %i'; BSD stat: stat -f '%z %i'
stat_line="$(stat -c '%s %i' -- "$db_path" 2>/dev/null || stat -f '%z %i' "$db_path" 2>/dev/null || true)"
if [[ -z "$stat_line" ]]; then
  printf '::warning::cleanup-db: stat failed for %s, skipping\n' "$db_path"
  exit 0
fi
size_bytes="${stat_line%% *}"
inode_at_stat="${stat_line##* }"
if [[ "$size_bytes" -eq 0 ]]; then
  printf 'cleanup-db: %s is 0 bytes, within threshold (%dMB)\n' "$db_path" "$max_mb"
  exit 0
fi
size_mb="$((size_bytes / 1024 / 1024))"

if [[ "$size_mb" -ge "$max_mb" ]]; then
  printf '::warning::opencode.db is %dMB (threshold %dMB), deleting to prevent migration failures\n' "$size_mb" "$max_mb"
  # TOCTOU defense: verify inode hasn't changed since stat (file replaced by symlink)
  inode_now="$(stat -c%i -- "$db_path" 2>/dev/null || stat -f%i "$db_path" 2>/dev/null || echo 0)"
  if [[ "$inode_now" != "$inode_at_stat" ]]; then
    printf '::warning::cleanup-db: file inode changed before deletion (TOCTOU), skipping\n'
    exit 0
  fi
  rm -f -- "$db_path" "$db_path-wal" "$db_path-shm" "$db_path-journal"
  printf 'cleanup-db: deleted %s (%dMB)\n' "$db_path" "$size_mb"
else
  printf 'cleanup-db: %s is %dMB, within threshold (%dMB)\n' "$db_path" "$size_mb" "$max_mb"
fi
