#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

timeout_seconds="${GITHUB_RUN_OPENCODE_TIMEOUT_SECONDS:-600}"

export OPENCODE_ARGS="github run"
export OPENCODE_WORKING_DIRECTORY="${GITHUB_RUN_OPENCODE_WORKING_DIRECTORY:-}"
export OPENCODE_ATTEMPTS="${GITHUB_RUN_OPENCODE_ATTEMPTS:-3}"
export OPENCODE_RETRY_PROFILE="${GITHUB_RUN_OPENCODE_RETRY_PROFILE:-github-network}"
export OPENCODE_RETRY_ON_REGEX="${GITHUB_RUN_OPENCODE_RETRY_ON_REGEX:-}"
export OPENCODE_RETRY_DELAY_SECONDS="${GITHUB_RUN_OPENCODE_RETRY_DELAY_SECONDS:-15}"

if [[ -n "${GITHUB_RUN_OPENCODE_MODEL:-}" ]]; then
  export MODEL="$GITHUB_RUN_OPENCODE_MODEL"
elif [[ -n "${MODEL_NAME:-}" ]]; then
  export MODEL="$MODEL_NAME"
else
  export MODEL="zhipuai-coding-plan/glm-5.1"
fi

if [[ -n "${GITHUB_RUN_OPENCODE_PROMPT:-}" ]]; then
  export PROMPT="$GITHUB_RUN_OPENCODE_PROMPT"
fi

if [[ -n "${GITHUB_RUN_OPENCODE_USE_GITHUB_TOKEN:-}" ]]; then
  export USE_GITHUB_TOKEN="$GITHUB_RUN_OPENCODE_USE_GITHUB_TOKEN"
fi

if [[ -n "${GITHUB_RUN_OPENCODE_GITHUB_TOKEN:-}" ]]; then
  export GITHUB_TOKEN="$GITHUB_RUN_OPENCODE_GITHUB_TOKEN"
fi

if [[ -n "${GITHUB_RUN_OPENCODE_ZHIPU_API_KEY:-}" ]]; then
  export ZHIPU_API_KEY="$GITHUB_RUN_OPENCODE_ZHIPU_API_KEY"
fi

if [[ -n "${GITHUB_RUN_OPENCODE_OPENCODE_GO_API_KEY:-}" ]]; then
  export OPENCODE_API_KEY="$GITHUB_RUN_OPENCODE_OPENCODE_GO_API_KEY"
fi

if [[ -n "${GITHUB_RUN_OPENCODE_DEEPSEEK_API_KEY:-}" ]]; then
  export DEEPSEEK_API_KEY="$GITHUB_RUN_OPENCODE_DEEPSEEK_API_KEY"
fi

reasoning_effort="${GITHUB_RUN_OPENCODE_REASONING_EFFORT:-}"
enable_thinking="${GITHUB_RUN_OPENCODE_ENABLE_THINKING:-false}"

if [[ -n "$reasoning_effort" ]] || [[ "$enable_thinking" == "true" ]]; then
  if ! command -v jq >/dev/null 2>&1; then
    printf 'jq is required for reasoning-effort/enable-thinking but not found on PATH\n' >&2
    exit 1
  fi

  options_parts=()
  if [[ -n "$reasoning_effort" ]]; then
    options_parts+=("\"reasoningEffort\":\"$reasoning_effort\"")
  fi
  if [[ "$enable_thinking" == "true" ]]; then
    options_parts+=("\"thinking\":{\"type\":\"enabled\"}")
  fi

  IFS=,
  options_json="{${options_parts[*]}}"
  unset IFS

  patch_json="{\"agent\":{\"build\":{\"options\":$options_json}}}"

  target_dir="."
  if [[ -n "${OPENCODE_WORKING_DIRECTORY:-}" ]]; then
    target_dir="$OPENCODE_WORKING_DIRECTORY"
  fi
  config_file="$target_dir/opencode.json"

  if [[ -f "$config_file" ]]; then
    merged="$(jq -s '.[0] * .[1]' "$config_file" <<<"$patch_json")"
    printf '%s\n' "$merged" > "$config_file"
  else
    printf '%s\n' "$patch_json" > "$config_file"
  fi
fi

if [[ ! "$timeout_seconds" =~ ^[0-9]+$ ]]; then
  printf 'GITHUB_RUN_OPENCODE_TIMEOUT_SECONDS must be a non-negative integer, got %s\n' "$timeout_seconds" >&2
  exit 1
fi

if [[ "$timeout_seconds" -eq 0 ]]; then
  exec "$script_dir/../run-opencode/run-opencode.sh"
fi

exec timeout "${timeout_seconds}s" "$script_dir/../run-opencode/run-opencode.sh"
