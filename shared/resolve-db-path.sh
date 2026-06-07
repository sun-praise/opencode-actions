#!/usr/bin/env bash

# Shared helper: resolve and validate the opencode database path.
# Sourced by cleanup-db.sh and run-opencode.sh migration recovery.
# This file is a source-only library, not meant to be executed directly.
#
# Public API:
#   resolve_db_path() — resolves OPENCODE_DB_PATH, validates safety, exports result
#   RESOLVED_DB_PATH  — result variable set by resolve_db_path()
#
# Validation rules:
#   - Must not be empty after resolution
#   - Must not traverse into system or sensitive directories

# Prevent direct execution
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "error: resolve-db-path.sh is a source-only library" >&2
  exit 1
fi

# Default database path — single source of truth for all callers.
OPENCODE_DB_DEFAULT_PATH="$HOME/.local/share/opencode/opencode.db"

resolve_db_path() {
  local default_path="$OPENCODE_DB_DEFAULT_PATH"
  local raw="${OPENCODE_DB_PATH:-$default_path}"
  # Guard against empty string (e.g. action input unset → env var is "")
  [[ -z "$raw" ]] && raw="$default_path"

  # Step 1: Normalize path using python3 (already a hard dependency).
  # Falls back to shell-level .. stripping if python3 is unavailable.
  local resolved
  local normalized
  normalized="$(python3 -c "import os,sys
try:
  p = os.path.realpath(sys.argv[1])
  print(p if p else '')
except OSError:
  pass" "$raw" 2>/dev/null || true)"

  if [[ -n "$normalized" ]]; then
    resolved="$normalized"
  else
    # python3 unavailable — strip .. components at shell level as defense-in-depth.
    local parts
    IFS='/' read -ra parts <<< "$raw"
    local stack=()
    local part
    for part in "${parts[@]}"; do
      if [[ "$part" == ".." ]] && [[ ${#stack[@]} -gt 0 ]]; then
        unset 'stack[${#stack[@]}-1]'
      elif [[ -n "$part" && "$part" != "." ]]; then
        stack+=("$part")
      fi
    done
    # Join with / using IFS (handles paths with spaces correctly)
    local IFS='/'
    resolved="/${stack[*]}"
  fi

  # Step 2: For non-python3 path, also resolve via cd if directory exists
  if [[ -z "$normalized" ]] && [[ -d "$(dirname "$resolved")" ]]; then
    local dir
    dir="$(dirname "$resolved")"
    resolved="$(cd "$dir" 2>/dev/null && pwd)/$(basename "$resolved")"
  fi

  # Step 3: Reject dangerous paths (system dirs and sensitive locations).
  # macOS symlinks: /etc → /private/etc, /tmp → /private/tmp, /var → /private/var.
  # /private/etc and /private/tmp blocked to catch symlink-resolved paths.
  # /private/var allowed (macOS CI temp dirs under /var/folders → /private/var/folders).
  # /var blocked on Linux (contains logs, databases; /var/tmp is world-writable).
  # Note: bare "/" intentionally NOT in list — it would match all absolute paths.
  local -a forbidden=(
    /etc /usr /bin /sbin /lib /boot /proc /sys /dev /opt /root
    /mnt /media /srv /run /var /tmp
    /private/etc /private/tmp
  )
  local prefix
  for prefix in "${forbidden[@]}"; do
    if [[ "$resolved" == "$prefix"/* || "$resolved" == "$prefix" ]]; then
      printf '::error::db-path must not point into %s, got: %s\n' "$prefix" "$resolved" >&2
      return 1
    fi
  done

  RESOLVED_DB_PATH="$resolved"
}
