#!/usr/bin/env bash

set -euo pipefail

timeout_seconds="${GITHUB_RUN_OPENCODE_TIMEOUT_SECONDS:-600}"
working_directory="${GITHUB_RUN_OPENCODE_WORKING_DIRECTORY:-}"
attempts="${GITHUB_RUN_OPENCODE_ATTEMPTS:-3}"
retry_profile="${GITHUB_RUN_OPENCODE_RETRY_PROFILE:-github-network}"
retry_on_regex="${GITHUB_RUN_OPENCODE_RETRY_ON_REGEX:-}"
retry_delay_seconds="${GITHUB_RUN_OPENCODE_RETRY_DELAY_SECONDS:-15}"

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

resolve_retry_profile() {
  local profile="$1"
  case "$profile" in
    "")
      printf '%s' "$retry_on_regex"
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

if [[ ! "$timeout_seconds" =~ ^[0-9]+$ ]]; then
  printf 'GITHUB_RUN_OPENCODE_TIMEOUT_SECONDS must be a non-negative integer, got %s\n' "$timeout_seconds" >&2
  exit 1
fi

if ! [[ "$attempts" =~ ^[0-9]+$ ]] || (( attempts < 1 )); then
  printf 'GITHUB_RUN_OPENCODE_ATTEMPTS must be a positive integer, got %s\n' "$attempts" >&2
  exit 1
fi

if ! [[ "$retry_delay_seconds" =~ ^[0-9]+$ ]]; then
  printf 'GITHUB_RUN_OPENCODE_RETRY_DELAY_SECONDS must be a non-negative integer, got %s\n' "$retry_delay_seconds" >&2
  exit 1
fi

retry_on_regex="$(resolve_retry_profile "$retry_profile")"

if [[ -n "$working_directory" ]]; then
  cd "$working_directory"
fi

run_opencode() {
  opencode github run
}

if [[ "$timeout_seconds" -eq 0 ]]; then
  attempt=1
  while [[ "$attempt" -le "$attempts" ]]; do
    log_file="$(mktemp)"

    set +e
    run_opencode 2>&1 | tee "$log_file"
    status=${PIPESTATUS[0]}
    set -e

    if [[ "$status" -eq 0 ]]; then
      rm -f "$log_file"
      exit 0
    fi

    if [[ -z "$retry_on_regex" ]] || ! grep -Eiq "$retry_on_regex" "$log_file"; then
      rm -f "$log_file"
      exit "$status"
    fi

    rm -f "$log_file"

    if [[ "$attempt" -eq "$attempts" ]]; then
      exit "$status"
    fi

    sleep_seconds="$((attempt * retry_delay_seconds))"
    printf 'OpenCode attempt %s/%s failed, retrying in %ss...\n' "$attempt" "$attempts" "$sleep_seconds"
    sleep "$sleep_seconds"
    attempt="$((attempt + 1))"
  done
fi

attempt=1
while [[ "$attempt" -le "$attempts" ]]; do
  log_file="$(mktemp)"

  set +e
  timeout "${timeout_seconds}s" run_opencode 2>&1 | tee "$log_file"
  status=${PIPESTATUS[0]}
  set -e

  if [[ "$status" -eq 0 ]]; then
    rm -f "$log_file"
    exit 0
  fi

  if [[ -z "$retry_on_regex" ]] || ! grep -Eiq "$retry_on_regex" "$log_file"; then
    rm -f "$log_file"
    exit "$status"
  fi

  rm -f "$log_file"

  if [[ "$attempt" -eq "$attempts" ]]; then
    exit "$status"
  fi

  sleep_seconds="$((attempt * retry_delay_seconds))"
  printf 'OpenCode attempt %s/%s failed, retrying in %ss...\n' "$attempt" "$attempts" "$sleep_seconds"
  sleep "$sleep_seconds"
  attempt="$((attempt + 1))"
done
