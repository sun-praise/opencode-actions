## ADDED Requirements

### Requirement: 平台自动检测
系统 SHALL 在运行时自动检测当前 CI 平台为 GitHub 或 Gitea，无需用户手动配置。

#### Scenario: GitHub Actions 环境
- **WHEN** 环境变量 `GITEA_API_URL` 不存在
- **THEN** 系统 SHALL 识别为 `github` 平台

#### Scenario: Gitea Actions 环境
- **WHEN** 环境变量 `GITEA_API_URL` 存在且非空
- **THEN** 系统 SHALL 识别为 `gitea` 平台

### Requirement: 统一 PR diff 获取接口
系统 SHALL 提供平台无关的 `fetchPRDiff(prNumber)` 函数，返回 PR 的 unified diff 文本。

#### Scenario: GitHub 平台获取 diff
- **WHEN** 检测到 `github` 平台且存在 `gh` CLI
- **THEN** 系统 SHALL 使用 `gh pr diff <number>` 获取 diff

#### Scenario: Gitea 平台获取 diff（tea CLI 可用）
- **WHEN** 检测到 `gitea` 平台且 `tea` CLI 可用
- **THEN** 系统 SHALL 使用 `tea pr diff <number>` 获取 diff

#### Scenario: Gitea 平台获取 diff（tea CLI 不可用）
- **WHEN** 检测到 `gitea` 平台且 `tea` CLI 不可用
- **THEN** 系统 SHALL 通过 Gitea REST API `GET /repos/{owner}/{repo}/pulls/{number}.diff` 获取 diff

### Requirement: 统一 PR 评论发布接口
系统 SHALL 提供平台无关的 `postPRComment(prNumber, body)` 函数，将评论发布到当前 PR。

#### Scenario: GitHub 平台发布评论
- **WHEN** 检测到 `github` 平台
- **THEN** 系统 SHALL 使用 `gh pr comment <number> --body <body>` 发布评论

#### Scenario: Gitea 平台发布评论（tea CLI 可用）
- **WHEN** 检测到 `gitea` 平台且 `tea` CLI 可用
- **THEN** 系统 SHALL 使用 `tea` CLI 或 Gitea REST API 发布评论

#### Scenario: Gitea 平台发布评论（tea CLI 不可用）
- **WHEN** 检测到 `gitea` 平台且 `tea` CLI 不可用
- **THEN** 系统 SHALL 通过 Gitea REST API `POST /repos/{owner}/{repo}/issues/{number}/comments` 发布评论

#### Scenario: 评论发布失败
- **WHEN** 评论发布因任何原因失败（网络、权限、API 错误）
- **THEN** 系统 SHALL 将评论内容 fallback 输出到 stdout，且不终止流程（exit code 0）

### Requirement: 统一 error comment 清理接口
系统 SHALL 提供平台无关的 `cleanupErrorComments(prNumber, runId)` 函数，删除当前 run 产生的错误评论。

#### Scenario: GitHub 平台清理错误评论
- **WHEN** 检测到 `github` 平台
- **THEN** 系统 SHALL 使用 `gh api` 按现有逻辑（匹配 run link + error indicators）查找并删除错误评论

#### Scenario: Gitea 平台清理错误评论
- **WHEN** 检测到 `gitea` 平台
- **THEN** 系统 SHALL 使用 Gitea REST API 查找并删除匹配的错误评论，匹配逻辑与 GitHub 一致

#### Scenario: 清理功能被禁用
- **WHEN** 配置参数 `cleanup-error-comments` 设为非 `true`
- **THEN** 系统 SHALL 跳过清理，无论平台

### Requirement: 非 PR 上下文的 fallback 行为
- **WHEN** 无法解析 PR 编号（如 push 事件或本地运行）
- **THEN** 系统 SHALL 将 review 结果输出到 stdout，不尝试调用任何平台 API
