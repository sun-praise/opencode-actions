# GitHub Run OpenCode

Part of [`sun-praise/opencode-actions`](https://github.com/sun-praise/opencode-actions) — convenience action that bundles [`setup-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/setup-opencode) plus `opencode github run`. Use it when you want the shortest consumer workflow for `opencode github run` without giving up setup / cache controls. Linux runners only.

## Quick start

```yaml
- name: Run OpenCode
  uses: sun-praise/opencode-actions/github-run-opencode@v3
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
    opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
```

## What it does

- Installs and caches OpenCode (delegates to `setup-opencode`)
- Runs `opencode github run` with optional retry logic for flaky GitHub network failures
- Skips forked pull requests by default (no secrets exposed)
- English / Chinese output controlled by the `language` input

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `model` | `MODEL_NAME` env, else `zhipuai-coding-plan/glm-5.1` | Exported as `MODEL` before `opencode github run` |
| `fallback-models` | empty | Optional ordered fallback models, filtered by available provider keys |
| `model-timeout-seconds` | `300` | Per-model timeout before rotating to the next fallback candidate; `0` disables it |
| `fallback-on-regex` | timeout regex | Rotate to the next fallback candidate when output matches this regex |
| `prompt` | built-in PR review template | Exported as `PROMPT` before `opencode github run` |
| `github-token` | empty | Exported as `GITHUB_TOKEN` |
| `zhipu-api-key` | empty | Exported as `ZHIPU_API_KEY` |
| `opencode-go-api-key` | empty | Exported as `OPENCODE_GO_API_KEY` |
| `deepseek-api-key` | empty | Exported as `DEEPSEEK_API_KEY` |
| `minimax-api-key` | empty | Exported as `MINIMAX_API_KEY` |
| `xiaomi-api-key` | empty | Exported as `XIAOMI_API_KEY` |
| `reasoning-effort` | `max` | Reasoning effort for the model agent: `low` / `medium` / `high` / `max` |
| `enable-thinking` | `true` | Enable thinking mode for the model agent |
| `use-github-token` | `true` | Exported as `USE_GITHUB_TOKEN` |
| `language` | `zh` | Response language: `zh` or `en` |
| `extra-env` | empty | Extra environment variables (multi-line `KEY=VALUE` pairs) |
| `extra-env-allow-sensitive` | `false` | Allow `extra-env` to override sensitive runtime variables (with warning) |
| `attempts` | `3` | Total attempts before failing |
| `retry-profile` | `github-network` | Built-in retry preset for common GitHub failures |
| `timeout-seconds` | `600` | Maximum execution time for `opencode github run`; `0` disables it |
| `working-directory` | empty | Optional working directory before running OpenCode |

All setup-related inputs from [`setup-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/setup-opencode) (`install-url`, `install-dir`, `xdg-cache-home`, `cache`, `cache-key`, `install-attempts`, `allow-preinstalled`, `version`) are also accepted.

## Related actions in this monorepo

- [`setup-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/setup-opencode) — installs OpenCode, restores a dedicated cache
- [`run-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/run-opencode) — generic `opencode` runner with retry logic
- [`review`](https://github.com/sun-praise/opencode-actions/tree/main/review) — opinionated PR review wrapper
- [`multi-review`](https://github.com/sun-praise/opencode-actions/tree/main/multi-review) — multi-agent parallel review with coordinator synthesis
- [`architect-review`](https://github.com/sun-praise/opencode-actions/tree/main/architect-review) — architecture-focused review
- [`feature-missing`](https://github.com/sun-praise/opencode-actions/tree/main/feature-missing) — PR scope audit vs linked issue
- [`spec-coverage`](https://github.com/sun-praise/opencode-actions/tree/main/spec-coverage) — spec/task coverage audit

See the [root README](https://github.com/sun-praise/opencode-actions) for the full list of inputs and examples.

## License

Apache 2.0
