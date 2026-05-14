# opencode-actions

[中文文档](#中文文档)

Reusable GitHub Actions for installing and running OpenCode in other repositories.

This repository is licensed under Apache 2.0.

## TLDR

Write this in your CI.yaml

```yaml
- name: Run OpenCode review
  uses: Svtter/opencode-actions/review@v2
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}

    # only one is enough.
    deepseek-api-key: ${{ secrets.DEEPSEEK_API_KEY }}
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
| `reasoning-effort` | `max` | Reasoning effort level for the model agent (`low`, `medium`, `high`, `max`) |
| `enable-thinking` | `true` | Enable thinking mode for the model agent |
| `use-github-token` | `true` | Exported as `USE_GITHUB_TOKEN` before `opencode github run` |
| `language` | `zh` | Response language: `zh` for Chinese, `en` for English |
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

## feature-missing

Use this alongside `review` to audit whether a PR's implementation covers all requirements from the linked issue spec.

- automatically reads the linked issue body as the feature spec via `gh pr view`
- if no linked issue, extracts requirements from the PR title and body
- classifies gaps by severity: CRITICAL, MEDIUM, LOW
- shares the same inputs and cache as `review`/`github-run-opencode`

```yaml
- name: Run feature missing audit
  uses: Svtter/opencode-actions/feature-missing@v2
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
  uses: Svtter/opencode-actions/spec-coverage@v2
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
    opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
```

### How the three review actions differ

| Action | Scope source | What it catches |
| --- | --- | --- |
| `review` | PR diff | Code quality, security, bugs |
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
uses: Svtter/opencode-actions/review@v2
uses: Svtter/opencode-actions/feature-missing@v2
uses: Svtter/opencode-actions/spec-coverage@v2
uses: Svtter/opencode-actions/github-run-opencode@v2
uses: Svtter/opencode-actions/setup-opencode@v2
uses: Svtter/opencode-actions/run-opencode@v2
```

```yaml
- name: Run OpenCode review
  uses: Svtter/opencode-actions/review@v2
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
    opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
```

To use English output, set the `language` input:

```yaml
- name: Run OpenCode review (English)
  uses: Svtter/opencode-actions/review@v2
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    language: en
```

Or configure it from repository variables:

```yaml
- name: Run OpenCode review
  uses: Svtter/opencode-actions/review@v2
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    language: ${{ vars.OPENCODE_LANGUAGE }}
```

More examples live in `examples/`.

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
- smoke-tests all actions through `uses: ./setup-opencode`, `uses: ./run-opencode`, `uses: ./github-run-opencode`, `uses: ./review`, `uses: ./feature-missing`, and `uses: ./spec-coverage`

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
5. Use `owner/repo/review@v2` for the simplest review setup, `owner/repo/feature-missing@v2` for PR scope audit, `owner/repo/spec-coverage@v2` for spec coverage audit, `owner/repo/github-run-opencode@v2` for generic `github run`, or `owner/repo/setup-opencode@v2` plus `owner/repo/run-opencode@v2` for more control.

The initial release-notes template lives at `docs/releases/v1.0.0.md`.

## Limitations

- `args` is parsed as a space-delimited string, so keep complex text in environment variables like `PROMPT`
- the installer is external, so cache invalidation uses `cache-key` instead of a guaranteed version pin
- first version is optimized for GitHub-hosted or Linux self-hosted runners

---

# 中文文档

[English Documentation](#opencode-actions)

可复用的 GitHub Actions，用于在其他仓库中安装和运行 OpenCode。

本仓库基于 Apache 2.0 许可证。

## 快速开始

在你的 CI.yaml 中写入：

```yaml
- name: Run OpenCode review
  uses: Svtter/opencode-actions/review@v2
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}

    # 以下密钥只需提供一个即可
    deepseek-api-key: ${{ secrets.DEEPSEEK_API_KEY }}
    zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
    opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
```

你将获得一个自动化的 PR 审查机器人（默认中文回复，可通过 `language` 输入切换语言）。

或将技能添加到你的项目：

```bash
npx skills add sun-praise/opencode-actions
```

## 包含的 Actions

- `review`：内置 prompt 和模型默认值的 PR 审查封装
- `feature-missing`：对照关联 issue 的需求，审计 PR 实现的完整性
- `spec-coverage`：对照项目规格/任务文件，交叉检查 PR 实现的覆盖度
- `github-run-opencode`：`opencode github run` 常用工作流的一步封装
- `setup-opencode`：安装 OpenCode，恢复缓存，导出二进制路径
- `run-opencode`：运行 `opencode`，支持 GitHub 网络抖动的重试逻辑

## 语言配置

所有 action 均支持 `language` 输入参数，用于控制 agent 的回复语言：

- `zh`（默认）：中文回复
- `en`：英文回复

```yaml
- name: Run OpenCode review (英文)
  uses: Svtter/opencode-actions/review@v2
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    language: en
```

也可以从仓库变量中读取：

```yaml
- name: Run OpenCode review
  uses: Svtter/opencode-actions/review@v2
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    language: ${{ vars.OPENCODE_LANGUAGE }}
```

## 三个审查 Action 的区别

| Action | 审查范围 | 发现的问题 |
| --- | --- | --- |
| `review` | PR diff | 代码质量、安全问题、Bug |
| `feature-missing` | PR 标题/正文 + 关联 issue | PR 自述需求的完整性 |
| `spec-coverage` | 项目规格/任务文件 | 计划范围 vs 实际实现的差距 |

## review

最简单的 PR 审查方案。

- 内置审查 prompt 模板
- 内置 `MODEL` 解析：显式 `model` 输入 > `MODEL_NAME` 环境变量 > `zhipuai-coding-plan/glm-5.1`
- 内置 `timeout-seconds` 默认值：`600`（10 分钟）
- 可选的 `fallback-models` 支持超时驱动的模型轮换

## feature-missing

配合 `review` 使用，审计 PR 是否完整实现了关联 issue 中的需求。

- 自动通过 `gh pr view` 读取关联 issue 作为需求规格
- 如无关联 issue，从 PR 标题和正文提取需求
- 按严重程度分类：CRITICAL / MEDIUM / LOW

```yaml
- name: Run feature missing audit
  uses: Svtter/opencode-actions/feature-missing@v2
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
    opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
```

## spec-coverage

配合 `review` 和 `feature-missing` 使用，审计 PR 是否实现了项目规格/任务文件中的全部计划。

与 `feature-missing`（检查 PR 自述范围）不同，`spec-coverage` 使用项目自身的规格文件作为**预期范围的权威来源**。可以发现 PR 实现了大型计划功能的一部分但跳过了关键集成步骤的情况。

- 自动发现 `openspec/changes/*/tasks.md`、`specs/**` 等位置的规格文件
- 智能跳过不需要规格的 bug 修复和小改动
- 当功能型 PR 缺少规格文件时报告为 CRITICAL 级别的遗漏
- 按严重程度分类：CRITICAL / MEDIUM / LOW

```yaml
- name: Run spec coverage audit
  uses: Svtter/opencode-actions/spec-coverage@v2
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
    opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
```

## github-run-opencode

当你需要最简短的 `opencode github run` 工作流时使用。

### 常用输入

| 输入 | 默认值 | 描述 |
| --- | --- | --- |
| `model` | `MODEL_NAME`，否则 `zhipuai-coding-plan/glm-5.1` | 在 `opencode github run` 前导出为 `MODEL` |
| `fallback-models` | 空 | 可选的有序回退模型列表，按可用 API 密钥过滤 |
| `prompt` | 内置 PR 审查模板 | 在 `opencode github run` 前导出为 `PROMPT` |
| `language` | `zh` | 回复语言：`zh` 中文，`en` 英文 |
| `github-token` | 空 | 在 `opencode github run` 前导出为 `GITHUB_TOKEN` |
| `zhipu-api-key` | 空 | 在 `opencode github run` 前导出为 `ZHIPU_API_KEY` |
| `deepseek-api-key` | 空 | 在 `opencode github run` 前导出为 `DEEPSEEK_API_KEY` |
| `opencode-go-api-key` | 空 | 在 `opencode github run` 前导出为 `OPENCODE_GO_API_KEY` |
| `reasoning-effort` | `max` | 模型推理力度（`low`、`medium`、`high`、`max`） |
| `enable-thinking` | `true` | 启用模型的 thinking 模式 |
| `attempts` | `3` | 失败前的总尝试次数 |
| `timeout-seconds` | `600` | `opencode github run` 的最大执行时间；`0` 禁用 |

## setup-opencode

### 输入

| 输入 | 默认值 | 描述 |
| --- | --- | --- |
| `install-url` | `https://opencode.ai/install` | 引导安装 OpenCode 的安装器 URL |
| `install-dir` | 自动计算 | `opencode` 安装目录 |
| `xdg-cache-home` | 自动计算 | XDG 缓存目录 |
| `cache` | `true` | 启用 `actions/cache` 缓存 |
| `cache-key` | `v1` | 用于使安装器缓存失效的键后缀 |
| `install-attempts` | `3` | 安装器总尝试次数 |
| `allow-preinstalled` | `false` | 复用 PATH 上已有的可信 `opencode` |

## 使用方式

```yaml
uses: Svtter/opencode-actions/review@v2
uses: Svtter/opencode-actions/feature-missing@v2
uses: Svtter/opencode-actions/spec-coverage@v2
uses: Svtter/opencode-actions/github-run-opencode@v2
uses: Svtter/opencode-actions/setup-opencode@v2
uses: Svtter/opencode-actions/run-opencode@v2
```

更多示例请参见 `examples/` 目录。

## 本地验证

```bash
bash tests/test.sh
```

## 发布清单

1. 公开推送仓库。
2. 确认 `main` 分支的 CI 通过。
3. 创建带有 semver 标签（如 `v1.0.0`）的 GitHub Release。
4. 确认 `Update Major Tag` 工作流将 `v1` 标签移至该 release。
5. 使用 `owner/repo/review@v2` 进行审查，`owner/repo/feature-missing@v2` 进行 PR 范围审计，`owner/repo/spec-coverage@v2` 进行规格覆盖审计。
