# opencode-actions

[中文文档](README.zh-CN.md)

Reusable GitHub Actions for installing and running OpenCode in other repositories.

This repository is licensed under Apache 2.0.

## TLDR

Write this in your CI.yaml

```yaml
- name: Run OpenCode review
  uses: sun-praise/opencode-actions/review@v3
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}

    # only one is enough.
    deepseek-api-key: ${{ secrets.DEEPSEEK_API_KEY }}
    minimax-api-key: ${{ secrets.MINIMAX_API_KEY }}
    xiaomi-api-key: ${{ secrets.XIAOMI_API_KEY }}
    openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
    stepfun-api-key: ${{ secrets.STEPFUN_API_KEY }}
    zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
    opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
```

You'll get an automatic reviewer (Chinese by default, configurable via `language` input).

Or add the skills to your project:

```bash
npx skills add sun-praise/opencode-actions
```

## What it includes

- `review`: opinionated PR review wrapper with built-in prompt and model defaults
- `multi-review`: multi-agent parallel review using OpenCode SDK — multiple reviewers run concurrently, a coordinator synthesizes findings into one PR comment
- `architect-review`: architecture-level PR review focusing on coupling, layering, and structural concerns
- `feature-missing`: audits PR implementation against linked issue spec to find missing features
- `spec-coverage`: cross-references project spec/task files against PR implementation to find planned but unimplemented features
- `github-run-opencode`: one-step wrapper for the common `opencode github run` workflow
- `setup-opencode`: installs OpenCode, restores a dedicated cache, and exports the binary path
- `run-opencode`: runs `opencode` with optional retry logic for flaky GitHub network failures

## Current scope

- Linux only
- installer-based bootstrap via `https://opencode.ai/install`
- cache is best-effort and does not pin an exact OpenCode version
- by default `setup-opencode` ignores unrelated `opencode` binaries already present on `PATH`; set `allow-preinstalled: true` only if you explicitly trust the runner image

## github-run-opencode

Use this when you want the shortest consumer workflow for `opencode github run`.

### Common inputs

| Input | Default | Description |
| --- | --- | --- |
| `model` | `MODEL_NAME`, else `zhipuai-coding-plan/glm-5.1` | Exported as `MODEL` before `opencode github run`; explicit input still overrides |
| `fallback-models` | empty | Optional ordered fallback models, filtered by available provider API keys |
| `model-timeout-seconds` | `300` | Per-model timeout before rotating to the next fallback candidate when fallbacks are configured; `0` disables it |
| `fallback-on-regex` | timeout regex | Rotate to the next fallback candidate when output matches this regex |
| `prompt` | built-in PR review template | Exported as `PROMPT` before `opencode github run` |
| `github-token` | empty | Exported as `GITHUB_TOKEN` before `opencode github run` |
| `zhipu-api-key` | empty | Exported as `ZHIPU_API_KEY` before `opencode github run` |
| `deepseek-api-key` | empty | Exported as `DEEPSEEK_API_KEY` before `opencode github run` |
| `opencode-go-api-key` | empty | Exported as `OPENCODE_GO_API_KEY` before `opencode github run` |
| `minimax-api-key` | empty | Exported as `MINIMAX_API_KEY` before `opencode github run` |
| `xiaomi-api-key` | empty | Exported as `XIAOMI_API_KEY` before `opencode github run` |
| `openrouter-api-key` | empty | Exported as `OPENROUTER_API_KEY` before `opencode github run` |
| `stepfun-api-key` | empty | Exported as `STEPFUN_API_KEY` before `opencode github run` |
| `reasoning-effort` | `max` | Reasoning effort level for the model agent (`low`, `medium`, `high`, `max`) |
| `enable-thinking` | `true` | Enable thinking mode for the model agent |
| `use-github-token` | `true` | Exported as `USE_GITHUB_TOKEN` before `opencode github run` |
| `language` | `zh` | Response language: `zh` for Chinese, `en` for English |
| `extra-env` | empty | Extra environment variables (multi-line `KEY=VALUE` pairs) |
| `extra-env-allow-sensitive` | `false` | When `false`, blocks `extra-env` entries that override sensitive runtime variables (API keys, MODEL, etc.); set `true` to allow with warning |
| `attempts` | `3` | Total attempts before failing |
| `retry-profile` | `github-network` | Built-in retry preset for common GitHub failures |
| `timeout-seconds` | `600` | Maximum execution time for `opencode github run`; `0` disables it |
| `working-directory` | empty | Optional working directory before running OpenCode |

`github-run-opencode` also accepts the setup-related inputs from `setup-opencode`, such as `cache`, `cache-key`, `install-attempts`, `install-url`, and `allow-preinstalled`.

## review

Use this when you want the simplest PR review setup.

