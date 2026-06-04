# OpenCode Spec Coverage

Part of [`sun-praise/opencode-actions`](https://github.com/sun-praise/opencode-actions) — cross-references project spec/task files against a PR's implementation to find planned-but-unimplemented features. Use it alongside [`review`](https://github.com/sun-praise/opencode-actions/tree/main/review) and [`feature-missing`](https://github.com/sun-praise/opencode-actions/tree/main/feature-missing). Linux runners only.

Unlike `feature-missing` (which checks PR self-described scope), `spec-coverage` uses the project's own spec files as the **authoritative source of intended scope**. This catches cases where a PR implements part of a larger planned feature but skips critical integration steps.

## Quick start

```yaml
- name: Run spec coverage audit
  uses: sun-praise/opencode-actions/spec-coverage@v3
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
    opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
```

## What it does

- Auto-discovers spec files in `openspec/changes/*/tasks.md`, `specs/**`, and other common locations
- Intelligently skips bug fixes and minor changes that don't need specs (`SKIP`)
- Reports missing spec files as a `CRITICAL` gap when a feature PR should have one but doesn't
- Cross-references unchecked task items against the PR diff
- Checks end-to-end integration (models read at runtime, configs consumed, APIs called)
- Classifies gaps by severity: `CRITICAL` / `MEDIUM` / `LOW`
- Skips forked pull requests by default (no secrets exposed)
- English / Chinese output controlled by the `language` input

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `model` | `MODEL_NAME` env, else `zhipuai-coding-plan/glm-5.1` | Model for the audit agent |
| `fallback-models` | empty | Ordered fallback models, filtered by available provider keys |
| `prompt` | built-in spec-coverage template | Exported as `PROMPT` |
| `github-token` | empty | Exported as `GITHUB_TOKEN` |
| `zhipu-api-key` | empty | Exported as `ZHIPU_API_KEY` |
| `opencode-go-api-key` | empty | Exported as `OPENCODE_GO_API_KEY` |
| `deepseek-api-key` | empty | Exported as `DEEPSEEK_API_KEY` |
| `minimax-api-key` | empty | Exported as `MINIMAX_API_KEY` |
| `xiaomi-api-key` | empty | Exported as `XIAOMI_API_KEY` |
| `openrouter-api-key` | empty | Exported as `OPENROUTER_API_KEY` |
| `stepfun-api-key` | empty | Exported as `STEPFUN_API_KEY` |
| `language` | `zh` | Response language: `zh` or `en` |
| `timeout-seconds` | `600` | Maximum execution time for `opencode github run`; `0` disables it |
| `attempts` | `3` | Total attempts before failing |
| `retry-profile` | `github-network` | Built-in retry preset for common GitHub failures |

Setup-related inputs from [`setup-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/setup-opencode) (`install-url`, `install-dir`, `xdg-cache-home`, `cache`, `cache-key`, `install-attempts`, `allow-preinstalled`, `version`) are also accepted.

## Related actions in this monorepo

- [`review`](https://github.com/sun-praise/opencode-actions/tree/main/review) — single-agent PR review with sensible defaults
- [`multi-review`](https://github.com/sun-praise/opencode-actions/tree/main/multi-review) — multi-agent parallel review with coordinator synthesis
- [`architect-review`](https://github.com/sun-praise/opencode-actions/tree/main/architect-review) — architecture-focused review
- [`feature-missing`](https://github.com/sun-praise/opencode-actions/tree/main/feature-missing) — PR scope audit vs linked issue
- [`setup-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/setup-opencode) — installs OpenCode, restores a dedicated cache
- [`run-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/run-opencode) — generic `opencode` runner with retry logic
- [`github-run-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/github-run-opencode) — one-step wrapper for `opencode github run`

See the [root README](https://github.com/sun-praise/opencode-actions) for the full list of inputs and examples.

## License

Apache 2.0
