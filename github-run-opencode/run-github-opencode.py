#!/usr/bin/env python3
import atexit
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

script_dir = Path(__file__).resolve().parent


def get_env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def set_env(name: str, value: str) -> None:
    if value:
        os.environ[name] = value


def require_non_negative_integer(value: str, name: str) -> int:
    if not re.fullmatch(r"[0-9]+", value):
        print(f"{name} must be a non-negative integer, got {value}", file=sys.stderr)
        sys.exit(1)
    return int(value)


def supports_model_with_available_key(model: str) -> bool:
    if model.startswith("zhipuai"):
        return bool(os.environ.get("ZHIPU_API_KEY"))
    if model.startswith("opencode-go"):
        return bool(os.environ.get("OPENCODE_API_KEY"))
    if model.startswith("deepseek"):
        return bool(os.environ.get("DEEPSEEK_API_KEY"))
    return True


def validate_regex(pattern: str, name: str) -> None:
    if not pattern:
        return
    try:
        re.compile(pattern)
    except re.error:
        print(f"{name} is not a valid extended regex: {pattern}", file=sys.stderr)
        sys.exit(1)


def parse_candidate_models(raw_list: str) -> list[str]:
    result: list[str] = []
    for item in re.split(r"[\r\n,]+", raw_list):
        normalized = item.strip()
        if normalized and normalized not in result:
            result.append(normalized)
    return result


def configure_opencode_json(reasoning_effort: str, enable_thinking: str, working_directory: str = "") -> None:
    """Generate or modify opencode.json with reasoning effort and thinking configuration."""
    config_path = Path(working_directory) / "opencode.json" if working_directory else Path("opencode.json")

    config: dict = {}
    if config_path.exists():
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
        except (json.JSONDecodeError, OSError):
            config = {}

    if "agent" not in config:
        config["agent"] = {}

    # Use "build" as the default agent name for CI scenarios
    agent_name = "build"
    if agent_name not in config["agent"]:
        config["agent"][agent_name] = {}

    if "options" not in config["agent"][agent_name]:
        config["agent"][agent_name]["options"] = {}

    if reasoning_effort:
        config["agent"][agent_name]["options"]["reasoningEffort"] = reasoning_effort

    if enable_thinking.lower() == "true":
        config["agent"][agent_name]["options"]["thinking"] = {"type": "enabled"}

    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
        f.write("\n")


def extract_decision(output_text: str, output_format: str) -> str:
    if output_format == "json":
        cleaned = re.sub(r"```(?:json)?\s*", "", output_text)
        decoder = json.JSONDecoder()
        pos = 0
        while pos < len(cleaned):
            brace_idx = cleaned.find("{", pos)
            if brace_idx < 0:
                break
            try:
                obj, end = decoder.raw_decode(cleaned, brace_idx)
                if isinstance(obj, dict) and "decision" in obj:
                    return obj["decision"]
                pos = end
            except json.JSONDecodeError:
                pos = brace_idx + 1
        return ""
    for line in output_text.split("\n"):
        stripped = line.strip()
        for decision in ("\u53ef\u5408\u5e76", "\u6709\u6761\u4ef6\u5408\u5e76", "\u4e0d\u53ef\u5408\u5e76"):
            if stripped == decision or stripped.startswith(decision):
                return decision
    return ""


def _should_override_exit_code(output_format: str, pass_level: str) -> bool:
    return output_format == "json" or pass_level != "strict"


def _apply_pass_level(decision: str, pass_level: str) -> int | None:
    if decision == "\u53ef\u5408\u5e76":
        return 0
    if decision == "\u6709\u6761\u4ef6\u5408\u5e76":
        return 0 if pass_level == "standard" else 1
    if decision == "\u4e0d\u53ef\u5408\u5e76":
        return 1
    return None


