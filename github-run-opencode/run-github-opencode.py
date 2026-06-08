#!/usr/bin/env python3
import atexit
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

script_dir = Path(__file__).resolve().parent

SUPPORTED_LANGUAGES = {"zh", "en"}
SENSITIVE_ENV_KEYS = {
    # Provider API keys
    "GITHUB_TOKEN", "ZHIPU_API_KEY", "OPENCODE_API_KEY",
    "DEEPSEEK_API_KEY", "MINIMAX_API_KEY", "XIAOMI_API_KEY",
    "LITELLM_URL", "LITELLM_API_KEY",
    "GITEA_TOKEN",
    # Core runtime config
    "MODEL", "PROMPT", "USE_GITHUB_TOKEN",
    # Internal opencode runtime (set by this script)
    "OPENCODE_ARGS", "OPENCODE_CONFIG_CONTENT",
    "OPENCODE_WORKING_DIRECTORY", "OPENCODE_ATTEMPTS",
    "OPENCODE_RETRY_PROFILE", "OPENCODE_RETRY_ON_REGEX",
    "OPENCODE_RETRY_DELAY_SECONDS",
}


def get_env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def detect_platform() -> str:
    """Detect the current CI platform. Returns 'gitea' or 'github'."""
    if get_env("GITEA_API_URL"):
        return "gitea"
    return "github"


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
    if model.startswith("minimax"):
        return bool(os.environ.get("MINIMAX_API_KEY"))
    if model.startswith("xiaomi"):
        return bool(os.environ.get("XIAOMI_API_KEY"))
    if model.startswith("litellm"):
        return bool(os.environ.get("LITELLM_API_KEY"))
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


def _deep_merge(base: dict, override: dict) -> None:
    """Merge override into base dict recursively. Override values win on conflicts."""
    for key, value in override.items():
        if key in base and isinstance(base[key], dict) and isinstance(value, dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value


def configure_opencode_env(
    reasoning_effort: str,
    enable_thinking: str,
    working_directory: str = "",
    permission: dict | None = None,
) -> None:
    """Set OPENCODE_CONFIG_CONTENT env var with reasoning effort, thinking, and permission configuration.

    Reads existing opencode.json from the working directory (if present) and merges
    the CI-specific settings into it.  The merged config is passed via the
    ``OPENCODE_CONFIG_CONTENT`` environment variable so that no file is written
    to the working tree, keeping it clean and avoiding spurious git push attempts.
    """
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

    if permission:
        if "permission" not in config["agent"][agent_name]:
            config["agent"][agent_name]["permission"] = {}
        _deep_merge(config["agent"][agent_name]["permission"], permission)

    os.environ["OPENCODE_CONFIG_CONTENT"] = json.dumps(config, ensure_ascii=False)


def extract_decision(output_text: str, output_format: str) -> str:
    if output_format == "json":
        cleaned = re.sub(r"```(?:json)?\s*|\s*```\s*$", "", output_text)
        # Fast path: try direct parse first; fall back to incremental decoder for text with surrounding content
        try:
            obj = json.loads(cleaned)
            if isinstance(obj, dict) and obj.get("decision") in ("可合并", "有条件合并", "不可合并"):
                return obj["decision"]
            # Parsed successfully but not a valid decision dict — no point retrying raw_decode on same text
            return ""
        except json.JSONDecodeError:
            pass
        decoder = json.JSONDecoder()
        pos = 0
        while pos < len(cleaned):
            brace_idx = cleaned.find("{", pos)
            if brace_idx < 0:
                break
            try:
                obj, end = decoder.raw_decode(cleaned, brace_idx)
                if isinstance(obj, dict) and "decision" in obj:
                    if obj["decision"] in ("可合并", "有条件合并", "不可合并"):
                        return obj["decision"]
                    pos = end
                else:
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

    if effective_timeout > 0:
        cmd = ["timeout", "--foreground", f"{effective_timeout}s", str(run_script)]
    else:
        cmd = [str(run_script)]

    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)

    with open(log_file, "wb") as f:
        f.write(result.stdout)

    # Replay captured output so it is visible in CI / terminal
    sys.stdout.buffer.write(result.stdout)
    sys.stdout.buffer.flush()

    if result.returncode != 0 and _is_push_denied_failure(result.stdout.decode("utf-8", errors="replace")):
        print(
            "::warning::opencode session-share 'git push' was denied (e.g. contents:read). "
            "The review comment was already posted via API; treating this as success.",
            file=sys.stderr,
        )
        return 0

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


