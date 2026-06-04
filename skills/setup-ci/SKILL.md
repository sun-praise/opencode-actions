---
name: setup-ci
description: Configure opencode-actions GitHub Actions workflows for a repository. Use when the user wants to set up automated PR review, feature-missing audit, spec-coverage audit, or comment-triggered opencode commands in their CI. Triggers on requests like "帮我配置 CI", "设置 PR review", "添加 opencode action", "配置自动审查", or any task involving adding opencode-actions workflows to a GitHub repository.
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
| PR code review | `review` | Quality, bugs, security — Chinese output |
| Architecture review | `architect-review` | Coupling, layering, structural concerns |
| Multi-agent review | `multi-review` | Parallel reviewer personas + coordinator synthesis |
| PR scope audit | `feature-missing` | Missing features vs linked issue spec |
| Spec coverage | `spec-coverage` | Missing features vs project spec files |
| Custom command | `github-run-opencode` | Flexible, user-defined prompt |
| Manual setup | `setup-opencode` + `run-opencode` | Full control over install and run |

Users typically combine `review` + `multi-review` + `feature-missing` for full coverage, or use `multi-review` alone for comprehensive parallel review.


## Recommended Models

| Model | Provider | Required Secret | Notes |
| --- | --- | --- | --- |
| `deepseek/deepseek-v4-flash` | DeepSeek | `DEEPSEEK_API_KEY` | Fast and cost-effective; recommended for multi-review |
| `zhipuai-coding-plan/glm-5.1` | Zhipu | `ZHIPU_API_KEY` | General-purpose, good balance of speed and quality |
| `opencode-go/deepseek-v4-flash` | OpenCode Go | `OPENCODE_GO_API_KEY` | Proxy service, uses DeepSeek under the hood |
| `minimax-cn-coding-plan/MiniMax-M3` | MiniMax | `MINIMAX_API_KEY` | Chinese-language review; not compatible with multi-review ([why?](references/actions-reference.md#model-constraints)) |
| `xiaomi-token-plan-cn/mimo-v2-pro` | Xiaomi MiMo | `XIAOMI_API_KEY` | Token Plan (China); not compatible with multi-review ([why?](references/actions-reference.md#model-constraints)) |
| `openrouter/deepseek/deepseek-v4-flash` | OpenRouter | `OPENROUTER_API_KEY` | Access multiple providers through OpenRouter; recommended for multi-review |
| `stepfun/step-1r-flash` | StepFun | `STEPFUN_API_KEY` | StepFun Step reasoning model |

Set via `model:` input in the `with:` block (e.g. `model: ${{ vars.MODEL_NAME }}`), or configure `MODEL_NAME` as a repository variable in Settings → Secrets and variables → Actions → Variables to switch models without modifying workflow files.

## Architect Review Setup

Generate this in `.github/workflows/opencode-architect-review.yml`:

```yaml
name: OpenCode Architect Review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

jobs:
  architect-review:
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

      - name: Run architect review
        uses: sun-praise/opencode-actions/architect-review@v3
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
          minimax-api-key: ${{ secrets.MINIMAX_API_KEY }}
          xiaomi-api-key: ${{ secrets.XIAOMI_API_KEY }}
          openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
          stepfun-api-key: ${{ secrets.STEPFUN_API_KEY }}
```

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
        uses: sun-praise/opencode-actions/multi-review@v3
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          deepseek-api-key: ${{ secrets.DEEPSEEK_API_KEY }}
          zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
          opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
          openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
          stepfun-api-key: ${{ secrets.STEPFUN_API_KEY }}
          # Optional: override default reviewer team (default: quality:1,security:1,performance:1)
          # default-team: "quality:2,security:1,architecture:1"
          # Optional: increase timeout for large PRs (default: 900s)
          # timeout-seconds: "1200"
```


## Minimal Review Setup

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
        uses: sun-praise/opencode-actions/review@v3
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
          opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
          openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
          stepfun-api-key: ${{ secrets.STEPFUN_API_KEY }}
          minimax-api-key: ${{ secrets.MINIMAX_API_KEY }}
          xiaomi-api-key: ${{ secrets.XIAOMI_API_KEY }}
          openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
          stepfun-api-key: ${{ secrets.STEPFUN_API_KEY }}
```

## Full Audit Setup (Review + Feature-Missing + Spec-Coverage)

Generate this in `.github/workflows/opencode-audit.yml`:

```yaml
name: OpenCode Audit

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
        uses: sun-praise/opencode-actions/review@v3
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
          opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
          openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
          stepfun-api-key: ${{ secrets.STEPFUN_API_KEY }}
          minimax-api-key: ${{ secrets.MINIMAX_API_KEY }}
          xiaomi-api-key: ${{ secrets.XIAOMI_API_KEY }}
          openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
          stepfun-api-key: ${{ secrets.STEPFUN_API_KEY }}
  feature-missing:
    if: github.event.pull_request.draft == false && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: read
    steps:
      - name: Checkout PR head
        uses: actions/checkout@v6
        with:
          repository: ${{ github.event.pull_request.head.repo.full_name }}
          ref: ${{ github.event.pull_request.head.ref }}

      - name: Run feature missing audit
        uses: sun-praise/opencode-actions/feature-missing@v3
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
          opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
          openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
          stepfun-api-key: ${{ secrets.STEPFUN_API_KEY }}
          minimax-api-key: ${{ secrets.MINIMAX_API_KEY }}
          xiaomi-api-key: ${{ secrets.XIAOMI_API_KEY }}
          openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
          stepfun-api-key: ${{ secrets.STEPFUN_API_KEY }}

  spec-coverage:
    if: github.event.pull_request.draft == false && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - name: Checkout PR head
        uses: actions/checkout@v6
        with:
          repository: ${{ github.event.pull_request.head.repo.full_name }}
          ref: ${{ github.event.pull_request.head.ref }}

      - name: Run spec coverage audit
        uses: sun-praise/opencode-actions/spec-coverage@v3
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
          opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
          openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
          stepfun-api-key: ${{ secrets.STEPFUN_API_KEY }}
          minimax-api-key: ${{ secrets.MINIMAX_API_KEY }}
          xiaomi-api-key: ${{ secrets.XIAOMI_API_KEY }}
          openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
          stepfun-api-key: ${{ secrets.STEPFUN_API_KEY }}
```

## Comment Command Setup

Generate this in `.github/workflows/opencode-command.yml` for `/oc` or `/opencode` comment triggers:

```yaml
name: OpenCode Command

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
        uses: sun-praise/opencode-actions/github-run-opencode@v3
        env:
          MODEL_NAME: zhipuai-coding-plan/glm-5.1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
          opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
          openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
          stepfun-api-key: ${{ secrets.STEPFUN_API_KEY }}
          minimax-api-key: ${{ secrets.MINIMAX_API_KEY }}
          xiaomi-api-key: ${{ secrets.XIAOMI_API_KEY }}
          openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
          stepfun-api-key: ${{ secrets.STEPFUN_API_KEY }}
```

## Customization Checklist

When generating workflows, remind the user about:

1. **API Key**: At least one of `DEEPSEEK_API_KEY`, `ZHIPU_API_KEY`, `OPENCODE_GO_API_KEY`, `MINIMAX_API_KEY`, `XIAOMI_API_KEY`, `OPENROUTER_API_KEY`, or `STEPFUN_API_KEY` must be configured in repository Secrets. For multi-review, `DEEPSEEK_API_KEY` or `OPENROUTER_API_KEY` is recommended — see [Model Constraints](references/actions-reference.md#model-constraints) for details.
2. **Model override**: Set `model:` input or `MODEL_NAME` env var to change the default model
3. **Fallback models**: Use `fallback-models:` for timeout-driven model rotation
4. **Timeout**: Default is 600s (10 min); adjust via `timeout-seconds:`
5. **Fork PRs**: All templates skip fork PRs by default (secrets are not available)
6. **Draft PRs**: All templates skip draft PRs via the `if:` guard
7. **Version pinning**: Security-sensitive repos should pin to a full commit SHA instead of `@v3`

For the complete list of inputs per action, see [references/actions-reference.md](references/actions-reference.md).
