## ADDED Requirements

### Requirement: Gitea Token 配置
系统 SHALL 支持 `gitea-token` action input，用于认证 Gitea API 请求。

#### Scenario: 用户显式传入 gitea-token
- **WHEN** action input `gitea-token` 非空且平台为 Gitea
- **THEN** 系统 SHALL 使用该 token 进行所有 Gitea API 调用

#### Scenario: 未传入 gitea-token 但 Gitea 自动注入了 token
- **WHEN** action input `gitea-token` 为空且环境变量 `GITEA_TOKEN` 存在
- **THEN** 系统 SHALL 使用 `GITEA_TOKEN` 环境变量作为认证 token

#### Scenario: 两个 token 都不存在
- **WHEN** `giteu-token` input 为空且 `GITEA_TOKEN` 环境变量不存在
- **THEN** 系统 SHALL 在 stderr 打印警告，并 fallback 到 stdout 输出评论

### Requirement: Gitea REST API 端点适配
系统 SHALL 使用正确的 Gitea REST API 端点路径，基于 `GITEA_API_URL` 环境变量构造请求。

#### Scenario: 构造 API base URL
- **WHEN** 检测到 `gitea` 平台
- **THEN** 系统 SHALL 使用 `GITEA_API_URL`（如 `https://gitea.example.com/api/v1`）作为 API base URL

#### Scenario: 获取 PR diff
- **WHEN** 系统通过 REST API 获取 Gitea PR diff
- **THEN** 系统 SHALL 请求 `GET {base}/repos/{owner}/{repo}/pulls/{number}.diff`，使用 Accept: `text/plain` header

#### Scenario: 发布 PR 评论
- **WHEN** 系统通过 REST API 发布评论
- **THEN** 系统 SHALL POST 到 `{base}/repos/{owner}/{repo}/issues/{number}/comments`，body 为 JSON `{ "body": "<content>" }`

#### Scenario: 删除评论
- **WHEN** 系统通过 REST API 删除错误评论
- **THEN** 系统 SHALL DELETE `{base}/repos/{owner}/{repo}/issues/comments/{id}`

### Requirement: Gitea 环境变量映射
系统 SHALL 将 Gitea Actions 注入的 `GITHUB_*` 环境变量正确映射到内部使用。

#### Scenario: 解析 PR 编号
- **WHEN** Gitea Actions 设置 `GITHUB_REF=refs/pull/123/merge`
- **THEN** 系统 SHALL 使用与 GitHub 相同的正则 `refs/pull/(\d+)/merge` 解析出 PR 编号 123

#### Scenario: 解析 repo 信息
- **WHEN** Gitea Actions 设置 `GITHUB_REPOSITORY=owner/repo`
- **THEN** 系统 SHALL 使用与 GitHub 相同的方式拆分 owner 和 repo

### Requirement: action.yml 新增 gitea-token input
multi-review 和 review 的 `action.yml` SHALL 新增 `gitea-token` input。

#### Scenario: input 定义
- **WHEN** 用户在 workflow 中配置 `gitea-token: ${{ secrets.GITEA_TOKEN }}`
- **THEN** 该值 SHALL 被传递到运行时环境变量 `GITEA_TOKEN`（如果环境变量不存在或为空）

### Requirement: Python 端 cleanup_error_comments 适配
`run-github-opencode.py` 中的 `cleanup_error_comments` 函数 SHALL 支持平台分支。

#### Scenario: Gitea 平台的 comment 清理
- **WHEN** 检测到 Gitea 平台且 cleanup 功能启用
- **THEN** Python 端 SHALL 使用 Gitea REST API（通过 requests 或 urllib）查找并删除错误评论，逻辑与 TypeScript 端一致
