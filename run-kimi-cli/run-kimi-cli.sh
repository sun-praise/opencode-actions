#!/usr/bin/env bash

set -euo pipefail

KIMI_BIN_PATH="${KIMI_BIN_PATH:-kimi}"
KIMI_PROMPT="${KIMI_PROMPT:-}"
KIMI_MODEL="${KIMI_MODEL:-}"
KIMI_WORKING_DIRECTORY="${KIMI_WORKING_DIRECTORY:-}"
KIMI_ATTEMPTS="${KIMI_ATTEMPTS:-1}"
KIMI_RETRY_ON_REGEX="${KIMI_RETRY_ON_REGEX:-}"
KIMI_RETRY_PROFILE="${KIMI_RETRY_PROFILE:-}"
KIMI_RETRY_DELAY_SECONDS="${KIMI_RETRY_DELAY_SECONDS:-15}"
KIMI_TIMEOUT_SECONDS="${KIMI_TIMEOUT_SECONDS:-600}"
KIMI_EXTRA_ENV="${KIMI_EXTRA_ENV:-}"

resolve_retry_profile() {
  local profile="$1"
  case "$profile" in
    "")
      printf '%s' "$KIMI_RETRY_ON_REGEX"
      ;;
    github-network)
      printf "%s" "unable to access 'https://github.com/|Failed to connect to github\\.com port 443|Couldn't connect to server|Connection timed out|Operation timed out"
      ;;
    *)
      printf 'unknown retry profile: %s\n' "$profile" >&2
      exit 1
      ;;
  esac
}

require_positive_integer() {
  local value="$1"
  local name="$2"
  if [[ ! "$value" =~ ^[0-9]+$ ]] || [[ "$value" -lt 1 ]]; then
    printf '%s must be a positive integer, got %s\n' "$name" "$value" >&2
    exit 1
  fi
}

require_non_negative_integer() {
  local value="$1"
  local name="$2"
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    printf '%s must be a non-negative integer, got %s\n' "$name" "$value" >&2
    exit 1
  fi
}

# Parse extra-env into exports
if [[ -n "$KIMI_EXTRA_ENV" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    if [[ -z "$line" ]] || [[ "$line" == \#* ]]; then
      continue
    fi
    if [[ "$line" != *=* ]]; then
      printf 'warning: skipping invalid extra-env line (missing =): %s\n' "$line" >&2
      continue
    fi
    key="${line%%=*}"
    value="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ -n "$key" ]]; then
      export "$key=$value"
    fi
  done <<<"$KIMI_EXTRA_ENV"
fi

require_positive_integer "$KIMI_ATTEMPTS" "KIMI_ATTEMPTS"
require_non_negative_integer "$KIMI_RETRY_DELAY_SECONDS" "KIMI_RETRY_DELAY_SECONDS"
require_non_negative_integer "$KIMI_TIMEOUT_SECONDS" "KIMI_TIMEOUT_SECONDS"
KIMI_RETRY_ON_REGEX="$(resolve_retry_profile "$KIMI_RETRY_PROFILE")"

if [[ -n "$KIMI_WORKING_DIRECTORY" ]]; then
  cd "$KIMI_WORKING_DIRECTORY"
fi

if [[ "$KIMI_BIN_PATH" == */* ]]; then
  if [[ ! -x "$KIMI_BIN_PATH" ]]; then
    printf 'kimi binary is not executable: %s\n' "$KIMI_BIN_PATH" >&2
    exit 1
  fi
else
  if ! command -v "$KIMI_BIN_PATH" >/dev/null 2>&1; then
    printf 'kimi binary not found on PATH: %s\n' "$KIMI_BIN_PATH" >&2
    exit 1
  fi
fi

# Build kimi args
kimi_args=(--print --yolo)

if [[ -n "$KIMI_PROMPT" ]]; then
  kimi_args+=(--prompt "$KIMI_PROMPT")
fi

if [[ -n "$KIMI_MODEL" ]]; then
  kimi_args+=(--model "$KIMI_MODEL")
fi

attempt=1
while [[ "$attempt" -le "$KIMI_ATTEMPTS" ]]; do
  log_file="$(mktemp)"

  set +e
  if [[ "$KIMI_TIMEOUT_SECONDS" -gt 0 ]]; then
    timeout --foreground "${KIMI_TIMEOUT_SECONDS}s" "$KIMI_BIN_PATH" "${kimi_args[@]}" 2>&1 | tee "$log_file"
  else
    "$KIMI_BIN_PATH" "${kimi_args[@]}" 2>&1 | tee "$log_file"
  fi
  status=${PIPESTATUS[0]}
  set -e

  if [[ "$status" -eq 0 ]]; then
    rm -f "$log_file"
    exit 0
  fi

  if [[ -z "$KIMI_RETRY_ON_REGEX" ]] || ! grep -Eiq "$KIMI_RETRY_ON_REGEX" "$log_file"; then
    rm -f "$log_file"
    exit "$status"
  fi

  rm -f "$log_file"

  if [[ "$attempt" -eq "$KIMI_ATTEMPTS" ]]; then
    exit "$status"
  fi

  sleep_seconds="$((attempt * KIMI_RETRY_DELAY_SECONDS))"
  printf 'Kimi CLI attempt %s/%s failed, retrying in %ss...\n' "$attempt" "$KIMI_ATTEMPTS" "$sleep_seconds"
  sleep "$sleep_seconds"
  attempt="$((attempt + 1))"
done
