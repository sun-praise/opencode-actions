#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! grep -Eq '^    default: ""$' "$repo_root/github-run-opencode/action.yml"; then
  printf 'github-run-opencode/action.yml model default is not empty\n' >&2
  exit 1
fi

if ! grep -Eq '^    default: ""$' "$repo_root/review/action.yml"; then
  printf 'review/action.yml model default is not empty\n' >&2
  exit 1
fi

if ! grep -Eq '^  timeout-seconds:$' "$repo_root/github-run-opencode/action.yml"; then
  printf 'github-run-opencode/action.yml is missing timeout-seconds input\n' >&2
  exit 1
fi

if ! grep -Eq '^  timeout-seconds:$' "$repo_root/review/action.yml"; then
  printf 'review/action.yml is missing timeout-seconds input\n' >&2
  exit 1
fi

if ! grep -Eq '^    default: "600"$' "$repo_root/github-run-opencode/action.yml"; then
  printf 'github-run-opencode/action.yml timeout-seconds default is not 600\n' >&2
  exit 1
fi

if ! grep -Eq '^    default: "600"$' "$repo_root/review/action.yml"; then
  printf 'review/action.yml timeout-seconds default is not 600\n' >&2
  exit 1
fi

if ! grep -q '可合并' "$repo_root/review/action.yml"; then
  printf 'review/action.yml is missing built-in Chinese review prompt\n' >&2
  exit 1
fi

if grep -q 'setup-opencode' "$repo_root/review/action.yml"; then
  printf 'review/action.yml still references removed setup-opencode\n' >&2
  exit 1
fi

if grep -q 'setup-opencode' "$repo_root/github-run-opencode/action.yml"; then
  printf 'github-run-opencode/action.yml still references removed setup-opencode\n' >&2
  exit 1
fi

if ! grep -q 'actions/cache@v4' "$repo_root/review/action.yml"; then
  printf 'review/action.yml should use actions/cache@v4\n' >&2
  exit 1
fi

if ! grep -q 'actions/cache@v4' "$repo_root/github-run-opencode/action.yml"; then
  printf 'github-run-opencode/action.yml should use actions/cache@v4\n' >&2
  exit 1
fi

printf 'review action metadata test passed\n'