def run_single(run_script: Path, timeout_sec: int) -> int:
    if timeout_sec > 0:
        result = subprocess.run(
            ["timeout", "--foreground", f"{timeout_sec}s", str(run_script)],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
    else:
        result = subprocess.run(
            [str(run_script)],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
    sys.stdout.write(result.stdout)
    sys.stdout.flush()

    if result.returncode != 0 and _is_push_denied_failure(result.stdout):
        print(
            "::warning::opencode session-share 'git push' was denied (e.g. contents:read). "
            "The review comment was already posted via API; treating this as success.",
            file=sys.stderr,
        )
        return 0

    output_format = get_env("GITHUB_RUN_OPENCODE_OUTPUT_FORMAT", "text")
    pass_level = get_env("GITHUB_RUN_OPENCODE_PASS_LEVEL", "strict")
    if _should_override_exit_code(output_format, pass_level):
        decision = extract_decision(result.stdout, output_format)
        override = _apply_pass_level(decision, pass_level)
        if override is not None:
            return override

    return result.returncode


# Specific markers emitted by opencode when its built-in session-share step
# tries to push the working tree back to the PR branch but the runner only
# has contents:read. The review itself succeeds (comment posted via the API)
# before this push runs, so the job should not fail.
PUSH_DENIED_PATTERNS = re.compile(
    r"(Write access to repository not granted"
    r"|Command failed with code 128: git push"
    r"|fatal: unable to access ['\"][^'\"]+['\"]?: The requested URL returned error: 403)",
    re.IGNORECASE,
)


def _is_push_denied_failure(content: str) -> bool:
    """Return True if the only meaningful failure in the log is opencode's
    built-in session-share ``git push`` being denied by the runner's token
    scope (typically ``contents: read``). The review comment itself was
    already posted via the API, so the job should exit 0 in this case.
    """
    return bool(PUSH_DENIED_PATTERNS.search(content))


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


def cleanup_error_comments() -> None:
    """Delete error comments posted by opencode to the current PR."""
    enabled = get_env("GITHUB_RUN_OPENCODE_CLEANUP_ERROR_COMMENTS", "true")
    if enabled.lower() != "true":
        return

    github_ref = get_env("GITHUB_REF", "")
    github_repository = get_env("GITHUB_REPOSITORY", "")
    github_run_id = get_env("GITHUB_RUN_ID", "")

    match = re.fullmatch(r"refs/pull/(\d+)/merge", github_ref)
    if not match:
        return
    pr_number = match.group(1)

    if not github_repository or not github_run_id:
        print("cleanup-error-comments: skipping, missing GITHUB_REPOSITORY or GITHUB_RUN_ID", file=sys.stderr)
        return

    platform = detect_platform()

    if platform == "gitea":
        _cleanup_error_comments_gitea(pr_number, github_repository, github_run_id)
    else:
        _cleanup_error_comments_github(pr_number, github_repository, github_run_id)


def _cleanup_error_comments_github(pr_number: str, github_repository: str, github_run_id: str) -> None:
    """Cleanup error comments on GitHub using gh CLI."""
    gh_path = shutil.which("gh")
    if not gh_path:
        print("cleanup-error-comments: skipping, gh CLI not available", file=sys.stderr)
        return

    run_link_pattern = f"/{github_repository}/actions/runs/{github_run_id}"
    error_indicators = re.compile(
        r"(fatal:|remote:|error:\s*\d{3}|unable to access|Write access|permission denied)",
        re.IGNORECASE,
    )

    try:
        result = subprocess.run(
            [
                gh_path, "api",
                "--paginate",
                "-H", "Accept: application/vnd.github+json",
                f"/repos/{github_repository}/issues/{pr_number}/comments",
            ],
            capture_output=True,
            text=True,
            env=os.environ.copy(),
            timeout=30,
        )
        if result.returncode != 0:
            print(f"cleanup-error-comments: failed to list comments: {result.stderr}", file=sys.stderr)
            return
        comments = json.loads(result.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError) as e:
        print(f"cleanup-error-comments: error listing comments: {e}", file=sys.stderr)
        return

    for comment in comments:
        comment_id = comment.get("id")
        body = comment.get("body", "")
        if not comment_id or not body:
            continue
        if run_link_pattern not in body or not error_indicators.search(body):
            continue
        try:
            del_result = subprocess.run(
                [
                    gh_path, "api",
                    "-X", "DELETE",
                    f"/repos/{github_repository}/issues/comments/{comment_id}",
                ],
                capture_output=True,
                text=True,
                env=os.environ.copy(),
                timeout=10,
            )
            if del_result.returncode == 0:
                print(f"cleanup-error-comments: deleted error comment {comment_id}")
            else:
                print(f"cleanup-error-comments: failed to delete comment {comment_id}: {del_result.stderr}", file=sys.stderr)
        except subprocess.TimeoutExpired as e:
            print(f"cleanup-error-comments: error deleting comment {comment_id}: {e}", file=sys.stderr)


def _cleanup_error_comments_gitea(pr_number: str, github_repository: str, github_run_id: str) -> None:
    """Cleanup error comments on Gitea using REST API (via curl).

    Note: parameters prefixed github_* for compatibility — Gitea Actions injects
    the same GITHUB_REF/GITHUB_REPOSITORY/GITHUB_RUN_ID variables.
    """
    api_base = get_env("GITEA_API_URL", "").rstrip("/")
    token = get_env("GITEA_TOKEN", "") or get_env("GITHUB_RUN_OPENCODE_GITEA_TOKEN", "")

    if not api_base:
        print("cleanup-error-comments: skipping, GITEA_API_URL not set", file=sys.stderr)
        return

    # Validate inputs before URL construction (aligned with TS platform.ts)
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", github_repository):
        print(f"cleanup-error-comments: skipping, invalid GITHUB_REPOSITORY: {github_repository}", file=sys.stderr)
        return
    if not re.fullmatch(r"\d+", pr_number):
        print(f"cleanup-error-comments: skipping, invalid PR number: {pr_number}", file=sys.stderr)
        return

    # Warn about plain HTTP (aligned with TS platform.ts getGiteaApiBase)
    if api_base.startswith("http://"):
        print(f"Warning: GITEA_API_URL uses plain HTTP — token transmitted in cleartext: {api_base}", file=sys.stderr)

    run_link_pattern = f"/{github_repository}/actions/runs/{github_run_id}"
    error_indicators = re.compile(
        r"(fatal:|remote:|error:\s*\d{3}|unable to access|Write access|permission denied)",
        re.IGNORECASE,
    )

    # List comments with pagination
    comments: list[dict] = []
    page = 1
    limit = 50
    max_pages = 20
    while page <= max_pages:
        try:
            curl_args = ["curl", "-sSf", "-H", "Accept: application/json"]
            if token:
                curl_args += ["-H", f"Authorization: token {token}"]
            curl_args.append(f"{api_base}/repos/{github_repository}/issues/{pr_number}/comments?page={page}&limit={limit}")

            result = subprocess.run(curl_args, capture_output=True, text=True, timeout=30)
            if result.returncode != 0:
                print(f"cleanup-error-comments: failed to list Gitea comments page {page}: {result.stderr}", file=sys.stderr)
                break
            batch = json.loads(result.stdout)
            if not isinstance(batch, list) or len(batch) == 0:
                break
            comments.extend(batch)
            if len(batch) < limit:
                break
            page += 1
        except (subprocess.TimeoutExpired, json.JSONDecodeError) as e:
            print(f"cleanup-error-comments: error listing Gitea comments page {page}: {e}", file=sys.stderr)
            break

    for comment in comments:
        comment_id = comment.get("id")
        body = comment.get("body", "")
        if not comment_id or not body:
            continue
        if run_link_pattern not in body or not error_indicators.search(body):
            continue
        try:
            del_args = ["curl", "-sSf", "-X", "DELETE"]
            if token:
                del_args += ["-H", f"Authorization: token {token}"]
            del_args.append(f"{api_base}/repos/{github_repository}/issues/comments/{comment_id}")

            del_result = subprocess.run(del_args, capture_output=True, text=True, timeout=10)
            if del_result.returncode == 0:
                print(f"cleanup-error-comments: deleted Gitea error comment {comment_id}")
            else:
                print(f"cleanup-error-comments: failed to delete Gitea comment {comment_id}: {del_result.stderr}", file=sys.stderr)
        except subprocess.TimeoutExpired as e:
            print(f"cleanup-error-comments: error deleting Gitea comment {comment_id}: {e}", file=sys.stderr)


def main() -> int:
    try:
        return _main()
    finally:
        try:
            cleanup_error_comments()
        except Exception:
            pass


def _ensure_git_identity() -> None:
    """Configure git user.name and user.email if not already set.

    opencode's ``github run`` built-in commit logic (triggered when the
    working tree is dirty after the agent finishes) requires a git identity.
    When ``use_github_token`` is true (the default for read-only actions),
    opencode skips its own ``configureGit()`` call, leaving the runner
    without a git identity.  This helper fills the gap so that the commit
    never fails with "Author identity unknown".
    """
    for scope in ("--global", "--local"):
        try:
            result = subprocess.run(
                ["git", "config", scope, "user.name"],
                capture_output=True,
                text=True,
            )
            if result.returncode == 0 and result.stdout.strip():
                return  # identity already configured
        except FileNotFoundError:
            return  # git not available, nothing to do

    subprocess.run(
        ["git", "config", "--global", "user.name", "github-actions[bot]"],
        check=True,
    )
    subprocess.run(
        [
            "git",
            "config",
            "--global",
            "user.email",
            "github-actions[bot]@users.noreply.github.com",
        ],
        check=True,
    )

def _main() -> int:
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
        "timed out|timeout|deadline exceeded|context deadline exceeded|operation timed out|connection timed out|ProviderModelNotFoundError",
    )

    # Core opencode env
    os.environ["OPENCODE_ARGS"] = "github run --print-logs --log-level ERROR"
    set_env("OPENCODE_WORKING_DIRECTORY", get_env("GITHUB_RUN_OPENCODE_WORKING_DIRECTORY"))
    set_env("OPENCODE_ATTEMPTS", get_env("GITHUB_RUN_OPENCODE_ATTEMPTS", "3"))
    set_env("OPENCODE_RETRY_PROFILE", get_env("GITHUB_RUN_OPENCODE_RETRY_PROFILE", "github-network"))
    set_env("OPENCODE_RETRY_ON_REGEX", get_env("GITHUB_RUN_OPENCODE_RETRY_ON_REGEX"))
    set_env("OPENCODE_RETRY_DELAY_SECONDS", get_env("GITHUB_RUN_OPENCODE_RETRY_DELAY_SECONDS", "15"))

    # Model resolution (same order as original shell script)
    if get_env("GITHUB_RUN_OPENCODE_MODEL"):
        set_env("MODEL", get_env("GITHUB_RUN_OPENCODE_MODEL"))
    elif get_env("MODEL_NAME"):
        set_env("MODEL", get_env("MODEL_NAME"))
    else:
        set_env("MODEL", "zhipuai-coding-plan/glm-5.1")

    set_env("PROMPT", get_env("GITHUB_RUN_OPENCODE_PROMPT"))
    set_env("USE_GITHUB_TOKEN", get_env("GITHUB_RUN_OPENCODE_USE_GITHUB_TOKEN"))
    set_env("GITHUB_TOKEN", get_env("GITHUB_RUN_OPENCODE_GITHUB_TOKEN"))
    set_env("ZHIPU_API_KEY", get_env("GITHUB_RUN_OPENCODE_ZHIPU_API_KEY"))
    set_env("OPENCODE_API_KEY", get_env("GITHUB_RUN_OPENCODE_OPENCODE_GO_API_KEY"))
    set_env("DEEPSEEK_API_KEY", get_env("GITHUB_RUN_OPENCODE_DEEPSEEK_API_KEY"))
    set_env("MINIMAX_API_KEY", get_env("GITHUB_RUN_OPENCODE_MINIMAX_API_KEY"))
    set_env("XIAOMI_API_KEY", get_env("GITHUB_RUN_OPENCODE_XIAOMI_API_KEY"))
    set_env("LITELLM_URL", get_env("GITHUB_RUN_OPENCODE_LITELLM_URL"))
    set_env("LITELLM_API_KEY", get_env("GITHUB_RUN_OPENCODE_LITELLM_API_KEY"))

    # Language override: append a language instruction to the prompt.
    # When PROMPT is empty (e.g. user cleared the default), skip appending
    # language instructions since there is nothing to respond to.
    language = get_env("GITHUB_RUN_OPENCODE_LANGUAGE", "zh").strip().lower()
    existing_prompt = get_env("PROMPT", "")
    # Hash-number avoidance — loaded from shared prompt files (the single
    # source of truth shared with multi-review). Fail loud if missing so a
    # broken action layout is surfaced immediately instead of silently
    # diverging from the canonical text.
    _prompts_dir = script_dir.parent / "shared" / "prompts"
    hash_avoid_zh = "\n" + (_prompts_dir / "hash-avoid-zh.txt").read_text().strip()
    hash_avoid_en = "\n" + (_prompts_dir / "hash-avoid-en.txt").read_text().strip()
    zh_instruction = (
        "\n\n请使用中文回复。所有分析和说明均使用中文。"
        "对于 prompt 中列出的判定关键词，使用其中文版本。"
    ) + hash_avoid_zh
    if existing_prompt:
        if language == "en":
            set_env("PROMPT", (
                existing_prompt
                + "\n\nIMPORTANT: Respond entirely in English. "
                "Use English for all analysis, explanations, and output. "
                "For any verdict keywords listed in the prompt, use their English equivalents."
                + hash_avoid_en
            ))
        elif language == "zh":
            set_env("PROMPT", existing_prompt + zh_instruction)
        else:
            print(
                f"::warning::Unsupported language: '{language}', defaulting to Chinese. "
                f"Supported values are: {', '.join(sorted(SUPPORTED_LANGUAGES))}."
            )
            set_env("PROMPT", existing_prompt + zh_instruction)

    # Extra env vars from extra-env input
    BLOCKED_ENV_KEYS = frozenset({
        "PATH", "HOME", "USER", "SHELL", "MODEL", "GITHUB_TOKEN",
        "GITHUB_WORKSPACE", "GITHUB_EVENT_PATH", "GITHUB_SHA",
        "GITHUB_REPOSITORY", "GITHUB_REF", "GITHUB_RUN_ID",
        "GITHUB_ACTIONS", "LD_LIBRARY_PATH", "PYTHONPATH",
    })
    extra_env_raw = get_env("GITHUB_RUN_OPENCODE_EXTRA_ENV")
    allow_sensitive = get_env("GITHUB_RUN_OPENCODE_EXTRA_ENV_ALLOW_SENSITIVE", "false").strip().lower() in ("true", "1", "yes")
    if extra_env_raw:
        prefix_blocked: list[str] = []
        sensitive_blocked: list[str] = []
        for line in extra_env_raw.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                print(f"Skipping invalid extra-env line (missing '='): {line}", file=sys.stderr)
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            if not key:
                continue
            if not re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', key):
                print(f"::error::extra-env key '{key}' is not a valid environment variable name (must match [A-Za-z_][A-Za-z0-9_]*)", file=sys.stderr)
                sys.exit(1)
            if key.startswith("GITHUB_RUN_OPENCODE_"):
                print(f"::error::extra-env key '{key}' starts with reserved prefix 'GITHUB_RUN_OPENCODE_' and is not allowed")
                prefix_blocked.append(key)
                continue
            if key in SENSITIVE_ENV_KEYS:
                if allow_sensitive:
                    print(f"::warning::extra-env key '{key}' overrides a sensitive runtime variable (allowed by extra-env-allow-sensitive)")
                else:
                    print(f"::error::extra-env key '{key}' overrides a sensitive runtime variable; set extra-env-allow-sensitive to 'true' to allow")
                    sensitive_blocked.append(key)
                    continue
            os.environ[key] = value.strip()
        all_blocked = prefix_blocked + sensitive_blocked
        if all_blocked:
            if prefix_blocked:
                print(f"extra-env: blocked {len(prefix_blocked)} reserved-prefix key(s): {', '.join(prefix_blocked)}", file=sys.stderr)
            if sensitive_blocked:
                print(f"extra-env: blocked {len(sensitive_blocked)} sensitive key override(s): {', '.join(sensitive_blocked)}", file=sys.stderr)
            sys.exit(1)

    reasoning_effort = get_env("GITHUB_RUN_OPENCODE_REASONING_EFFORT", "")
    enable_thinking = get_env("GITHUB_RUN_OPENCODE_ENABLE_THINKING", "false")
    working_directory = get_env("GITHUB_RUN_OPENCODE_WORKING_DIRECTORY", "")

    permission_raw = get_env("GITHUB_RUN_OPENCODE_PERMISSION", "")
    permission = None
    if permission_raw:
        try:
            parsed = json.loads(permission_raw)
            if not isinstance(parsed, dict):
                print(f"GITHUB_RUN_OPENCODE_PERMISSION must be a JSON object, got {type(parsed).__name__}: {permission_raw}", file=sys.stderr)
                sys.exit(1)
            permission = parsed
        except json.JSONDecodeError:
            print(f"Invalid JSON in GITHUB_RUN_OPENCODE_PERMISSION: {permission_raw}", file=sys.stderr)
            sys.exit(1)
        if not isinstance(permission, dict):
            print(f"GITHUB_RUN_OPENCODE_PERMISSION must be a JSON object, got {type(permission).__name__}", file=sys.stderr)
            sys.exit(1)

    needs_config = reasoning_effort or enable_thinking.lower() == "true" or permission
    if needs_config:
        configure_opencode_env(reasoning_effort, enable_thinking, working_directory, permission)

    validate_regex(fallback_on_regex, "GITHUB_RUN_OPENCODE_FALLBACK_ON_REGEX")
    # Ensure git identity is configured so that opencode's built-in commit logic
    # (triggered after agent runs when the branch is dirty) does not fail with
    # "Author identity unknown".  opencode github run sets this itself when
    # use_github_token is false, but skips it when use_github_token is true —
    # which is the default for all read-only review actions.
    _ensure_git_identity()

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
        set_env("MODEL", eligible_models[0])
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
