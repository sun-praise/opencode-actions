# OpenCode Multi-Review

Part of [`sun-praise/opencode-actions`](https://github.com/sun-praise/opencode-actions) — multi-agent parallel PR review powered by the OpenCode SDK, with a coordinator that synthesises all reviewer findings into one PR comment. Linux runners only.

## Quick start

```yaml
- name: Run OpenCode multi-review
  uses: sun-praise/opencode-actions/multi-review@v4
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
- Built-in reviewer personas: quality, security, performance, architecture, regression-test, feature-missing, test-value, spec-coverage
- A coordinator session reads all reviewer outputs and produces a deduplicated synthesis
- Each reviewer's full output is included in a collapsible `<details>` block
- Single `opencode serve` instance shared across sessions (one MCP cold start)
- Skips forked pull requests by default (no secrets exposed)

## Session resume (cross-runner)

By default every run starts each reviewer from a blank session, so re-pushing to the same PR re-reads the entire diff history. multi-review can instead **resume** each persona's previous opencode session so only the new diff is processed:

- After a run, each reviewer's session is exported (`opencode export`) into a bundle and persisted for that PR.
- On the next run for the same PR, the bundles are imported (`opencode import`) into a fresh, isolated opencode DB and the reviewers continue their existing sessions — true session continuation rather than re-feeding flattened history.
- Storage backends (picked automatically):
  - **HTTP cache server** when `context-cache-url` is set — a mutable, runner-shared store (see [`review-context-server`](../review-context-server)).
  - **GitHub Actions cache** (default) — falls back to the immutable `actions/cache` with per-PR `restore-keys`, so no extra infra is required.

Resume is transparent: if no bundle exists for a PR (first run, cache miss, or import failure) the reviewer simply starts a new session as before.

> Requires opencode ≥ 1.17 (the `opencode export` / `opencode import` CLI). Older versions skip resume silently.

## Custom reviewer personas

You can add your own reviewer personas by placing `.yaml` or `.yml` files in the target repository's `.github/reviewers/` directory. Each file must contain `name` and `prompt` fields:

```yaml
# .github/reviewers/accessibility.yaml
name: accessibility
prompt: |
  Review this PR for accessibility issues...
```

- Custom personas are loaded automatically when the directory exists (opt-in, no error if missing)
- A custom persona with the same `name` as a built-in persona **overrides** the built-in
- Reference custom personas in `default-team` just like built-in ones: `"accessibility:1,quality:1"`
- YAML files missing `name` or `prompt` are skipped with a warning


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
| `context-cache-url` | empty | URL of a review-context cache server; when set, session bundles are persisted via HTTP instead of GitHub Actions cache |
| `context-cache-token` | empty | Bearer token for the review-context cache server |

Setup-related inputs from [`setup-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/setup-opencode) (`install-url`, `install-dir`, `xdg-cache-home`, `cache`, `cache-key`, `install-attempts`, `allow-preinstalled`, `version`) are also accepted.

## Related actions in this monorepo

- [`setup-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/setup-opencode) — installs OpenCode, restores a dedicated cache
- [`run-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/run-opencode) — generic `opencode` runner with retry logic
- [`github-run-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/github-run-opencode) — one-step wrapper for `opencode github run`
See the [root README](https://github.com/sun-praise/opencode-actions) for the full list of inputs and examples.

## License

Apache 2.0
