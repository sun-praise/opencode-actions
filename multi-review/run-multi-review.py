#!/usr/bin/env python3
"""Multi-agent review orchestrator.

Launches multiple reviewer agents in parallel, collects their outputs,
then runs a coordinator agent to synthesize a final review report.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:
    yaml = None

SCRIPT_DIR = Path(__file__).resolve().parent
BUILTIN_REVIEWERS_DIR = SCRIPT_DIR / "reviewers"


def get_env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def set_env(name: str, value: str) -> None:
    if value:
        os.environ[name] = value


def load_builtin_persona(name: str) -> dict[str, Any] | None:
    path = BUILTIN_REVIEWERS_DIR / f"{name}.yaml"
    if not path.exists():
        return None
    return _load_persona_file(path)


def _load_persona_file(path: Path) -> dict[str, Any] | None:
    if yaml:
        with open(path) as f:
            data = yaml.safe_load(f)
    else:
        data = _parse_simple_yaml(path)
    if data and "prompt" in data:
        return data
    return None


def _parse_simple_yaml(path: Path) -> dict[str, Any] | None:
    """Minimal YAML parser for persona files (no PyYAML dependency)."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None

    def _flush(result, key, lines):
        if key and lines:
            result[key] = "\n".join(lines).strip()

    result: dict[str, Any] = {}
    current_key = None
    current_lines: list[str] = []

    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if line.startswith("name:"):
            _flush(result, current_key, current_lines)
            current_key = "name"
            current_lines = [stripped[len("name:"):].strip().strip('"').strip("'")]
        elif line.startswith("prompt:"):
            _flush(result, current_key, current_lines)
            current_key = "prompt"
            current_lines = []
        elif line.startswith("  ") or line.startswith("\t"):
            current_lines.append(line[2:] if line.startswith("  ") else line[1:])
        else:
            _flush(result, current_key, current_lines)
            current_key = None
            current_lines = []

    _flush(result, current_key, current_lines)
    return result if result else None


def resolve_reviewers(
    config_path: str | None,
    default_team: str | None,
) -> list[dict[str, Any]]:
    """Resolve the full reviewer team from config file and defaults."""
    personas: dict[str, dict[str, Any]] = {}

    # Load built-in personas
    for persona_file in BUILTIN_REVIEWERS_DIR.glob("*.yaml"):
        data = _load_persona_file(persona_file)
        if data and data.get("name"):
            personas[data["name"]] = data

    # Load custom config (overrides built-in)
    custom_reviewers: list[dict[str, Any]] = []
    if config_path:
        custom_path = Path(config_path)
        if not custom_path.exists():
            print(f"Reviewer config file not found: {config_path}", file=sys.stderr)
            sys.exit(1)
        if yaml:
            with open(custom_path) as f:
                custom_data = yaml.safe_load(f) or {}
        else:
            custom_data = _parse_simple_yaml(custom_path) or {}

        # Load custom persona definitions
        custom_personas = custom_data.get("personas", [])
        for p in custom_personas:
            if isinstance(p, dict) and p.get("name") and p.get("prompt"):
                personas[p["name"]] = p

        # Load reviewer team from custom config
        custom_reviewers = custom_data.get("reviewers", [])

    # Parse default_team string (e.g. "quality:1,security:1")
    team: list[dict[str, Any]] = []
    if custom_reviewers:
        for r in custom_reviewers:
            if isinstance(r, dict) and r.get("name"):
                team.append(r)
    elif default_team:
        team = _parse_team_string(default_team, personas)
    else:
        # Default: quality + security
        team = [
            {"name": "quality", "count": 1},
            {"name": "security", "count": 1},
        ]

    # Resolve each team entry into concrete reviewer instances
    instances: list[dict[str, Any]] = []
    for entry in team:
        name = entry.get("name", "")
        count = int(entry.get("count", 1))
        persona = personas.get(name)
        if not persona:
            print(f"Unknown reviewer persona: {name}", file=sys.stderr)
            continue
        for i in range(count):
            label = f"{name}-{i+1}" if count > 1 else name
            instances.append({
                "name": label,
                "persona": name,
                "prompt": persona.get("prompt", ""),
            })

    if not instances:
        print("No reviewers resolved. Check your configuration.", file=sys.stderr)
        sys.exit(1)

    return instances


