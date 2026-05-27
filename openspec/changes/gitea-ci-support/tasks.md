## 1. 平台抽象层核心

- [x] 1.1 新建 `multi-review/src/platform.ts`：实现 `detectPlatform()` 函数，通过 `GITEA_API_URL` 环境变量检测平台，返回 `"github" | "gitea"`
- [x] 1.2 在 `platform.ts` 中实现 `fetchPRDiff(prNumber: string): string`，GitHub 用 `gh pr diff`，Gitea 优先 `tea pr diff`、回退 REST API (`GET /repos/{owner}/{repo}/pulls/{number}.diff`)
- [x] 1.3 在 `platform.ts` 中实现 `postPRComment(prNumber: string, body: string): void`，GitHub 用 `gh pr comment`，Gitea 用 REST API (`POST /repos/{owner}/{repo}/issues/{number}/comments`)，失败 fallback 到 stdout
- [x] 1.4 在 `platform.ts` 中实现 `cleanupErrorComments(prNumber: string, runId: string): void`，GitHub 保持现有 `gh api` 逻辑，Gitea 用 REST API 查找并删除匹配的错误评论

## 2. 重构 comment.ts

- [x] 2.1 将 `comment.ts` 中 `resolvePRNumber`、`postPRComment`、`cleanupErrorComments` 的直接 `gh` 调用替换为调用 `platform.ts` 导出的统一接口
- [x] 2.2 删除 `comment.ts` 中已迁移到 `platform.ts` 的平台相关逻辑，保留 `parseExtraEnv` 不变

## 3. index.ts 适配

- [x] 3.1 修改 `index.ts`：将 `action.yml` 的 pr-context step 中 `gh pr diff` 获取的 diff 逻辑移到 TS 中，调用 `platform.ts` 的 `fetchPRDiff`
- [x] 3.2 修改 `index.ts`：diff 获取失败时打印清晰错误信息并 exit 1

## 4. action.yml 变更

- [x] 4.1 `multi-review/action.yml`：新增 `gitea-token` input（description: Gitea API token, default: ""）
- [x] 4.2 `multi-review/action.yml`：在 run step 的 env 中将 `gitea-token` 传递为 `GITEA_TOKEN`（如果环境变量不存在或为空时设置）
- [x] 4.3 `multi-review/action.yml`：移除或简化 `pr-context` step（diff 获取移到 TS 后，该 step 仅提供 fallback 或可移除）
- [x] 4.4 `review/action.yml`：新增 `gitea-token` input 并传递到环境变量

## 5. Python 端适配

- [x] 5.1 在 `run-github-opencode.py` 的 `cleanup_error_comments` 函数中增加平台检测分支：Gitea 平台使用 `urllib.request` 或 `subprocess curl` 调用 Gitea REST API
- [x] 5.2 Python 端新增 `detect_platform()` 辅助函数，逻辑与 TS 端一致（检测 `GITEA_API_URL`）

## 6. 构建与验证

- [x] 6.1 更新 `multi-review/tsconfig.json` 和 `tsup.config.ts` 确保 `platform.ts` 被正确编译到 bundle
- [x] 6.2 编译 multi-review：`cd multi-review && npm run build`，确认无类型错误
- [x] 6.3 验证 GitHub 路径：确认现有 GitHub Actions workflow 配置无需修改即可正常运行
- [x] 6.4 验证 Gitea 路径：在本地模拟 Gitea 环境变量，确认平台检测、REST API URL 构造、token 选择逻辑正确
