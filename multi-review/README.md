# OpenCode Multi-Review Action

Multi-agent parallel code review with coordinator synthesis. Runs multiple reviewer personas in parallel, then synthesizes a unified report.

## Quick Start

```yaml
- uses: sun-praise/opencode-actions/multi-review@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
```

This runs 2 reviewers in parallel (quality + security) and a coordinator that synthesizes the final review.

## How It Works

```
                    ┌─────────────────┐
                    │  Reviewer #1    │  quality
                    ├─────────────────┤
                    │  Reviewer #2    │  security
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Coordinator    │  synthesis + debate
                    └─────────────────┘
```

1. **Parallel Reviewers**: Each reviewer runs an independent `opencode github run` with a domain-specific prompt (quality, security, performance, architecture). Reviewers run in parallel on the same runner.

2. **Coordinator Synthesis**: After all reviewers complete, a coordinator agent receives all outputs, deduplicates findings, resolves conflicts, and produces a unified report with cross-validation markers.

3. **PR Comment**: The final output is posted as a single PR comment with the coordinator's synthesis plus collapsible sections for each reviewer's raw output.

## Configuration

### Built-in Reviewer Personas

| Persona | Focus |
|---------|-------|
| `quality` | Code quality, bugs, logic errors, style |
| `security` | Input validation, injection, OWASP Top 10 |
| `performance` | Algorithm complexity, memory, I/O |
| `architecture` | Coupling, layering, module placement |

### Default Team

Without configuration, the default team is `quality:1,security:1`.

### Custom Team via `default-team`

```yaml
- uses: sun-praise/opencode-actions/multi-review@v1
  with:
    default-team: "quality:1,security:1,performance:1"
```

Format: `persona:count,...` where `count` is the number of redundant instances.

### Custom Reviewer Config File

Create a YAML file (e.g. `.github/reviewers.yaml`):

```yaml
# Override or add custom personas
personas:
  - name: api-design
    prompt: |
      Review this pull request for API design quality...
      (same format as built-in prompts)

# Define the reviewer team
reviewers:
  - name: quality
    count: 2   # 2 instances for redundancy
  - name: security
    count: 1
  - name: api-design
    count: 1   # uses the custom persona above
```

Then reference it:

```yaml
- uses: sun-praise/opencode-actions/multi-review@v1
  with:
    reviewer-config: .github/reviewers.yaml
```

Custom personas override built-in personas with the same name.

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `timeout-seconds` | `900` | Global timeout for the entire process |
| `coordinator-timeout-seconds` | `300` | Coordinator agent timeout |
| `model` | `zhipuai-coding-plan/glm-5.1` | Model for all agents |
| `fallback-models` | `""` | Comma-separated fallback models |
| `model-timeout-seconds` | `300` | Per-model timeout before rotating to fallback |
| `fallback-on-regex` | `timed out\|timeout\|...` | Rotate to next fallback model when output matches this regex |
| `default-team` | `""` | Team definition string |
| `reviewer-config` | `""` | Path to custom YAML config |
| `coordinator-prompt` | `""` | Custom coordinator prompt template |
| `attempts` | `3` | Total attempts per reviewer |
| `retry-profile` | `github-network` | Built-in retry preset |
| `retry-delay-seconds` | `15` | Base delay between retries |
| `reasoning-effort` | `max` | Reasoning effort level |
| `enable-thinking` | `true` | Enable thinking mode |
| `use-github-token` | `true` | Whether to use GitHub token for PR access |
| `github-token` | `""` | GitHub token |
| `zhipu-api-key` | `""` | ZhipuAI API key |
| `deepseek-api-key` | `""` | DeepSeek API key |
| `opencode-go-api-key` | `""` | OpenCode Go API key |
| `extra-env` | `""` | Extra KEY=VALUE environment variables |
| `cleanup-error-comments` | `true` | Auto-delete error comments from failed runs |

## Cost Consideration

Running N reviewers + 1 coordinator means approximately (N+1)x the token cost of a single review. Default N=2 means ~3x cost.

## Requirements

- Linux runner
- Python 3 (pre-installed on GitHub-hosted runners)
- OpenCode CLI (installed automatically by the action)
