# Run OpenCode

Part of [`sun-praise/opencode-actions`](https://github.com/sun-praise/opencode-actions) — generic runner that invokes `opencode` with optional retry logic. Pairs with [`setup-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/setup-opencode) when you want full control over the install + run pipeline. Linux runners only.

## Quick start

```yaml
- name: Setup OpenCode
  uses: sun-praise/opencode-actions/setup-opencode@v3

- name: Run OpenCode
  uses: sun-praise/opencode-actions/run-opencode@v3
  with:
    args: github run
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    ZHIPU_API_KEY: ${{ secrets.ZHIPU_API_KEY }}
```

In the same-job case, `setup-opencode` already exports `opencode` to `PATH`, so you do not need to pass `opencode-path` to `run-opencode`.

## What it does

- Runs `opencode` with space-delimited `args` and an optional `working-directory`
- Built-in retry preset for common GitHub network failures (`retry-profile: github-network`)
- Optional `retry-on-regex` for custom retry conditions
- Provider secrets and model selection are intentionally kept in workflow `env:` so the action stays generic
- Sets `reasoning-effort` and `enable-thinking` for the model agent

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `args` | empty | Space-delimited arguments passed to `opencode` |
| `working-directory` | empty | Working directory used before invoking OpenCode |
| `attempts` | `1` | Total attempts before failing |
| `retry-on-regex` | empty | Retry only when command output matches this regex |
| `retry-profile` | empty | Built-in retry preset such as `github-network` |
| `retry-delay-seconds` | `15` | Base delay used between retries |
| `opencode-path` | `opencode` | Explicit binary path from `setup-opencode` |
| `reasoning-effort` | `high` | Reasoning effort for the model agent: `low` / `medium` / `high` / `max` |
| `enable-thinking` | `true` | Enable thinking mode for the model agent |

## Related actions in this monorepo

- [`setup-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/setup-opencode) — installs OpenCode, restores a dedicated cache
- [`github-run-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/github-run-opencode) — one-step wrapper for `opencode github run`
- [`review`](https://github.com/sun-praise/opencode-actions/tree/main/review) — opinionated PR review wrapper
- [`multi-review`](https://github.com/sun-praise/opencode-actions/tree/main/multi-review) — multi-agent parallel review with coordinator synthesis
- [`architect-review`](https://github.com/sun-praise/opencode-actions/tree/main/architect-review) — architecture-focused review
- [`feature-missing`](https://github.com/sun-praise/opencode-actions/tree/main/feature-missing) — PR scope audit vs linked issue
- [`spec-coverage`](https://github.com/sun-praise/opencode-actions/tree/main/spec-coverage) — spec/task coverage audit

See the [root README](https://github.com/sun-praise/opencode-actions) for the full list of inputs and examples.

## License

Apache 2.0