- built-in `prompt` review template (same as `github-run-opencode`)
- built-in `MODEL` resolution: explicit `model` input, else `MODEL_NAME`, else `zhipuai-coding-plan/glm-5.1`
- built-in `timeout-seconds` default: `600` (10 minutes)
- optional ordered `fallback-models` for timeout-driven model rotation
- still allows overriding any input when needed

When `fallback-models` is set, the wrapper keeps `model` as the first choice and only rotates to the next candidate when the current model times out or emits a timeout-like error. Candidates whose provider key is unavailable are skipped automatically.

## multi-review

Use this when you want multiple AI reviewers to analyze a PR in parallel, with a coordinator that synthesizes all findings into a single comment.

- spawns N reviewer sessions in parallel via the OpenCode SDK (`@opencode-ai/sdk`)
- built-in reviewer personas: quality, security, performance, architecture
- a coordinator session reads all reviewer outputs and produces a deduplicated synthesis
- each reviewer's detailed output is included in a collapsible `<details>` section
- single `opencode serve` instance shared across all sessions (one MCP cold start)

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

### Inputs

| Input | Default | Description |
| --- | --- | --- |
| `model` | empty | Model for all reviewers and coordinator (format: `provider/model`) |
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
| `openrouter-api-key` | empty | OpenRouter API key |
| `stepfun-api-key` | empty | StepFun API key |
| `extra-env` | empty | Extra environment variables (multi-line `KEY=VALUE` pairs) |
| `extra-env-allow-sensitive` | `false` | When `false`, blocks `extra-env` entries that override sensitive runtime variables; set `true` to allow with warning. The `MULTI_REVIEW_` prefix is always blocked regardless of this setting |
| `cleanup-error-comments` | `true` | Auto-delete error comments after a failed run |

`multi-review` also accepts all setup-related inputs from `setup-opencode` (`install-url`, `install-dir`, `xdg-cache-home`, `cache`, `cache-key`, `install-attempts`, `allow-preinstalled`, `version`).

## architect-review

Use this alongside `review` to evaluate PR changes from an architecture perspective.

- evaluates coupling, module placement, layering, interface design, and shotgun surgery risks
- reads `AGENTS.md` (or `CLAUDE.md`) for project-specific architecture conventions
- shares the same inputs and cache as `review`/`feature-missing`

```yaml
- name: Run OpenCode architect review
  uses: sun-praise/opencode-actions/architect-review@v3
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
    opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
```

## feature-missing

Use this alongside `review` to audit whether a PR's implementation covers all requirements from the linked issue spec.

- automatically reads the linked issue body as the feature spec via `gh pr view`
- if no linked issue, extracts requirements from the PR title and body
- classifies gaps by severity: CRITICAL, MEDIUM, LOW
- shares the same inputs and cache as `review`/`github-run-opencode`

```yaml
- name: Run feature missing audit
  uses: sun-praise/opencode-actions/feature-missing@v3
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
    opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
```

## spec-coverage

Use this alongside `review` and `feature-missing` to audit whether a PR implements everything the project's spec/task files planned.

Unlike `feature-missing` (which checks PR self-described scope), `spec-coverage` uses the project's own spec files as the **authoritative source of intended scope**. This catches cases where a PR implements part of a larger planned feature but skips critical integration steps.

- auto-discovers spec files in `openspec/changes/*/tasks.md`, `specs/**`, and other common locations
- intelligently skips bug fixes and minor changes that don't need specs (`SKIP`)
- reports missing spec files as a CRITICAL gap when a feature PR should have one but doesn't
- cross-references unchecked task items against the PR diff
- checks end-to-end integration (models read at runtime, configs consumed, APIs called)
- classifies gaps by severity: CRITICAL, MEDIUM, LOW
- shares the same inputs and cache as `review`/`feature-missing`

```yaml
- name: Run spec coverage audit
  uses: sun-praise/opencode-actions/spec-coverage@v3
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
    opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
```

### How the review actions differ

| Action | Scope source | What it catches |
| --- | --- | --- |
| `review` | PR diff | Code quality, security, bugs |
| `multi-review` | PR diff (multiple parallel reviewers) | Quality, security, performance, architecture — coordinator synthesizes |
| `architect-review` | PR diff + project conventions | Coupling, layering, module placement, structural concerns |
| `feature-missing` | PR title/body + linked issues | PR self-described scope completeness |
| `spec-coverage` | Project spec/task files | Full planned scope vs implementation |

## setup-opencode

### Inputs

| Input | Default | Description |
| --- | --- | --- |
| `install-url` | `https://opencode.ai/install` | Installer URL used to bootstrap OpenCode |
| `install-dir` | computed | Directory where `opencode` will be installed |
| `xdg-cache-home` | computed | Dedicated XDG cache directory |
| `cache` | `true` | Enable `actions/cache` for install and cache directories |
| `cache-key` | `v1` | Cache key suffix used to invalidate installer caches |
| `install-attempts` | `3` | Total installer attempts |
| `allow-preinstalled` | `false` | Reuse an existing trusted `opencode` already present on `PATH` |

