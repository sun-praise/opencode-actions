# OpenCode Architect Review

Part of [`sun-praise/opencode-actions`](https://github.com/sun-praise/opencode-actions) — architecture-level PR review focusing on coupling, layering, and structural concerns. Use it alongside [`review`](https://github.com/sun-praise/opencode-actions/tree/main/review). Linux runners only.

## Quick start

```yaml
- name: Run OpenCode architect review
  uses: sun-praise/opencode-actions/architect-review@v3
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
    opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
```

## What it does

- Evaluates coupling, module placement, layering, interface design, and shotgun-surgery risks
- Reads `AGENTS.md` (or `CLAUDE.md`) for project-specific architecture conventions
- Shares the same inputs, cache, and retry behaviour as `review` and `feature-missing`
- Skips forked pull requests by default (no secrets exposed)
- English / Chinese output controlled by the `language` input

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `model` | `MODEL_NAME` env, else `zhipuai-coding-plan/glm-5.1` | Model for the review agent |
| `fallback-models` | empty | Ordered fallback models, filtered by available provider keys |
| `prompt` | built-in architect review template | Exported as `PROMPT` |
| `github-token` | empty | Exported as `GITHUB_TOKEN` |
| `zhipu-api-key` | empty | Exported as `ZHIPU_API_KEY` |
| `opencode-go-api-key` | empty | Exported as `OPENCODE_GO_API_KEY` |
| `deepseek-api-key` | empty | Exported as `DEEPSEEK_API_KEY` |
| `minimax-api-key` | empty | Exported as `MINIMAX_API_KEY` |
| `xiaomi-api-key` | empty | Exported as `XIAOMI_API_KEY` |
| `language` | `zh` | Response language: `zh` or `en` |
| `timeout-seconds` | `600` | Maximum execution time for `opencode github run`; `0` disables it |
| `attempts` | `3` | Total attempts before failing |
| `retry-profile` | `github-network` | Built-in retry preset for common GitHub failures |

Setup-related inputs from [`setup-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/setup-opencode) (`install-url`, `install-dir`, `xdg-cache-home`, `cache`, `cache-key`, `install-attempts`, `allow-preinstalled`, `version`) are also accepted.

## Related actions in this monorepo

- [`review`](https://github.com/sun-praise/opencode-actions/tree/main/review) — single-agent PR review with sensible defaults
- [`multi-review`](https://github.com/sun-praise/opencode-actions/tree/main/multi-review) — multi-agent parallel review with coordinator synthesis
- [`feature-missing`](https://github.com/sun-praise/opencode-actions/tree/main/feature-missing) — PR scope audit vs linked issue
- [`spec-coverage`](https://github.com/sun-praise/opencode-actions/tree/main/spec-coverage) — spec/task coverage audit
- [`setup-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/setup-opencode) — installs OpenCode, restores a dedicated cache
- [`run-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/run-opencode) — generic `opencode` runner with retry logic
- [`github-run-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/github-run-opencode) — one-step wrapper for `opencode github run`

See the [root README](https://github.com/sun-praise/opencode-actions) for the full list of inputs and examples.

## License

Apache 2.0