def _parse_team_string(team_str: str, personas: dict) -> list[dict[str, Any]]:
    """Parse 'quality:1,security:1,performance:2' format."""
    team: list[dict[str, Any]] = []
    for part in team_str.split(","):
        part = part.strip()
        if not part:
            continue
        if ":" in part:
            name, count_str = part.rsplit(":", 1)
            name = name.strip()
            try:
                count = int(count_str.strip())
            except ValueError:
                count = 1
        else:
            name = part
            count = 1
        if not personas.get(name):
            print(f"Warning: unknown persona '{name}', skipping", file=sys.stderr)
            continue
        team.append({"name": name, "count": count})
    return team


def _run_opencode(prompt: str, model: str, timeout: int, cache_dir: str | None = None) -> tuple[int, str]:
    """Run opencode github run directly. Returns (returncode, stdout).

    Each invocation gets its own git worktree to prevent lock file race
    conditions between parallel reviewers sharing the same .git directory.
    """
    env = os.environ.copy()
    env["MODEL"] = model
    env["PROMPT"] = prompt
    env["USE_GITHUB_TOKEN"] = "true"

    if cache_dir:
        env["XDG_CACHE_HOME"] = cache_dir

    # Create a detached HEAD worktree so this reviewer has an isolated .git
    worktree_dir = tempfile.mkdtemp(prefix="opencode-worktree-")
    try:
        subprocess.run(
            ["git", "worktree", "add", "--detach", worktree_dir, "HEAD"],
            capture_output=True, check=False,
        )
        return _run_opencode_in_worktree(worktree_dir, env, timeout)
    finally:
        subprocess.run(["git", "worktree", "remove", "--force", worktree_dir],
                       capture_output=True, check=False)


def _run_opencode_in_worktree(worktree_dir: str, env: dict[str, str], timeout: int) -> tuple[int, str]:
    """Execute opencode CLI inside the given worktree directory."""
    opencode_bin = env.get("OPENCODE_BIN_PATH", "opencode")
    cmd = [opencode_bin, "github", "run", "--print-logs", "--log-level", "ERROR"]

    if timeout > 0:
        cmd = ["timeout", "--foreground", f"{timeout}s"] + cmd
        sub_timeout = timeout + 30
    else:
        sub_timeout = None

    result = subprocess.run(cmd, cwd=worktree_dir, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=sub_timeout)
    stderr_output = result.stderr.decode("utf-8", errors="replace")
    if stderr_output.strip():
        print(f"[opencode stderr] {stderr_output[:500]}", file=sys.stderr)
    return result.returncode, result.stdout.decode("utf-8", errors="replace")


def run_reviewer(
    reviewer: dict[str, Any],
    global_deadline: float | None,
    model_timeout: int,
    fallback_models: list[str],
    fallback_on_regex: str,
) -> dict[str, Any]:
    """Run a single reviewer agent with model fallback, return result dict."""
    name = reviewer["name"]
    prompt = reviewer["prompt"]

    model = os.environ.get("MODEL", "zhipuai-coding-plan/glm-5.1")
    candidates = [m for m in [model] + fallback_models if _supports_model(m)]

    if not candidates:
        return {"name": name, "status": "error", "output": "No eligible models available"}

    # Isolate XDG cache to prevent SQLite conflicts between parallel reviewers
    cache_dir = tempfile.mkdtemp(prefix=f"opencode-review-{name}-")
    try:
        return _run_reviewer_inner(name, prompt, candidates, cache_dir,
                                   global_deadline, model_timeout, fallback_on_regex)
    finally:
        shutil.rmtree(cache_dir, ignore_errors=True)


