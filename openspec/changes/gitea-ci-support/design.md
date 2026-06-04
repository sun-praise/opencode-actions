## Context

opencode-actions 的 `multi-review` action 使用 OpenCode SDK (`@opencode-ai/sdk`) 进行 LLM 推理，平台耦合仅存在于 `comment.ts`（PR diff 获取、评论发布、error comment 清理）和 `action.yml` 的 `pr-context` step。当前实现硬编码 `gh` CLI。

Gitea Actions 兼容 GitHub Actions 语法，自动注入 `GITHUB_REF`、`GITHUB_REPOSITORY`、`GITHUB_RUN_ID` 等同名环境变量。Gitea 提供 `tea` CLI 作为官方操作工具（gitea-tea-skill），API 风格与 GitHub REST 高度相似但存在端点和认证差异。

受影响模块：
- `multi-review/src/comment.ts` — 核心平台交互层
- `multi-review/action.yml` — PR context 获取
- `github-run-opencode/run-github-opencode.py` — Python 端 error comment 清理
- `review/action.yml` — review action 的 token 和 pr-context

## Goals / Non-Goals

**Goals:**
- multi-review 和 review action 在 Gitea Actions runner 上无修改即可运行
- 运行时自动检测平台（GitHub / Gitea），无需用户手动配置
- 对现有 GitHub Actions 用户零影响，纯增量改动
- Gitea 适配优先使用 `tea` CLI，REST API 作为回退

**Non-Goals:**
- 不支持 GitLab、Bitbucket 等其他平台
- 不修改 OpenCode SDK 本身
- 不改动 `opencode github run` 命令（那是 legacy review action 的路径）
- 不自动安装 `tea` CLI（要求 Runner 预装或在 workflow 中自行安装）

## Decisions

### D1: 平台检测策略 — 环境变量嗅探

**选择**: 检测 `GITEA_API_URL` 或 `GITHUB_SERVER_URL` 是否包含 gitea 关键字来判断平台。

**理由**: Gitea Actions 会设置 `GITHUB_SERVER_URL` 指向 Gitea 实例（如 `https://gitea.example.com`），同时额外设置 `GITEA_API_URL`（GitHub Actions 不设置此变量）。`GITEA_API_URL` 的存在是 100% 可靠的检测信号。

**备选方案**:
- 检测 `tea` CLI 是否存在 → 不可靠，可能用户装了 tea 但跑的是 GitHub
- 新增 `platform` input → 增加用户负担，且与"自动检测"目标冲突

### D2: 平台抽象层位置 — `platform.ts`

**选择**: 在 `multi-review/src/` 下新增 `platform.ts`，导出 3 个函数：
- `detectPlatform(): "github" | "gitea"`
- `fetchPRDiff(prNumber: string): string`
- `postPRComment(prNumber: string, body: string): void`
- `cleanupErrorComments(prNumber: string, runId: string): void`

**理由**: `comment.ts` 当前只有 ~90 行，直接在文件内分支即可，但抽到独立模块使得 Python 端和 TypeScript 端的逻辑对齐更清晰，且后续加其他平台时扩展容易。

### D3: Gitea API 调用方式 — tea CLI 优先 + REST 回退

**选择**: 先尝试 `tea` CLI，如果不可用则直接 HTTP 调 Gitea REST API。

**理由**: `tea` 是 Gitea 官方推荐，且已有 gitea-tea-skill 可加载。但 Runner 可能没装 tea，此时 REST API 回退确保不中断。Gitea REST API 与 GitHub 高度相似：
- GET diff: `GET /repos/{owner}/{repo}/pulls/{number}.diff`
- POST comment: `POST /repos/{owner}/{repo}/issues/{number}/comments`
- DELETE comment: `DELETE /repos/{owner}/{repo}/issues/comments/{id}`

### D4: Token 处理

**选择**: 新增 `gitea-token` input，内部统一为 `PLATFORM_TOKEN`。检测到 Gitea 时优先使用 `gitea-token`，否则 fallback 到 `GITEA_TOKEN` 环境变量（Gitea Actions 自动注入）。

**理由**: Gitea Actions 自动注入 `GITEA_TOKEN`，但用户可能需要传入有更高权限的 token（如跨 repo 评论），所以保留 explicit input。

### D5: PR diff 获取在 action.yml 还是 TS 中

**选择**: 将 pr-context step 中的 diff 获取逻辑移到 TypeScript 中，action.yml 只负责安装和调用。

**理由**: 当前 multi-review 的 `action.yml` 用 `gh pr diff` 获取 diff 再传给 TS。适配 Gitea 需要在 yml 中写平台分支，bash 分支逻辑难维护。移到 TS 统一处理更干净。review action（Python 端）保持 yml 中的 bash 分支，因为 Python 不跑 multi-review 路径。

## Risks / Trade-offs

- **[Risk] tea CLI API 不稳定** → Mitigation: REST API 回退兜底；tea 仅用于基本操作（diff、comment），不依赖高级功能
- **[Risk] Gitea REST API 与 GitHub 细节差异** → Mitigation: diff endpoint 返回 raw diff 格式一致；comment API payload 结构几乎相同；错误时 fallback 到 stdout 输出
- **[Risk] 双平台测试覆盖** → Mitigation: 先用 mock 测试平台检测和 API 调用逻辑，后续在真实 Gitea Runner 上 e2e 验证
- **[Trade-off] 不自动安装 tea** → 用户需在 workflow 中预装或使用含 tea 的 Runner 镜像，但避免了 action 内部包管理的复杂性
