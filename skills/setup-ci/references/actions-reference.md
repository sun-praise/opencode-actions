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
| `fallback-models` | empty | 备选模型列表（逗号或换行分隔） |
| `reasoning-effort` | `max` | 推理强度：`low` / `medium` / `high` / `max` |
| `enable-thinking` | `true` | 启用 thinking 模式 |
| `timeout-seconds` | `600` | 超时时间（秒），`0` 禁用 |
| `attempts` | `3` | 重试次数 |
| `working-directory` | empty | 工作目录 |
| `cache` | `true` | 启用缓存 |

## Required Permissions

```yaml
permissions:
  contents: read
  pull-requests: write
  issues: read       # feature-missing 需要
  id-token: write    # comment-command 需要
```

## Secrets 配置

在仓库 Settings → Secrets and variables → Actions 中添加：
- 至少配置一个 API key：`ZHIPU_API_KEY`、`DEEPSEEK_API_KEY` 或 `OPENCODE_GO_API_KEY`
- `GITHUB_TOKEN` 自动提供，无需手动配置