def _run_reviewer_inner(
    name: str,
    prompt: str,
    candidates: list[str],
    cache_dir: str,
    global_deadline: float | None,
    model_timeout: int,
    fallback_on_regex: str,
) -> dict[str, Any]:
    outputs: list[str] = []
    for m in candidates:
        if global_deadline:
            remaining = max(0, global_deadline - time.time())
            if remaining <= 0:
                return {"name": name, "status": "timeout", "output": "Global timeout exceeded"}
            effective_timeout = min(model_timeout, int(remaining)) if model_timeout > 0 else int(remaining)
        elif model_timeout > 0:
            effective_timeout = model_timeout
        else:
            effective_timeout = 0

        try:
            rc, output = _run_opencode(prompt, m, effective_timeout, cache_dir=cache_dir)

            if rc == 0:
                return {"name": name, "status": "success", "output": output}

            if rc == 124:
                print(f"Reviewer {name} model {m} timed out after {effective_timeout}s", file=sys.stderr)
                outputs.append(output)
                continue

            if fallback_on_regex and re.search(fallback_on_regex, output, re.IGNORECASE):
                print(f"Reviewer {name} model {m} matched fallback regex, trying next", file=sys.stderr)
                outputs.append(output)
                continue

            return {"name": name, "status": "error", "output": output, "returncode": rc}

        except subprocess.TimeoutExpired:
            print(f"Reviewer {name} model {m} process killed (timeout)", file=sys.stderr)
            continue
        except Exception as e:
            print(f"Reviewer {name} model {m} failed: {e}", file=sys.stderr)
            continue

    return {"name": name, "status": "error", "output": "\n".join(outputs) if outputs else "All models failed"}


def _supports_model(model: str) -> bool:
    if model.startswith("zhipuai"):
        return bool(os.environ.get("ZHIPU_API_KEY"))
    if model.startswith("opencode-go"):
        return bool(os.environ.get("OPENCODE_API_KEY"))
    if model.startswith("deepseek"):
        return bool(os.environ.get("DEEPSEEK_API_KEY"))
    return True


def run_coordinator(
    reviewer_results: list[dict[str, Any]],
    timeout: int,
    coordinator_prompt_template: str | None,
) -> str | None:
    """Run the coordinator agent to synthesize all reviewer outputs."""
    reviews_text = "\n".join(
        f"\n--- Reviewer: {r['name']} (status: {r['status']}) ---\n{_strip_ansi(r.get('output', ''))}\n"
        for r in reviewer_results
    )

    if coordinator_prompt_template:
        prompt = coordinator_prompt_template.replace("{{REVIEWS}}", reviews_text)
    else:
        prompt = _default_coordinator_prompt(reviews_text)

    try:
        rc, output = _run_opencode(prompt, os.environ.get("MODEL", ""), timeout)
        if rc == 0:
            return output
        print(f"Coordinator failed (exit {rc}): {output[:500]}", file=sys.stderr)
        return None
    except subprocess.TimeoutExpired:
        print("Coordinator timed out", file=sys.stderr)
        return None
    except Exception as e:
        print(f"Coordinator failed: {e}", file=sys.stderr)
        return None


def _default_coordinator_prompt(reviews_text: str) -> str:
    return f"""You are a code review coordinator. Synthesize the following reviewer reports into a single unified review.

Rules:
1. Deduplicate findings across reviewers. If multiple reviewers report the same issue, mark it as "多 reviewer 确认".
2. Resolve conflicts: if reviewers disagree, use your judgment and note the disagreement.
3. Keep only genuine issues, discard false positives.
4. Categorize findings into "阻塞项" (blocking) and "建议项" (suggestions).
5. Include the source reviewer name for each finding.

{reviews_text}

Please respond in Chinese. DO NOT modify any code.
The first line of your response must be exactly one of:
- 可合并
- 有条件合并
- 不可合并

Output format:
- First line: the final decision only
- Then a summary synthesizing all reviewer perspectives
- Then "阻塞项" listing issues that must block merge; if none, write "阻塞项：无"
- Then "建议项" listing non-blocking improvements; if none, write "建议项：无"
"""


