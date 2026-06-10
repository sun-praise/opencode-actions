---
name: setup-ci
description: Configure opencode-actions GitHub Actions workflows for a repository. Use when the user wants to set up automated PR review, multi-review, or comment-triggered opencode commands in their CI. Triggers on requests like "帮我配置 CI", "设置 PR review", "添加 opencode action", "配置自动审查", or any task involving adding opencode-actions workflows to a GitHub repository.
---

# Setup opencode-actions CI

Configure `sun-praise/opencode-actions` GitHub Actions for a user's repository.

## Workflow

1. Ask the user which actions they want and their repository info
2. Check the action reference for available options: see [references/actions-reference.md](references/actions-reference.md)
3. Generate the workflow YAML file(s)
4. Guide the user on secrets and permissions setup

## Action Selection

| Need | Action | One-liner |
| --- | --- | --- |
| Multi-agent review | `multi-review` | Parallel reviewer personas + coordinator synthesis |
| Custom command | `github-run-opencode` | Flexible, user-defined prompt |
| Manual setup | `setup-opencode` + `run-opencode` | Full control over install and run |

`multi-review` includes 8 built-in reviewer personas: quality, security, performance, architecture, regression-test, feature-missing, test-value, spec-coverage. Use `default-team` to select which personas run.

## Recommended Models