The internal cache key also includes a hash of `install-url`, so changing installer sources does not silently reuse an older cache entry.

### Outputs

| Output | Description |
| --- | --- |
| `opencode-path` | Resolved absolute path to `opencode` |
| `install-dir` | Resolved install directory |
| `xdg-cache-home` | Resolved XDG cache directory |
| `cache-hit` | Whether `actions/cache` restored a hit |
| `version` | `opencode --version` output |

## run-opencode

### Inputs

| Input | Default | Description |
| --- | --- | --- |
| `args` | empty | Space-delimited arguments passed to `opencode` |
| `working-directory` | empty | Working directory used before invoking OpenCode |
| `attempts` | `1` | Total attempts before failing |
| `retry-on-regex` | empty | Retry only when command output matches this regex |
| `retry-profile` | empty | Built-in retry preset such as `github-network` |
| `retry-delay-seconds` | `15` | Base delay used between retries |
| `opencode-path` | `opencode` | Explicit binary path from `setup-opencode` |
| `reasoning-effort` | `max` | Reasoning effort level for the model agent (`low`, `medium`, `high`, `max`) |
| `enable-thinking` | `true` | Enable thinking mode for the model agent |

`run-opencode` intentionally keeps provider secrets and model selection in workflow `env:` so the action stays generic.
In the common same-job case, `setup-opencode` already exports `opencode` to `PATH`, so you do not need to pass `opencode-path` into `run-opencode`.

## Usage

Public consumers should reference the subdirectory action path:

```yaml
uses: sun-praise/opencode-actions/review@v3
uses: sun-praise/opencode-actions/multi-review@v3
uses: sun-praise/opencode-actions/architect-review@v3
uses: sun-praise/opencode-actions/feature-missing@v3
uses: sun-praise/opencode-actions/spec-coverage@v3
uses: sun-praise/opencode-actions/github-run-opencode@v3
uses: sun-praise/opencode-actions/setup-opencode@v3
uses: sun-praise/opencode-actions/run-opencode@v3
```

```yaml
- name: Run OpenCode review
  uses: sun-praise/opencode-actions/review@v3
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
    opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
    minimax-api-key: ${{ secrets.MINIMAX_API_KEY }}
    xiaomi-api-key: ${{ secrets.XIAOMI_API_KEY }}
    openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
    stepfun-api-key: ${{ secrets.STEPFUN_API_KEY }}
```

More examples live in `examples/`.

To use English output, set the `language` input:

```yaml
- name: Run OpenCode review (English)
  uses: sun-praise/opencode-actions/review@v3
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    language: en
```

Or configure it from repository variables:

```yaml
- name: Run OpenCode review
  uses: sun-praise/opencode-actions/review@v3
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    language: ${{ vars.OPENCODE_LANGUAGE }}
```

If you need more control, you can still use `setup-opencode` and `run-opencode` directly. For example, pass `opencode-path` explicitly when reusing a binary from another job or a custom location.

The PR review example intentionally skips forked pull requests because repository secrets are not exposed there by default.
The comment-command example also skips forked pull requests for the same reason.
The comment-command example only allows `OWNER`, `MEMBER`, and `COLLABORATOR` comments to trigger the workflow.

## Local verification

```bash
bash tests/test.sh
```

## CI

This repository includes a CI workflow that:

- runs `shellcheck` on every bundled shell script
- runs the local shell-based regression suite
- smoke-tests all actions through `uses: ./setup-opencode`, `uses: ./run-opencode`, `uses: ./github-run-opencode`, `uses: ./review`, `uses: ./multi-review`, `uses: ./feature-missing`, `uses: ./spec-coverage`, and `uses: ./architect-review`

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
5. Use `owner/repo/review@v3` for the simplest review setup, `owner/repo/multi-review@v3` for multi-agent parallel review, `owner/repo/architect-review@v3` for architecture review, `owner/repo/feature-missing@v3` for PR scope audit, `owner/repo/spec-coverage@v3` for spec coverage audit, `owner/repo/github-run-opencode@v3` for generic `github run`, or `owner/repo/setup-opencode@v3` plus `owner/repo/run-opencode@v3` for more control.

The initial release-notes template lives at `docs/releases/v1.0.0.md`.

## Limitations

- `args` is parsed as a space-delimited string, so keep complex text in environment variables like `PROMPT`
- the installer is external, so cache invalidation uses `cache-key` instead of a guaranteed version pin
- first version is optimized for GitHub-hosted or Linux self-hosted runners