def _strip_ansi(raw: str) -> str:
    """Remove ANSI escape sequences from CLI output."""
    text = re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", raw)
    return text.strip()


def _truncate(text: str, limit: int = 8000) -> str:
    text = text.strip()
    if len(text) > limit:
        return text[:limit] + "\n... (output truncated)"
    return text


def format_pr_comment(coordinator_output: str, reviewer_results: list[dict[str, Any]]) -> str:
    """Format the final PR comment with coordinator output and collapsible reviewer details."""
    parts = [_strip_ansi(coordinator_output).strip(), "\n\n---\n**详细审查报告：**\n"]
    for r in reviewer_results:
        status_label = "✅" if r["status"] == "success" else "⚠️"
        output = _truncate(_strip_ansi(r.get("output", "")))
        parts.append(
            f"\n<details>\n<summary>{status_label} {r['name']}</summary>\n\n{output}\n</details>\n"
        )
    return "".join(parts)


def post_fallback_comment(reviewer_results: list[dict[str, Any]]) -> str:
    """Format a fallback comment with raw reviewer outputs when coordinator fails."""
    parts = ["⚠️ Coordinator agent failed. Showing raw reviewer outputs:\n"]
    for r in reviewer_results:
        output = _truncate(_strip_ansi(r.get("output", "")))
        parts.append(f"\n### {r['name']} ({r['status']})\n\n{output}\n")
    return "".join(parts)


def _get_pr_context() -> tuple[str, str] | None:
    """Return (pr_number, repository) if running in a PR context, else None."""
    github_ref = get_env("GITHUB_REF", "")
    github_repository = get_env("GITHUB_REPOSITORY", "")
    match = re.fullmatch(r"refs/pull/(\d+)/merge", github_ref)
    if not match or not github_repository:
        return None
    return match.group(1), github_repository


