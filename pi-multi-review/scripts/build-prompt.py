#!/usr/bin/env python3
"""Build the pi-parallel-agents team-mode DAG prompt for multi-review.

Reads reviewer persona configs (custom or default), constructs a JSON team
DAG with all reviewers running in parallel and a synthesizer that depends on
them all, then writes the prompt to a file for the pi-coding-agent-action.
"""

import argparse
import json
import sys
from pathlib import Path

import yaml  # PyYAML is available on GitHub Actions runners


def load_default_reviewers(action_path: str) -> dict:
    """Load built-in default reviewer personas."""
    default_path = Path(action_path) / "reviewers" / "default.yml"
    if not default_path.exists():
        print(f"error: default reviewers not found at {default_path}", file=sys.stderr)
        sys.exit(1)
    with open(default_path) as f:
        return yaml.safe_load(f)


def load_custom_reviewers(config_str: str) -> dict:
    """Parse inline YAML reviewer config."""
    return yaml.safe_load(config_str)


def build_team_dag(config: dict, default_model: str, language: str, max_tokens: int = 4096) -> dict:
    """Build the pi-parallel-agents team-mode DAG from reviewer config."""
    reviewers = config.get("reviewers", [])
    synthesizer_cfg = config.get("synthesizer", None)

    if not reviewers:
        print("error: no reviewers defined", file=sys.stderr)
        sys.exit(1)

    # Build team members
    members = []
    for r in reviewers:
        member = {
            "role": r["name"],
            "model": r.get("model", default_model),
            "maxTokens": r.get("maxTokens", max_tokens),
        }
        members.append(member)

    # Add synthesizer member if defined
    if synthesizer_cfg:
        members.append({
            "role": synthesizer_cfg["name"],
            "model": synthesizer_cfg.get("model", default_model),
            "maxTokens": max_tokens,
        })

    # Build tasks: all reviewers run in parallel
    tasks = []
    for r in reviewers:
        task_prompt = r.get("prompt", "")
        # Replace template variables (pi-coding-agent-action handles {{diff}} etc.)
        task_prompt = task_prompt.replace("{{language}}", language)
        tasks.append({
            "id": f"{r['name']}-review",
            "assignee": r["name"],
            "task": task_prompt,
        })

    # Add synthesizer task that depends on all reviewers
    if synthesizer_cfg:
        synth_prompt = synthesizer_cfg.get("prompt", "")
        synth_prompt = synth_prompt.replace("{{language}}", language)
        tasks.append({
            "id": "synthesize",
            "assignee": synthesizer_cfg["name"],
            "task": synth_prompt,
            "depends": [t["id"] for t in tasks],
        })

    return {
        "team": {
            "objective": f"Multi-agent PR review with {len(reviewers)} parallel reviewers",
            "members": members,
            "tasks": tasks,
        }
    }


def main():
    parser = argparse.ArgumentParser(description="Build pi-multi-review prompt")
    parser.add_argument("--reviewers-config", default="", help="Inline YAML reviewer config")
    parser.add_argument("--default-model", default="claude-sonnet-4-6")
    parser.add_argument("--language", default="Chinese")
    parser.add_argument("--max-tokens", default="4096")
    parser.add_argument("--action-path", required=True)
    parser.add_argument("--output", required=True, help="Output file path for the prompt")
    args = parser.parse_args()

    # Load config: custom overrides default
    if args.reviewers_config.strip():
        config = load_custom_reviewers(args.reviewers_config)
    else:
        config = load_default_reviewers(args.action_path)

    # Build DAG
    dag = build_team_dag(config, args.default_model, args.language, int(args.max_tokens))

    # Write prompt as JSON string for pi-parallel-agents team mode
    prompt = json.dumps(dag, ensure_ascii=False, indent=2)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(prompt)
    print(f"Prompt written to {args.output}")


if __name__ == "__main__":
    main()
