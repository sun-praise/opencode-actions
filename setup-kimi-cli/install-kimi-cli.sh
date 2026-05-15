#!/usr/bin/env bash

set -euo pipefail

KIMI_INSTALL_DIR="${KIMI_INSTALL_DIR:-${RUNNER_TOOL_CACHE:-$HOME/.cache}/kimi-cli}"
KIMI_VERSION="${KIMI_VERSION:-}"
BIN_DIR="$KIMI_INSTALL_DIR/bin"

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf '%s is required but not installed\n' "$cmd" >&2
    exit 1
  fi
}

mkdir -p "$BIN_DIR"

export PATH="$BIN_DIR:$PATH"

# Check if already available in install dir
if [[ -x "$BIN_DIR/kimi" ]]; then
  if "$BIN_DIR/kimi" --version >/dev/null 2>&1; then
    exit 0
  fi
fi

# If uv is available, prefer uv tool install
if command -v uv >/dev/null 2>&1; then
  uv_install_args=()
  if [[ -n "$KIMI_VERSION" ]]; then
    uv_install_args+=("kimi-cli==$KIMI_VERSION")
  else
    uv_install_args+=("kimi-cli")
  fi

  uv tool install --upgrade "${uv_install_args[@]}"

  # Find the binary in uv tool directory and symlink into our bin dir
  uv_tool_dir=""
  if uv tool dir >/dev/null 2>&1; then
    uv_tool_dir="$(uv tool dir)"
  fi

  uv_kimi_path=""
  if [[ -n "$uv_tool_dir" ]] && [[ -x "$uv_tool_dir/kimi-cli/bin/kimi" ]]; then
    uv_kimi_path="$uv_tool_dir/kimi-cli/bin/kimi"
  elif [[ -x "$HOME/.local/bin/kimi" ]]; then
    uv_kimi_path="$HOME/.local/bin/kimi"
  fi

  if [[ -n "$uv_kimi_path" ]]; then
    ln -sf "$uv_kimi_path" "$BIN_DIR/kimi"
  fi

  if [[ -x "$BIN_DIR/kimi" ]] && "$BIN_DIR/kimi" --version >/dev/null 2>&1; then
    exit 0
  fi

  printf 'uv tool install finished but kimi binary is not working, falling back to pip\n' >&2
fi

# Fallback: use python3 venv + pip
if command -v kimi >/dev/null 2>&1; then
  existing_path="$(command -v kimi)"
  if [[ "$existing_path" != "$BIN_DIR/kimi" ]]; then
    ln -sf "$existing_path" "$BIN_DIR/kimi"
  fi
  exit 0
fi

require_command python3

VENV_DIR="$KIMI_INSTALL_DIR/venv"
if [[ ! -d "$VENV_DIR" ]]; then
  python3 -m venv "$VENV_DIR"
fi

pip_install_args=()
if [[ -n "$KIMI_VERSION" ]]; then
  pip_install_args+=("kimi-cli==$KIMI_VERSION")
else
  pip_install_args+=("kimi-cli")
fi

"$VENV_DIR/bin/pip" install --upgrade "${pip_install_args[@]}"

if [[ -x "$VENV_DIR/bin/kimi" ]]; then
  ln -sf "$VENV_DIR/bin/kimi" "$BIN_DIR/kimi"
elif [[ -x "$VENV_DIR/bin/kimi-cli" ]]; then
  ln -sf "$VENV_DIR/bin/kimi-cli" "$BIN_DIR/kimi"
fi

if [[ ! -x "$BIN_DIR/kimi" ]]; then
  printf 'kimi-cli installation failed: kimi binary not found\n' >&2
  exit 1
fi

if ! "$BIN_DIR/kimi" --version >/dev/null 2>&1; then
  printf 'kimi-cli installation failed: kimi binary is not working\n' >&2
  exit 1
fi