def run_model(model: str, log_file: str, effective_timeout: int, run_script: Path) -> int:
    env = os.environ.copy()
    env["MODEL"] = model

    cmd = _build_cmd(run_script, effective_timeout)
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)

    with open(log_file, "wb") as f:
        f.write(result.stdout)

    sys.stdout.buffer.write(result.stdout)
    sys.stdout.buffer.flush()

    output_format = get_env("GITHUB_RUN_OPENCODE_OUTPUT_FORMAT", "text")
    pass_level = get_env("GITHUB_RUN_OPENCODE_PASS_LEVEL", "strict")
    if _should_override_exit_code(output_format, pass_level):
        with open(log_file, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        decision = extract_decision(content, output_format)
        override = _apply_pass_level(decision, pass_level)
        if override is not None:
            return override

    return result.returncode


def _run_subprocess(cmd: list[str], capture: bool = False) -> subprocess.CompletedProcess:
    if capture:
        return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return subprocess.run(cmd)


def _build_cmd(run_script: Path, timeout_sec: int) -> list[str]:
    if timeout_sec > 0:
        return ["timeout", "--foreground", f"{timeout_sec}s", str(run_script)]
    return [str(run_script)]


def run_single(run_script: Path, timeout_sec: int) -> int:
    output_format = get_env("GITHUB_RUN_OPENCODE_OUTPUT_FORMAT", "text")
    pass_level = get_env("GITHUB_RUN_OPENCODE_PASS_LEVEL", "strict")

    if _should_override_exit_code(output_format, pass_level):
        result = _run_subprocess(_build_cmd(run_script, timeout_sec), capture=True)
        output = result.stdout.decode("utf-8", errors="replace")
        sys.stdout.write(output)
        sys.stdout.flush()
        decision = extract_decision(output, output_format)
        override = _apply_pass_level(decision, pass_level)
        if override is not None:
            return override
        return result.returncode

    result = _run_subprocess(_build_cmd(run_script, timeout_sec))
    return result.returncode


def compute_effective_timeout(
    model_timeout: int, global_timeout: int, start_time: float
) -> int:
    """Return the timeout to use for the next model attempt.

    - If global_timeout == 0, use model_timeout (or 0 if that is also 0).
    - If global_timeout > 0, cap by remaining global budget.
    - If no budget left, return 0 (caller should treat as already exceeded).
    """
    if global_timeout > 0:
        elapsed = time.time() - start_time
        remaining = max(0, global_timeout - int(elapsed))
        if remaining <= 0:
            return 0
        if model_timeout > 0:
            return min(model_timeout, remaining)
        return remaining
    if model_timeout > 0:
        return model_timeout
    return 0


def main() -> int:
    timeout_seconds = require_non_negative_integer(
        get_env("GITHUB_RUN_OPENCODE_TIMEOUT_SECONDS", "600"),
        "GITHUB_RUN_OPENCODE_TIMEOUT_SECONDS",
    )
    fallback_models_input = get_env("GITHUB_RUN_OPENCODE_FALLBACK_MODELS", "")
    model_timeout_seconds = require_non_negative_integer(
        get_env("GITHUB_RUN_OPENCODE_MODEL_TIMEOUT_SECONDS", "0"),
        "GITHUB_RUN_OPENCODE_MODEL_TIMEOUT_SECONDS",
    )
    fallback_on_regex = get_env(
        "GITHUB_RUN_OPENCODE_FALLBACK_ON_REGEX",
        "timed out|timeout|deadline exceeded|context deadline exceeded|operation timed out|connection timed out",
    )

    # Core opencode env
    os.environ["OPENCODE_ARGS"] = "github run"
    set_env("OPENCODE_WORKING_DIRECTORY", get_env("GITHUB_RUN_OPENCODE_WORKING_DIRECTORY"))
    set_env("OPENCODE_ATTEMPTS", get_env("GITHUB_RUN_OPENCODE_ATTEMPTS", "3"))
    set_env("OPENCODE_RETRY_PROFILE", get_env("GITHUB_RUN_OPENCODE_RETRY_PROFILE", "github-network"))
    set_env("OPENCODE_RETRY_ON_REGEX", get_env("GITHUB_RUN_OPENCODE_RETRY_ON_REGEX"))
    set_env("OPENCODE_RETRY_DELAY_SECONDS", get_env("GITHUB_RUN_OPENCODE_RETRY_DELAY_SECONDS", "15"))

    # Model resolution (same order as original shell script)
    if get_env("GITHUB_RUN_OPENCODE_MODEL"):
        os.environ["MODEL"] = get_env("GITHUB_RUN_OPENCODE_MODEL")
    elif get_env("MODEL_NAME"):
        os.environ["MODEL"] = get_env("MODEL_NAME")
    else:
        os.environ["MODEL"] = "zhipuai-coding-plan/glm-5.1"

    set_env("PROMPT", get_env("GITHUB_RUN_OPENCODE_PROMPT"))
    set_env("USE_GITHUB_TOKEN", get_env("GITHUB_RUN_OPENCODE_USE_GITHUB_TOKEN"))
    set_env("GITHUB_TOKEN", get_env("GITHUB_RUN_OPENCODE_GITHUB_TOKEN"))
    set_env("ZHIPU_API_KEY", get_env("GITHUB_RUN_OPENCODE_ZHIPU_API_KEY"))
    set_env("OPENCODE_API_KEY", get_env("GITHUB_RUN_OPENCODE_OPENCODE_GO_API_KEY"))
    set_env("DEEPSEEK_API_KEY", get_env("GITHUB_RUN_OPENCODE_DEEPSEEK_API_KEY"))

    # Extra env vars from extra-env input
    extra_env_raw = get_env("GITHUB_RUN_OPENCODE_EXTRA_ENV")
    if extra_env_raw:
        for line in extra_env_raw.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                print(f"Skipping invalid extra-env line (missing '='): {line}", file=sys.stderr)
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if key:
                os.environ[key] = value

    reasoning_effort = get_env("GITHUB_RUN_OPENCODE_REASONING_EFFORT", "")
    enable_thinking = get_env("GITHUB_RUN_OPENCODE_ENABLE_THINKING", "false")
    working_directory = get_env("GITHUB_RUN_OPENCODE_WORKING_DIRECTORY", "")
    if reasoning_effort or enable_thinking.lower() == "true":
        configure_opencode_json(reasoning_effort, enable_thinking, working_directory)

    validate_regex(fallback_on_regex, "GITHUB_RUN_OPENCODE_FALLBACK_ON_REGEX")

    run_script = script_dir / ".." / "run-opencode" / "run-opencode.sh"

    # Build candidate list: resolved model first, then fallbacks
    candidate_models: list[str] = []
    model = os.environ["MODEL"]
    if model:
        candidate_models.append(model)
    candidate_models.extend(parse_candidate_models(fallback_models_input))

    temp_files: list[str] = []

    def cleanup(signum=None, frame=None) -> None:
        for f in temp_files:
            try:
                os.unlink(f)
            except FileNotFoundError:
                pass
        if signum is not None:
            sys.exit(128 + signum)

    atexit.register(cleanup)
    signal.signal(signal.SIGTERM, cleanup)
    # Intentionally replace default KeyboardInterrupt with cleanup + exit(130)
    # to ensure temp files are removed when the action is interrupted.
    signal.signal(signal.SIGINT, cleanup)

    if not candidate_models:
        return run_single(run_script, timeout_seconds)

    # API key filtering
    eligible_models: list[str] = []
    for m in candidate_models:
        if supports_model_with_available_key(m):
            eligible_models.append(m)
        else:
            print(
                f"Skipping fallback model {m} because its provider key is unavailable",
                file=sys.stderr,
            )

    if not eligible_models:
        print("No eligible models available after API key filtering", file=sys.stderr)
        return 1

    if len(eligible_models) == 1:
        os.environ["MODEL"] = eligible_models[0]
        return run_single(run_script, timeout_seconds)

    # Fallback loop with global timeout budget
    start_time = time.time()
    for index, m in enumerate(eligible_models):
        fd, log_file = tempfile.mkstemp()
        os.close(fd)
        temp_files.append(log_file)

        effective_timeout = compute_effective_timeout(
            model_timeout_seconds, timeout_seconds, start_time
        )

        if effective_timeout == 0 and timeout_seconds > 0:
            print(
                f"OpenCode model {m} skipped because global timeout of {timeout_seconds}s was exceeded",
                file=sys.stderr,
            )
            is_last = index == len(eligible_models) - 1
            if is_last:
                return 124
            continue

        status = run_model(m, log_file, effective_timeout, run_script)

        if status == 0:
            return 0

        is_last = index == len(eligible_models) - 1

        if status == 124:
            print(
                f"OpenCode model {m} timed out after {effective_timeout}s",
                file=sys.stderr,
            )
            if is_last:
                return status
            continue

        with open(log_file, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()

        if fallback_on_regex and re.search(fallback_on_regex, content, re.IGNORECASE):
            print(
                f"OpenCode model {m} matched fallback regex, trying next candidate",
                file=sys.stderr,
            )
            if is_last:
                return status
            continue

        return status

    return 1


if __name__ == "__main__":
    sys.exit(main())