| Model | Provider | Required Secret | Notes |
| --- | --- | --- | --- |
| `deepseek/deepseek-v4-flash` | DeepSeek | `DEEPSEEK_API_KEY` | Fast and cost-effective; recommended for multi-review |
| `zhipuai-coding-plan/glm-5.1` | Zhipu | `ZHIPU_API_KEY` | General-purpose, good balance of speed and quality |
| `opencode-go/deepseek-v4-flash` | OpenCode Go | `OPENCODE_GO_API_KEY` | Proxy service, uses DeepSeek under the hood |
| `minimax-cn-coding-plan/MiniMax-M3` | MiniMax | `MINIMAX_API_KEY` | Chinese-language review; not compatible with multi-review ([why?](references/actions-reference.md#model-constraints)) |
| `xiaomi-token-plan-cn/mimo-v2-pro` | Xiaomi MiMo | `XIAOMI_API_KEY` | Token Plan (China); not compatible with multi-review ([why?](references/actions-reference.md#model-constraints)) |

Set via `model:` input in the `with:` block (e.g. `model: ${{ vars.MODEL_NAME }}`), or configure `MODEL_NAME` as a repository variable in Settings → Secrets and variables → Actions → Variables to switch models without modifying workflow files.

## Multi-Review Setup

Generate this in `.github/workflows/opencode-multi-review.yml`:

```yaml
name: OpenCode Multi-Review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

jobs:
  multi-review:
    if: github.event.pull_request.draft == false && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - name: Checkout PR head
        uses: actions/checkout@v6
        with:
          repository: ${{ github.event.pull_request.head.repo.full_name }}
          ref: ${{ github.event.pull_request.head.ref }}

      - name: Run multi-review
        uses: sun-praise/opencode-actions/multi-review@v4
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          deepseek-api-key: ${{ secrets.DEEPSEEK_API_KEY }}
          zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
          opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
          litellm-url: ${{ secrets.LITELLM_URL }}
          litellm-api-key: ${{ secrets.LITELLM_API_KEY }}
          # Optional: override default reviewer team
          # default-team: "quality:2,security:1,architecture:1,test-value:1"
          # Optional: exclude files from diff (e.g. "*.lock,*.snap")
          # diff-exclude: "*.lock,*.snap"
          # Optional: truncate diff over N KB (default: 0 = disabled)
          # diff-max-size-kb: "200"
          # Optional: response language: "zh" (default) or "en"
          # language: "zh"
          # Optional: increase timeout for large PRs (default: 900s)
          # timeout-seconds: "1200"
```

## Minimal Review Setup (single persona)

Generate this in `.github/workflows/opencode-review.yml`:

```yaml
name: OpenCode PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

jobs:
  review:
    if: github.event.pull_request.draft == false && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - name: Checkout PR head
        uses: actions/checkout@v6
        with:
          repository: ${{ github.event.pull_request.head.repo.full_name }}
          ref: ${{ github.event.pull_request.head.ref }}

      - name: Run OpenCode review
        uses: sun-praise/opencode-actions/multi-review@v4
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
          opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
          deepseek-api-key: ${{ secrets.DEEPSEEK_API_KEY }}
          litellm-url: ${{ secrets.LITELLM_URL }}
          litellm-api-key: ${{ secrets.LITELLM_API_KEY }}
          default-team: "quality:1"
```

## Comment Command Setup

Generate this in `.github/workflows/opencode-command.yml`:

```yaml
name: OpenCode Comment Command

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]

jobs:
  opencode:
    if: >-
      (contains(github.event.comment.body, '/oc') || contains(github.event.comment.body, '/opencode')) &&
      (github.event.comment.author_association == 'OWNER' ||
       github.event.comment.author_association == 'MEMBER' ||
       github.event.comment.author_association == 'COLLABORATOR')
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: write
      pull-requests: write
      issues: write
    steps:
      - name: Resolve checkout target
        id: target
        uses: actions/github-script@v8
        with:
          script: |
            const core = require('@actions/core')
            let repository = `${context.repo.owner}/${context.repo.repo}`
            let ref = context.sha
            let isFork = false

            if (context.eventName === 'pull_request_review_comment') {
              repository = context.payload.pull_request.head.repo.full_name
              ref = context.payload.pull_request.head.sha
              isFork = context.payload.pull_request.head.repo.fork
            } else if (context.eventName === 'issue_comment' && context.payload.issue.pull_request) {
              const pull = await github.rest.pulls.get({
                owner: context.repo.owner,
                repo: context.repo.repo,
                pull_number: context.payload.issue.number,
              })
              repository = pull.data.head.repo.full_name
              ref = pull.data.head.sha
              isFork = pull.data.head.repo.fork
            }

            core.setOutput('repository', repository)
            core.setOutput('ref', ref)
            core.setOutput('is_fork', isFork ? 'true' : 'false')

      - name: Skip fork PR commands
        if: ${{ steps.target.outputs.is_fork == 'true' }}
        shell: bash
        run: |
          set -euo pipefail
          printf 'Skipping OpenCode command on forked pull request comments to avoid exposing repository secrets.\n'

      - name: Checkout repository
        if: ${{ steps.target.outputs.is_fork != 'true' }}
        uses: actions/checkout@v6
        with:
          repository: ${{ steps.target.outputs.repository }}
          ref: ${{ steps.target.outputs.ref }}

      - name: Run OpenCode
        if: ${{ steps.target.outputs.is_fork != 'true' }}
        uses: sun-praise/opencode-actions/github-run-opencode@v4
        env:
          MODEL_NAME: zhipuai-coding-plan/glm-5.1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
          opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
          litellm-url: ${{ secrets.LITELLM_URL }}
          litellm-api-key: ${{ secrets.LITELLM_API_KEY }}
```

## Custom Reviewer Personas

Users can add custom reviewer personas by placing `.yaml` or `.yml` files in `.github/reviewers/`:

```yaml
# .github/reviewers/accessibility.yaml
name: accessibility
prompt: |
  Review this PR for accessibility issues...
```

Custom personas are referenced in `default-team` just like built-in ones: `"accessibility:1,quality:1"`.

## Available Personas

| Persona | Focus |
| --- | --- |
| `quality` | Code quality, bugs, style |
| `security` | Security vulnerabilities, injection, auth |
| `performance` | Performance issues, hot paths, resource leaks |
| `architecture` | Coupling, layering, module placement, structural concerns |
| `regression-test` | Missing regression tests for bug fixes |
| `feature-missing` | Missing features vs linked issue spec |
| `test-value` | Low-value tests: empty assertions, hardcoded mocks, duplicates |
| `spec-coverage` | Missing features vs project spec/task files |

## Secrets Setup

The user needs to configure at least one provider API key in their repository secrets:

1. Go to the repository on GitHub
2. Settings → Secrets and variables → Actions → New repository secret
3. Add one or more:
   - `DEEPSEEK_API_KEY` (recommended for multi-review)
   - `ZHIPU_API_KEY`
   - `OPENCODE_GO_API_KEY`
   - `LITELLM_URL` + `LITELLM_API_KEY`
   - `MINIMAX_API_KEY` (not compatible with multi-review)
   - `XIAOMI_API_KEY` (not compatible with multi-review)

`GITHUB_TOKEN` is automatically available in GitHub Actions.

## Version Pinning

- Use `@v4` for compatible updates within v4
- Security-sensitive repos should pin to a full commit SHA instead of `@v4`
- Immutable releases use semver tags like `v4.0.0`

For the complete list of inputs per action, see [references/actions-reference.md](references/actions-reference.md).
