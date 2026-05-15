#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--version" ]]; then
  printf '%s\n' "${FAKE_KIMI_VERSION:-0.0.0-test}"
  exit 0
fi

printf 'fake kimi %s\n' "$*"
printf 'PROMPT=%s\n' "${KIMI_PROMPT:-}"
printf 'MODEL=%s\n' "${KIMI_MODEL_NAME:-}"
