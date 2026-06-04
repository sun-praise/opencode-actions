## Why

opencode-actions 的 multi-review action 已经通过 OpenCode SDK 实现了 LLM 推理与 GitHub 平台的解耦，但 PR diff 获取、评论发布、error comment 清理等操作仍硬编码为 `gh` CLI + GitHub REST API。Gitea Actions 兼容 GitHub Actions 语法，且 lunny 建议使用 `tea` CLI（gitea-tea-skill）作为桥梁。现在 SDK 层已平台无关，适配 Gitea 的成本最低点就是此刻。

## What Changes

- 引入平台检测层（`platform.ts`），运行时自动识别 GitHub / Gitea 环境
- 抽象 PR diff 获取、评论发布、评论清理为平台无关接口
- Gitea 适配使用 `tea` CLI（优先）或 Gitea REST API（回退）
- `action.yml` 中 `pr-context` step 增加平台分支逻辑
- 新增 `gitea-token` input，与现有 `github-token` 并列
- review action 的 Python 脚本同步适配 `cleanup_error_comments` 中的平台分支

## Capabilities

### New Capabilities
- `platform-abstraction`: 平台检测与抽象接口，封装 GitHub/Gitea 差异（diff 获取、评论发布、评论清理），对上层暴露统一 API
- `gitea-ci-adapter`: Gitea 平台的具体适配实现（tea CLI / Gitea REST API），包括环境变量映射和 API 端点差异处理

### Modified Capabilities
（无已有 spec 文件，无需修改）

## Impact

- **multi-review/src/comment.ts**: 核心改动文件，从直接调用 `gh` 改为调用平台抽象层
- **multi-review/action.yml**: pr-context step 增加平台分支，新增 `gitea-token` input
- **github-run-opencode/run-github-opencode.py**: `cleanup_error_comments` 函数增加 Gitea 分支
- **review/action.yml**: 同步新增 `gitea-token` input
- **依赖**: Gitea Runner 需预装 `tea` CLI（或 action 自动安装）
- **向后兼容**: 不影响现有 GitHub Actions 用户，纯增量改动
