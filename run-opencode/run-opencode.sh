#!/usr/bin/env bash

set -euo pipefail

OPENCODE_BIN_PATH="${OPENCODE_BIN_PATH:-opencode}"
OPENCODE_ARGS="${OPENCODE_ARGS:-}"
OPENCODE_WORKING_DIRECTORY="${OPENCODE_WORKING_DIRECTORY:-}"
OPENCODE_ATTEMPTS="${OPENCODE_ATTEMPTS:-1}"
OPENCODE_RETRY_ON_REGEX="${OPENCODE_RETRY_ON_REGEX:-}"
OPENCODE_RETRY_PROFILE="${OPENCODE_RETRY_PROFILE:-}"
OPENCODE_RETRY_DELAY_SECONDS="${OPENCODE_RETRY_DELAY_SECONDS:-15}"
OPENCODE_REASONING_EFFORT="${OPENCODE_REASONING_EFFORT:-}"
OPENCODE_ENABLE_THINKING="${OPENCODE_ENABLE_THINKING:-false}"

configure_opencode_json() {
  local reasoning_effort="$1"
  local enable_thinking="$2"
  local working_directory="$3"
  local config_path

  if [[ -n "$working_directory" ]]; then
    config_path="$working_directory/opencode.json"
  else
    config_path="opencode.json"
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    printf 'warning: python3 not available, skipping opencode.json configuration\n' >&2
    return
  fi

  python3 <<EOF
import json
import sys

config_path = "$config_path"
reasoning_effort = "$reasoning_effort"
enable_thinking = "$enable_thinking".lower()

try:
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    config = {}

if "agent" not in config:
    config["agent"] = {}

agent_name = "build"
if agent_name not in config["agent"]:
    config["agent"][agent_name] = {}

if "options" not in config["agent"][agent_name]:
    config["agent"][agent_name]["options"] = {}

if reasoning_effort:
    config["agent"][agent_name]["options"]["reasoningEffort"] = reasoning_effort

if enable_thinking == "true":
    config["agent"][agent_name]["options"]["thinking"] = {"type": "enabled"}

with open(config_path, "w", encoding="utf-8") as f:
    json.dump(config, f, indent=2, ensure_ascii=False)
    f.write("\n")
EOF
}

resolve_retry_profile() {
  local profile="$1"
  case "$profile" in
    "")
      printf '%s' "$OPENCODE_RETRY_ON_REGEX"
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

require_positive_integer "$OPENCODE_ATTEMPTS" "OPENCODE_ATTEMPTS"
require_non_negative_integer "$OPENCODE_RETRY_DELAY_SECONDS" "OPENCODE_RETRY_DELAY_SECONDS"
OPENCODE_RETRY_ON_REGEX="$(resolve_retry_profile "$OPENCODE_RETRY_PROFILE")"

if [[ -n "$OPENCODE_WORKING_DIRECTORY" ]]; then
  cd "$OPENCODE_WORKING_DIRECTORY"
fi

if [[ -n "$OPENCODE_REASONING_EFFORT" ]] || [[ "$OPENCODE_ENABLE_THINKING" == "true" ]]; then
  configure_opencode_json "$OPENCODE_REASONING_EFFORT" "$OPENCODE_ENABLE_THINKING" "$OPENCODE_WORKING_DIRECTORY"
fi

if [[ "$OPENCODE_BIN_PATH" == */* ]]; then
  if [[ ! -x "$OPENCODE_BIN_PATH" ]]; then
    printf 'opencode binary is not executable: %s\n' "$OPENCODE_BIN_PATH" >&2
    exit 1
  fi
else
  if ! command -v "$OPENCODE_BIN_PATH" >/dev/null 2>&1; then
    printf 'opencode binary not found on PATH: %s\n' "$OPENCODE_BIN_PATH" >&2
    exit 1
  fi
fi

opencode_args=()
if [[ -n "$OPENCODE_ARGS" ]]; then
  read -r -a opencode_args <<<"$OPENCODE_ARGS"
fi

attempt=1
while [[ "$attempt" -le "$OPENCODE_ATTEMPTS" ]]; do
  log_file="$(mktemp)"

  set +e
  "$OPENCODE_BIN_PATH" "${opencode_args[@]}" 2>&1 | tee "$log_file"
  status=${PIPESTATUS[0]}
  set -e

  if [[ "$status" -eq 0 ]]; then
    rm -f "$log_file"
    exit 0
  fi

  if [[ -z "$OPENCODE_RETRY_ON_REGEX" ]] || ! grep -Eiq "$OPENCODE_RETRY_ON_REGEX" "$log_file"; then
    rm -f "$log_file"
    exit "$status"
  fi

  rm -f "$log_file"

  if [[ "$attempt" -eq "$OPENCODE_ATTEMPTS" ]]; then
    exit "$status"
  fi

  sleep_seconds="$((attempt * OPENCODE_RETRY_DELAY_SECONDS))"
  printf 'OpenCode attempt %s/%s failed, retrying in %ss...\n' "$attempt" "$OPENCODE_ATTEMPTS" "$sleep_seconds"
  sleep "$sleep_seconds"
  attempt="$((attempt + 1))"
done