def post_pr_comment(body: str) -> bool:
    """Post a comment to the current PR using gh CLI. Returns True on success."""
    ctx = _get_pr_context()
    if not ctx:
        return False
    pr_number, repository = ctx

    gh_path = shutil.which("gh")
    if not gh_path:
        return False

    try:
        result = subprocess.run(
            [gh_path, "pr", "comment", pr_number, "--repo", repository, "--body", body],
            capture_output=True, text=True, env=os.environ.copy(), timeout=30,
        )
        if result.returncode == 0:
            print(f"Posted synthesized review comment to PR #{pr_number}", file=sys.stderr)
            return True
        print(f"Failed to post PR comment: {result.stderr}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"Failed to post PR comment: {e}", file=sys.stderr)
        return False


def cleanup_error_comments() -> None:
    """Delete error comments posted by opencode to the current PR."""
    enabled = get_env("MULTI_REVIEW_CLEANUP_ERROR_COMMENTS", "true")
    if enabled.lower() != "true":
        return

    ctx = _get_pr_context()
    if not ctx:
        return
    pr_number, repository = ctx

    github_run_id = get_env("GITHUB_RUN_ID", "")
    if not github_run_id:
        return

    gh_path = shutil.which("gh")
    if not gh_path:
        return

    run_link_pattern = f"/{repository}/actions/runs/{github_run_id}"
    error_indicators = re.compile(
        r"(fatal:|remote:|error:\s*\d{3}|unable to access|Write access|permission denied)",
        re.IGNORECASE,
    )

    try:
        result = subprocess.run(
            [gh_path, "api", "-H", "Accept: application/vnd.github+json",
             f"/repos/{repository}/issues/{pr_number}/comments"],
            capture_output=True, text=True, env=os.environ.copy(), timeout=30,
        )
        if result.returncode != 0:
            return
        comments = json.loads(result.stdout)
    except Exception:
        return

    for comment in comments:
        comment_id = comment.get("id")
        comment_body = comment.get("body", "")
        if not comment_id or not comment_body:
            continue
        if run_link_pattern not in comment_body or not error_indicators.search(comment_body):
            continue
        try:
            subprocess.run(
                [gh_path, "api", "-X", "DELETE",
                 f"/repos/{repository}/issues/comments/{comment_id}"],
                capture_output=True, text=True, env=os.environ.copy(), timeout=10,
            )
        except Exception:
            pass


def main() -> int:
    try:
        return _main()
    finally:
        try:
            cleanup_error_comments()
        except Exception:
            pass


def _main() -> int:
    # --- Parse configuration from env ---
    config_path = get_env("MULTI_REVIEW_CONFIG", "")
    default_team = get_env("MULTI_REVIEW_DEFAULT_TEAM", "")
    global_timeout = int(get_env("MULTI_REVIEW_TIMEOUT_SECONDS", "900"))
    model_timeout = int(get_env("MULTI_REVIEW_MODEL_TIMEOUT_SECONDS", "300"))
    coordinator_timeout = int(get_env("MULTI_REVIEW_COORDINATOR_TIMEOUT_SECONDS", "300"))
    fallback_models_str = get_env("MULTI_REVIEW_FALLBACK_MODELS", "")
    fallback_on_regex = get_env(
        "MULTI_REVIEW_FALLBACK_ON_REGEX",
        "timed out|timeout|deadline exceeded|context deadline exceeded|operation timed out|connection timed out",
    )
    coordinator_prompt_template = get_env("MULTI_REVIEW_COORDINATOR_PROMPT", "")

    # Core opencode env — forward MULTI_REVIEW_* → standard env vars
    env_forward = {
        "OPENCODE_WORKING_DIRECTORY": ("MULTI_REVIEW_WORKING_DIRECTORY", ""),
        "OPENCODE_ATTEMPTS": ("MULTI_REVIEW_ATTEMPTS", "3"),
        "OPENCODE_RETRY_PROFILE": ("MULTI_REVIEW_RETRY_PROFILE", "github-network"),
        "OPENCODE_RETRY_DELAY_SECONDS": ("MULTI_REVIEW_RETRY_DELAY_SECONDS", "15"),
        "USE_GITHUB_TOKEN": ("MULTI_REVIEW_USE_GITHUB_TOKEN", "true"),
        "GITHUB_TOKEN": ("MULTI_REVIEW_GITHUB_TOKEN", ""),
        "ZHIPU_API_KEY": ("MULTI_REVIEW_ZHIPU_API_KEY", ""),
        "OPENCODE_API_KEY": ("MULTI_REVIEW_OPENCODE_GO_API_KEY", ""),
        "DEEPSEEK_API_KEY": ("MULTI_REVIEW_DEEPSEEK_API_KEY", ""),
    }
    for target, (source, default) in env_forward.items():
        set_env(target, get_env(source, default))

    # Model resolution
    if get_env("MULTI_REVIEW_MODEL"):
        os.environ["MODEL"] = get_env("MULTI_REVIEW_MODEL")
    elif get_env("MODEL_NAME"):
        os.environ["MODEL"] = get_env("MODEL_NAME")
    else:
        os.environ["MODEL"] = "zhipuai-coding-plan/glm-5.1"

    # Configure opencode.json
    reasoning_effort = get_env("MULTI_REVIEW_REASONING_EFFORT", "")
    enable_thinking = get_env("MULTI_REVIEW_ENABLE_THINKING", "true")
    working_directory = get_env("MULTI_REVIEW_WORKING_DIRECTORY", "")

    permission_raw = get_env("MULTI_REVIEW_PERMISSION", "")
    permission = None
    if permission_raw:
        try:
            permission = json.loads(permission_raw)
        except json.JSONDecodeError:
            print("Invalid JSON in MULTI_REVIEW_PERMISSION", file=sys.stderr)
            sys.exit(1)

    needs_config = reasoning_effort or enable_thinking.lower() == "true" or permission
    if needs_config:
        config_path_opencode = Path(working_directory) / "opencode.json" if working_directory else Path("opencode.json")
        config: dict = {}
        if config_path_opencode.exists():
            try:
                with open(config_path_opencode) as f:
                    config = json.load(f)
            except (json.JSONDecodeError, OSError):
                config = {}
        config.setdefault("agent", {}).setdefault("build", {}).setdefault("options", {})
        if reasoning_effort:
            config["agent"]["build"]["options"]["reasoningEffort"] = reasoning_effort
        if enable_thinking.lower() == "true":
            config["agent"]["build"]["options"]["thinking"] = {"type": "enabled"}
        if permission:
            config["agent"]["build"].setdefault("permission", {})
            for key, value in permission.items():
                if isinstance(value, dict) and isinstance(config["agent"]["build"]["permission"].get(key), dict):
                    config["agent"]["build"]["permission"][key].update(value)
                else:
                    config["agent"]["build"]["permission"][key] = value
        with open(config_path_opencode, "w") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
            f.write("\n")

    # Extra env vars
    for line in get_env("MULTI_REVIEW_EXTRA_ENV").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        if key.strip():
            os.environ[key.strip()] = value.strip()

    # --- Resolve reviewers ---
    reviewers = resolve_reviewers(config_path or None, default_team or None)
    print(f"Resolved {len(reviewers)} reviewer(s): {[r['name'] for r in reviewers]}", file=sys.stderr)

    fallback_models = [m.strip() for m in re.split(r"[\r\n,]+", fallback_models_str) if m.strip()]

    # --- Run reviewers in parallel ---
    global_deadline = time.time() + global_timeout if global_timeout > 0 else None

    reviewer_results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=len(reviewers)) as executor:
        futures = {}
        for reviewer in reviewers:
            f = executor.submit(
                run_reviewer,
                reviewer,
                global_deadline,
                model_timeout,
                fallback_models,
                fallback_on_regex,
            )
            futures[f] = reviewer["name"]

        for f in as_completed(futures):
            name = futures[f]
            try:
                result = f.result()
                reviewer_results.append(result)
                status = result["status"]
                print(f"Reviewer {name}: {status}", file=sys.stderr)
                if status == "error":
                    output = result.get("output", "")
                    print(f"Reviewer {name} output (first 500 chars): {output[:500]}", file=sys.stderr)
            except Exception as e:
                print(f"Reviewer {name} raised exception: {e}", file=sys.stderr)
                reviewer_results.append({"name": name, "status": "error", "output": str(e)})

    successful = [r for r in reviewer_results if r["status"] == "success"]
    if not successful:
        print("All reviewers failed", file=sys.stderr)
        return 1

    # --- Run coordinator ---
    remaining_time = 0
    if global_deadline:
        remaining_time = max(0, int(global_deadline - time.time()))
        if remaining_time <= 0:
            print("No time left for coordinator, posting raw outputs", file=sys.stderr)
            comment = post_fallback_comment(reviewer_results)
            post_pr_comment(comment)
            return 0

    coord_timeout = min(coordinator_timeout, remaining_time) if global_deadline else coordinator_timeout
    coordinator_output = run_coordinator(
        reviewer_results,
        coord_timeout,
        coordinator_prompt_template or None,
    )

    if coordinator_output:
        comment = format_pr_comment(coordinator_output, reviewer_results)
    else:
        print("Coordinator failed, posting raw reviewer outputs", file=sys.stderr)
        comment = post_fallback_comment(reviewer_results)

    # Post synthesized comment to PR
    posted = post_pr_comment(comment)
    if not posted:
        print("Could not post to PR via gh CLI, writing to stdout as fallback", file=sys.stderr)
        print(comment)

    return 0


if __name__ == "__main__":
    sys.exit(main())
