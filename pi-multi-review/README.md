# Pi Multi-Review Action

Multi-agent parallel PR review using [pi-coding-agent-action](https://github.com/shaftoe/pi-coding-agent-action) with [pi-parallel-agents](https://github.com/messense/pi-parallel-agents) team mode.

Multiple reviewer agents (quality, security, performance, architecture) review your PR simultaneously, then a synthesizer agent produces a single consolidated review comment.

## Usage

```yaml
name: Pi Multi-Review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  issue_comment:
    types: [created]

jobs:
  multi-review:
    if: >
      (github.event_name == 'pull_request' && github.event.pull_request.draft == false) ||
      (github.event_name == 'issue_comment' && github.event.issue.pull_request != null && startsWith(github.event.comment.body, '/multi-review'))
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v6

      - uses: Svtter/opencode-actions/pi-multi-review@v2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          provider: anthropic
          model: claude-sonnet-4-6
          api-key: ${{ secrets.PI_API_KEY }}
          language: Chinese
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | Yes | - | GitHub token for API access |
| `provider` | Yes | - | LLM provider (openai, anthropic, google, etc.) |
| `model` | No | `claude-sonnet-4-6` | Default model for all reviewers |
| `api-key` | No | - | LLM provider API key |
| `reviewers-config` | No | `""` | Inline YAML to override default reviewer personas |
| `max-tokens` | No | `4096` | Max tokens per reviewer response |
| `pi-action-version` | No | `v2` | Version of shaftoe/pi-coding-agent-action |
| `diff-max-lines` | No | `2000` | Max diff lines included in review |
| `diff-ignore-patterns` | No | `""` | File patterns to exclude from diffs |
| `base-url` | No | `""` | Provider base URL override (for proxies) |
| `thinking-level` | No | `medium` | Model thinking level (off, low, medium, high) |
| `language` | No | `Chinese` | Output language for reviews |
| `trigger-phrase` | No | `/multi-review` | Trigger phrase for comment mode |

## Default Reviewers

When no `reviewers-config` is provided, 4 built-in reviewers run in parallel:

| Reviewer | Focus |
|----------|-------|
| **quality** | Readability, naming, error handling, DRY, dead code |
| **security** | Input validation, injection, OWASP Top 10, secrets exposure |
| **performance** | Algorithmic complexity, N+1 queries, memory, caching |
| **architecture** | Coupling, separation of concerns, API design, scalability |

A **synthesizer** agent merges all findings into one structured PR comment with:
- Merge decision (可合并 / 有条件合并 / 不可合并)
- Critical issues, warnings, suggestions
- Cross-validated findings (flagged by multiple reviewers)

## Custom Reviewers

Provide your own reviewers via `reviewers-config`:

```yaml
- uses: Svtter/opencode-actions/pi-multi-review@v2
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    provider: anthropic
    api-key: ${{ secrets.PI_API_KEY }}
    reviewers-config: |
      reviewers:
        - name: security
          role: Security Expert
          prompt: |
            Focus only on security vulnerabilities in this diff:
            {{diff}}

            Report critical, warning, and info findings.
        - name: testing
          role: Test Coverage Analyst
          prompt: |
            Check test coverage for changes in this diff:
            {{diff}}

            Are new code paths adequately tested?
      synthesizer:
        name: synthesizer
        role: Review Synthesizer
        prompt: |
          Combine these findings into a structured review:
          {task:security-review}
          {task:testing-review}
          Output as markdown.
```

## Template Variables

Reviewer prompts support these placeholders:

| Variable | Description |
|----------|-------------|
| `{{diff}}` | Full PR diff |
| `{{title}}` | PR title |
| `{{body}}` | PR description |
| `{{files}}` | List of changed files |
| `{{language}}` | Configured output language |

Synthesizer prompts can reference reviewer outputs with `{task:<name>-review}`.

## Requirements

- GitHub Actions runner with Python 3 (available on `ubuntu-latest`)
- A valid LLM API key for the configured provider
