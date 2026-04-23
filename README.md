# opencode-actions

Reusable GitHub Actions for running OpenCode in CI with retry, timeout, default model fallback, and provider convenience keys.

This repository is licensed under Apache 2.0.

## TLDR

Write this in your CI.yaml

```yaml
- name: Run OpenCode review
  uses: Svtter/opencode-actions/review@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}

    # only one is enough.
    zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
    opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
```

You'll get a automatic reviewer in Chinese.

## What it includes

- `review`: opinionated PR review wrapper with built-in Chinese prompt, model default, retry, and timeout
- `github-run-opencode`: one-step wrapper for `opencode github run` with retry, timeout, model default, and provider keys

## What makes this different from upstream

Compared to [`anomalyco/opencode/github`](https://github.com/anomalyco/opencode/tree/dev/github), this repo adds:

- **Default model fallback**: explicit input → `MODEL_NAME` env → `zhipuai-coding-plan/glm-5.1` (upstream requires explicit `model`)
- **Provider convenience keys**: `zhipu-api-key`, `opencode-go-api-key` inputs (upstream has none)
- **Retry logic**: configurable attempts, retry-profile (`github-network`), retry-on-regex
- **Execution timeout**: `timeout-seconds` to cap long-running operations
- **Review prompt template**: built-in Chinese PR review prompt with structured output format

Upstream already handles opencode installation and caching, so we delegate that to the same approach.

## github-run-opencode

Use this when you want the shortest consumer workflow for `opencode github run`.

### Common inputs

| Input | Default | Description |
| --- | --- | --- |
| `model` | `MODEL_NAME`, else `zhipuai-coding-plan/glm-5.1` | Exported as `MODEL` before `opencode github run` |
| `prompt` | empty | Exported as `PROMPT` before `opencode github run` |
| `github-token` | empty | Exported as `GITHUB_TOKEN` before `opencode github run` |
| `zhipu-api-key` | empty | Exported as `ZHIPU_API_KEY` before `opencode github run` |
| `opencode-go-api-key` | empty | Exported as `OPENCODE_API_KEY` before `opencode github run` |
| `use-github-token` | `true` | Exported as `USE_GITHUB_TOKEN` before `opencode github run` |
| `attempts` | `3` | Total attempts before failing |
| `retry-profile` | `github-network` | Built-in retry preset for common GitHub failures |
| `timeout-seconds` | `600` | Maximum execution time for `opencode github run`; `0` disables it |
| `working-directory` | empty | Optional working directory before running OpenCode |

## review

Use this when you want the simplest PR review setup.

- built-in `prompt` review template (Chinese, structured: 可合并/有条件合并/不可合并)
- built-in `MODEL` resolution: explicit `model` input, else `MODEL_NAME`, else `zhipuai-coding-plan/glm-5.1`
- built-in `timeout-seconds` default: `600` (10 minutes)
- built-in retry with `github-network` profile
- still allows overriding any input when needed

## Usage

Public consumers should reference the subdirectory action path:

```yaml
uses: Svtter/opencode-actions/review@v1
uses: Svtter/opencode-actions/github-run-opencode@v1
```

```yaml
- name: Run OpenCode review
  uses: Svtter/opencode-actions/review@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
    opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
```

More examples live in `examples/`.

The PR review example intentionally skips forked pull requests because repository secrets are not exposed there by default.
The comment-command example also skips forked pull requests for the same reason.
The comment-command example only allows `OWNER`, `MEMBER`, and `COLLABORATOR` comments to trigger the workflow.

## Local verification

```bash
bash tests/test.sh
```

## CI

This repository includes a CI workflow that:
- smoke-tests both actions through `uses: ./github-run-opencode` and `uses: ./review`

## Release Policy

- publish immutable releases as `v1.0.0`, `v1.1.0`, `v1.1.1`, and so on
- consumers can pin to `@v1` for compatible updates
- security-sensitive consumers should pin to a full commit SHA instead of a moving major tag
- this repository updates the repo-wide major tag like `v1` when a semver GitHub release is published

## Publishing Checklist

1. Push the repository publicly.
2. Verify `CI` passes on `main`.
3. Create a GitHub release with a semver tag such as `v1.0.0`.
4. Confirm the `Update Major Tag` workflow moved `v1` to that release.
5. Use `owner/repo/review@v1` for the simplest review setup, or `owner/repo/github-run-opencode@v1` for generic `github run`.

The initial release-notes template lives at `docs/releases/v1.0.0.md`.

## Limitations

- `prompt` is passed via environment variable, so keep complex text there
- Linux runners only
- installation and caching uses the same approach as upstream (`actions/cache@v4` + `curl` installer)
