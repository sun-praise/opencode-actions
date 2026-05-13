# opencode-actions Reference

## Available Actions

### review — PR 代码审查
- **用途**: 自动审查 PR 代码质量、潜在 bug、安全问题
- **触发**: `pull_request` (opened, synchronize, reopened, ready_for_review)
- **输出语言**: 中文，首行给出合并判定（可合并 / 有条件合并 / 不可合并）

### feature-missing — PR 功能完整性审计
- **用途**: 对比 PR 关联的 issue spec 与实际实现，发现遗漏
- **触发**: 同 review
- **输出语言**: 中文，首行给出判定（无遗漏 / 发现遗漏）

### spec-coverage — 规格覆盖审计
- **用途**: 对比项目 spec/task 文件与 PR 实现，发现未实现的功能
- **触发**: 同 review
- **输出语言**: 中文，首行给出判定（无需审计 / 全覆盖 / 发现遗漏）

### github-run-opencode — 通用 opencode 执行
- **用途**: 最灵活的封装，可自定义 prompt 执行任意 `opencode github run` 任务
- **触发**: 按需（可绑定 issue_comment、pull_request 等）

## Common Inputs (所有 action 共享)

| Input | Default | Description |
| --- | --- | --- |
| `github-token` | empty | GitHub token，通常用 `${{ secrets.GITHUB_TOKEN }}` |
| `zhipu-api-key` | empty | 智谱 API key |
| `deepseek-api-key` | empty | DeepSeek API key |
| `opencode-go-api-key` | empty | OpenCode Go API key |
| `model` | auto | 模型名称，默认 `zhipuai-coding-plan/glm-5.1` |
| `prompt` | varies by action | 自定义 prompt（各 action 有不同内置默认值） |
| `fallback-models` | empty | 备选模型列表（逗号或换行分隔） |
| `model-timeout-seconds` | `300` | 单模型超时（秒），超时后切换备选模型，`0` 禁用 |
| `fallback-on-regex` | timeout regex | 输出匹配此正则时切换备选模型 |
| `reasoning-effort` | `max` | 推理强度：`low` / `medium` / `high` / `max` |
| `enable-thinking` | `true` | 启用 thinking 模式 |
| `timeout-seconds` | `600` | `opencode github run` 总超时（秒），`0` 禁用 |
| `attempts` | `3` | 重试次数 |
| `retry-profile` | `github-network` | 内置重试预设 |
| `retry-on-regex` | empty | 仅当输出匹配此正则时重试 |
| `retry-delay-seconds` | `15` | 重试间隔（秒） |
| `working-directory` | empty | 工作目录 |
| `cache` | `true` | 启用缓存 |
| `cache-key` | `v1` | 缓存 key 后缀 |
| `install-url` | `https://opencode.ai/install` | 安装器 URL |
| `install-attempts` | `3` | 安装重试次数 |
| `allow-preinstalled` | `false` | 复用 PATH 上已有的 opencode |
| `version` | auto | 最低 opencode 版本要求，`none` 禁用检查 |
| `use-github-token` | `true` | 是否导出 `USE_GITHUB_TOKEN` |

## Action-Specific Inputs

### review

| Input | Default | Description |
| --- | --- | --- |
| `extra-env` | empty | 额外环境变量（多行 `KEY=VALUE`，空行和 `#` 注释忽略） |

### feature-missing

无特有 inputs，使用 common inputs 即可。

### spec-coverage

| Input | Default | Description |
| --- | --- | --- |
| `extra-env` | empty | 额外环境变量（多行 `KEY=VALUE`，空行和 `#` 注释忽略） |

### github-run-opencode

无特有 inputs，使用 common inputs 即可。注意此 action 的 `prompt` 默认为空，需用户自行提供。

## Required Permissions

```yaml
# Per-job permissions — use the minimum required for each action:
#
# review:            contents: read, pull-requests: write, issues: write
# feature-missing:   contents: read, pull-requests: write, issues: read
# spec-coverage:     contents: read, pull-requests: write
# comment-command:   id-token: write, contents: write, pull-requests: write, issues: write
```

## Secrets 配置

在仓库 Settings → Secrets and variables → Actions 中添加：
- 至少配置一个 API key：`ZHIPU_API_KEY`、`DEEPSEEK_API_KEY` 或 `OPENCODE_GO_API_KEY`
- `GITHUB_TOKEN` 自动提供，无需手动配置
