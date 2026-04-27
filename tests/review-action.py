#!/usr/bin/env python3

import difflib
import re
import sys
from pathlib import Path

repo_root = Path(__file__).resolve().parent.parent


def extract_prompt_default(action_file: Path) -> str:
    text = action_file.read_text()
    m = re.search(
        r"^  prompt:\s*\n    default:\s*\|\s*\n((?:(?<=\n)      .*\n)*)",
        text,
        re.MULTILINE,
    )
    if not m:
        return ""
    lines = m.group(1).splitlines()
    return "\n".join(line[6:] for line in lines) + "\n"


def extract_field(action_file: Path, field: str) -> str:
    text = action_file.read_text()
    m = re.search(
        rf"^  {re.escape(field)}:\s*\n(?:    .*\n)*?    default:\s*(.+)$",
        text,
        re.MULTILINE,
    )
    if not m:
        return ""
    return m.group(1).strip()


def has_input(action_file: Path, field: str) -> bool:
    text = action_file.read_text()
    return bool(re.search(rf"^  {re.escape(field)}:\s*$", text, re.MULTILINE))


github_run = repo_root / "github-run-opencode" / "action.yml"
review = repo_root / "review" / "action.yml"

failed = False


def check(name: str, condition: bool, msg: str) -> None:
    global failed
    if not condition:
        print(f"FAIL: {msg}", file=sys.stderr)
        failed = True
    else:
        print(f"  ok: {name}")


github_run_prompt = extract_prompt_default(github_run)
review_prompt = extract_prompt_default(review)

if github_run_prompt and review_prompt:
    if github_run_prompt != review_prompt:
        diff = difflib.unified_diff(
            github_run_prompt.splitlines(keepends=True),
            review_prompt.splitlines(keepends=True),
            fromfile="github-run-opencode/action.yml",
            tofile="review/action.yml",
        )
        print("FAIL: review/action.yml prompt default must match github-run-opencode/action.yml", file=sys.stderr)
        sys.stderr.writelines(diff)
        failed = True
    else:
        print("  ok: prompt defaults match")
elif github_run_prompt or review_prompt:
    print("  ok: prompt defaults differ (one is empty, one has a built-in default)")

check("review model default is empty", extract_field(review, "model") == '""', "review/action.yml model default is not empty")
check("github-run-opencode has timeout-seconds", has_input(github_run, "timeout-seconds"), "github-run-opencode/action.yml is missing timeout-seconds input")
check("review has timeout-seconds", has_input(review, "timeout-seconds"), "review/action.yml is missing timeout-seconds input")
check("github-run-opencode timeout default 600", extract_field(github_run, "timeout-seconds") == '"600"', "github-run-opencode/action.yml timeout-seconds default is not 600")
check("review timeout default 600", extract_field(review, "timeout-seconds") == '"600"', "review/action.yml timeout-seconds default is not 600")

if failed:
    sys.exit(1)

print("review action metadata test passed")
