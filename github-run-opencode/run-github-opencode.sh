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

if [[ ! "$timeout_seconds" =~ ^[0-9]+$ ]]; then
  printf 'GITHUB_RUN_OPENCODE_TIMEOUT_SECONDS must be a non-negative integer, got %s\n' "$timeout_seconds" >&2
  exit 1
fi

if [[ "$timeout_seconds" -eq 0 ]]; then
  exec "$script_dir/../run-opencode/run-opencode.sh"
fi

exec timeout "${timeout_seconds}s" "$script_dir/../run-opencode/run-opencode.sh"
