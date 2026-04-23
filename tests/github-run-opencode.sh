#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="$(mktemp -d)"
fake_bin_dir="$work_dir/fake-bin"

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

mkdir -p "$fake_bin_dir"

cat >"$fake_bin_dir/opencode" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "--version" ]]; then
  printf '%s\n' "${FAKE_OPENCODE_VERSION:-0.0.0-test}"
  exit 0
fi
printf 'fake opencode %s\n' "$*"
printf 'MODEL=%s\n' "${MODEL:-}"
printf 'PROMPT=%s\n' "${PROMPT:-}"
printf 'USE_GITHUB_TOKEN=%s\n' "${USE_GITHUB_TOKEN:-}"
printf 'GITHUB_TOKEN=%s\n' "${GITHUB_TOKEN:-}"
printf 'ZHIPU_API_KEY=%s\n' "${ZHIPU_API_KEY:-}"
printf 'OPENCODE_API_KEY=%s\n' "${OPENCODE_API_KEY:-}"
EOF

chmod +x "$fake_bin_dir/opencode"

cat >"$fake_bin_dir/timeout" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'fake timeout %s\n' "$*"

duration="$1"
shift

printf 'TIMEOUT_DURATION=%s\n' "$duration"
"$@"
EOF

chmod +x "$fake_bin_dir/timeout"
export PATH="$fake_bin_dir:/usr/bin:/bin"

export GITHUB_RUN_OPENCODE_MODEL="wrapper-model"
export GITHUB_RUN_OPENCODE_PROMPT="review prompt"
export GITHUB_RUN_OPENCODE_USE_GITHUB_TOKEN="true"
export GITHUB_RUN_OPENCODE_GITHUB_TOKEN="gh-token"
export GITHUB_RUN_OPENCODE_ZHIPU_API_KEY="zhipu-token"
export GITHUB_RUN_OPENCODE_OPENCODE_GO_API_KEY="go-token"
export GITHUB_RUN_OPENCODE_ATTEMPTS="1"
export GITHUB_RUN_OPENCODE_RETRY_PROFILE="github-network"
export FAKE_OPENCODE_VERSION="9.9.9-wrapper"

output="$("$repo_root/github-run-opencode/run-github-opencode.sh" 2>&1)"

if [[ "$output" != *"fake opencode github run"* ]]; then
  printf 'expected github run invocation, got:\n%s\n' "$output" >&2
  exit 1
fi

if [[ "$output" != *"MODEL=wrapper-model"* ]]; then
  printf 'expected model env in output, got:\n%s\n' "$output" >&2
  exit 1
fi

if [[ "$output" != *"PROMPT=review prompt"* ]]; then
  printf 'expected prompt env in output, got:\n%s\n' "$output" >&2
  exit 1
fi

if [[ "$output" != *"USE_GITHUB_TOKEN=true"* ]]; then
  printf 'expected USE_GITHUB_TOKEN env in output, got:\n%s\n' "$output" >&2
  exit 1
fi

if [[ "$output" != *"GITHUB_TOKEN=gh-token"* ]]; then
  printf 'expected GITHUB_TOKEN env in output, got:\n%s\n' "$output" >&2
  exit 1
fi

if [[ "$output" != *"ZHIPU_API_KEY=zhipu-token"* ]]; then
  printf 'expected ZHIPU_API_KEY env in output, got:\n%s\n' "$output" >&2
  exit 1
fi

if [[ "$output" != *"OPENCODE_API_KEY=go-token"* ]]; then
  printf 'expected OPENCODE_API_KEY env in output, got:\n%s\n' "$output" >&2
  exit 1
fi

if [[ "$output" != *"TIMEOUT_DURATION=600s"* ]]; then
  printf 'expected default timeout duration of 600s, got:\n%s\n' "$output" >&2
  exit 1
fi

export GITHUB_RUN_OPENCODE_TIMEOUT_SECONDS="7"
override_output="$("$repo_root/github-run-opencode/run-github-opencode.sh" 2>&1)"

if [[ "$override_output" != *"TIMEOUT_DURATION=7s"* ]]; then
  printf 'expected override timeout duration of 7s, got:\n%s\n' "$override_output" >&2
  exit 1
fi

unset GITHUB_RUN_OPENCODE_MODEL
export MODEL_NAME="env-model-name"

output="$($repo_root/github-run-opencode/run-github-opencode.sh 2>&1)"

if [[ "$output" != *"MODEL=env-model-name"* ]]; then
  printf 'expected MODEL_NAME fallback in output, got:\n%s\n' "$output" >&2
  exit 1
fi

unset MODEL_NAME

output="$($repo_root/github-run-opencode/run-github-opencode.sh 2>&1)"

if [[ "$output" != *"MODEL=zhipuai-coding-plan/glm-5.1"* ]]; then
  printf 'expected built-in model fallback in output, got:\n%s\n' "$output" >&2
  exit 1
fi

printf 'github-run-opencode test passed\n'
