# OpenCode Multi-Review

Part of [`sun-praise/opencode-actions`](https://github.com/sun-praise/opencode-actions) — multi-agent parallel PR review powered by the OpenCode SDK, with a coordinator that synthesises all reviewer findings into one PR comment. Linux runners only.

## Quick start

```yaml
- name: Run OpenCode multi-review
  uses: sun-praise/opencode-actions/multi-review@v3
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    model: deepseek/deepseek-v4-flash
    default-team: "quality:1,security:1,performance:1"
    timeout-seconds: "900"
    coordinator-timeout-seconds: "300"
    deepseek-api-key: ${{ secrets.DEEPSEEK_API_KEY }}
```

## What it does

- Spawns N reviewer sessions in parallel via `@opencode-ai/sdk`
- Built-in reviewer personas: quality, security, performance, architecture
- A coordinator session reads all reviewer outputs and produces a deduplicated synthesis
- Each reviewer's full output is included in a collapsible `<details>` block
- Single `opencode serve` instance shared across sessions (one MCP cold start)
- Skips forked pull requests by default (no secrets exposed)

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `model` | empty | Model for all reviewers and coordinator (`provider/model`) |
| `default-team` | empty | Comma-separated team definition (e.g. `"quality:1,security:1,performance:1"`) |
| `timeout-seconds` | `900` | Global timeout for all reviewers in seconds |
| `coordinator-timeout-seconds` | `300` | Timeout for the coordinator synthesis step |
| `coordinator-prompt` | empty | Custom coordinator prompt; use `{{REVIEWS}}` as placeholder |
| `working-directory` | empty | Optional working directory before running review |
| `github-token` | empty | GitHub token for posting PR comments |
| `zhipu-api-key` | empty | Zhipu AI API key |
| `opencode-go-api-key` | empty | OpenCode Go API key |
| `minimax-api-key` | empty | MiniMax API key (not compatible with multi-review due to concurrency limits) |
| `deepseek-api-key` | empty | DeepSeek API key (recommended for multi-review) |
| `xiaomi-api-key` | empty | Xiaomi MiMo API key (not compatible with multi-review due to concurrency limits) |
| `language` | `zh` | Response language: `zh` or `en` |
| `extra-env` | empty | Extra environment variables (multi-line `KEY=VALUE` pairs) |
| `extra-env-allow-sensitive` | `false` | Allow `extra-env` to override sensitive runtime variables (with warning) |
| `cleanup-error-comments` | `true` | Auto-delete error comments after a failed run |

Setup-related inputs from [`setup-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/setup-opencode) (`install-url`, `install-dir`, `xdg-cache-home`, `cache`, `cache-key`, `install-attempts`, `allow-preinstalled`, `version`) are also accepted.

## Related actions in this monorepo

- [`review`](https://github.com/sun-praise/opencode-actions/tree/main/review) — single-agent PR review with sensible defaults
- [`architect-review`](https://github.com/sun-praise/opencode-actions/tree/main/architect-review) — architecture-focused review
- [`feature-missing`](https://github.com/sun-praise/opencode-actions/tree/main/feature-missing) — PR scope audit vs linked issue
- [`spec-coverage`](https://github.com/sun-praise/opencode-actions/tree/main/spec-coverage) — spec/task coverage audit
- [`setup-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/setup-opencode) — installs OpenCode, restores a dedicated cache
- [`run-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/run-opencode) — generic `opencode` runner with retry logic
- [`github-run-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/github-run-opencode) — one-step wrapper for `opencode github run`

See the [root README](https://github.com/sun-praise/opencode-actions) for the full list of inputs and examples.

## License

Apache 2.0
