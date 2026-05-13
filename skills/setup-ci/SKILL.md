---
name: setup-ci
description: Configure opencode-actions GitHub Actions workflows for a repository. Use when the user wants to set up automated PR review, feature-missing audit, spec-coverage audit, or comment-triggered opencode commands in their CI. Triggers on requests like "帮我配置 CI", "设置 PR review", "添加 opencode action", "配置自动审查", or any task involving adding opencode-actions workflows to a GitHub repository.
---

# Setup opencode-actions CI

Configure `Svtter/opencode-actions` GitHub Actions for a user's repository.

## Workflow

1. Ask the user which actions they want and their repository info
2. Check the action reference for available options: see [references/actions-reference.md](references/actions-reference.md)
3. Generate the workflow YAML file(s)
4. Guide the user on secrets and permissions setup

## Action Selection

| Need | Action | One-liner |
| --- | --- | --- |
| PR code review | `review` | Quality, bugs, security — Chinese output |
| PR scope audit | `feature-missing` | Missing features vs linked issue spec |
| Spec coverage | `spec-coverage` | Missing features vs project spec files |
| Custom command | `github-run-opencode` | Flexible, user-defined prompt |
| Manual setup | `setup-opencode` + `run-opencode` | Full control over install and run |

Users typically combine `review` + `feature-missing` + `spec-coverage` for full coverage.

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
    steps:
      - uses: actions/checkout@v6
        with:
          repository: ${{ github.event.pull_request.head.repo.full_name }}
          ref: ${{ github.event.pull_request.head.ref }}

      - uses: Svtter/opencode-actions/review@v2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
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
      - uses: actions/checkout@v6
        with:
          repository: ${{ github.event.pull_request.head.repo.full_name }}
          ref: ${{ github.event.pull_request.head.ref }}

      - uses: Svtter/opencode-actions/review@v2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}

  feature-missing:
    if: github.event.pull_request.draft == false && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: read
    steps:
      - uses: actions/checkout@v6
        with:
          repository: ${{ github.event.pull_request.head.repo.full_name }}
          ref: ${{ github.event.pull_request.head.ref }}

      - uses: Svtter/opencode-actions/feature-missing@v2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}

  spec-coverage:
    if: github.event.pull_request.draft == false && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
        with:
          repository: ${{ github.event.pull_request.head.repo.full_name }}
          ref: ${{ github.event.pull_request.head.ref }}

      - uses: Svtter/opencode-actions/spec-coverage@v2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
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

      - uses: Svtter/opencode-actions/github-run-opencode@v2
        if: ${{ steps.target.outputs.is_fork != 'true' }}
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
```

## Customization Checklist

When generating workflows, remind the user about:

1. **API Key**: At least one of `ZHIPU_API_KEY`, `DEEPSEEK_API_KEY`, or `OPENCODE_GO_API_KEY` must be configured in repository Secrets
2. **Model override**: Set `model:` input or `MODEL_NAME` env var to change the default model
3. **Fallback models**: Use `fallback-models:` for timeout-driven model rotation
4. **Timeout**: Default is 600s (10 min); adjust via `timeout-seconds:`
5. **Fork PRs**: All templates skip fork PRs by default (secrets are not available)
6. **Draft PRs**: All templates skip draft PRs via the `if:` guard
7. **Version pinning**: Security-sensitive repos should pin to a full commit SHA instead of `@v2`

For the complete list of inputs per action, see [references/actions-reference.md](references/actions-reference.md).
