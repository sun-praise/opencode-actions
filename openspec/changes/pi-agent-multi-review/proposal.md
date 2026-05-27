## Why

基于 `opencode github run` 的 multi-review 方案（PR #87, #90, #98, #101）因 subprocess 无法获取 AI review 内容已被移除。pi-agent 生态提供了成熟的替代方案：`shaftoe/pi-coding-agent-action` 支持加载 `pi-parallel-agents` 扩展，其 DAG 团队模式天然对应 multi-review 所需的"多 reviewer 并行 + synthesizer 合成"架构，且无需自行管理 subprocess。

## What Changes

- 新增 `pi-multi-review/` action 目录，封装 `shaftoe/pi-coding-agent-action` + `pi-parallel-agents` 扩展
- 提供预定义 reviewer persona 配置（security、performance、quality、architecture），用户可自定义
- 支持通过 workflow 触发（`pull_request` 事件）和评论触发（`/multi-review` 命令）
- 输出为单条 PR comment，包含各 reviewer 的结构化评审结果和 synthesizer 的综合结论
- 新增示例 workflow 文件和文档

## Capabilities

### New Capabilities

- `pi-multi-review-action`: 基于 pi-agent 的多 reviewer 并行 PR 审查 action，使用 pi-parallel-agents DAG 团队模式编排多个 reviewer agent，最终合成单条 PR comment

### Modified Capabilities

（无现有 spec 需要修改）

## Impact

- **新增依赖**: `shaftoe/pi-coding-agent-action@v2`（GitHub Action）、`pi-parallel-agents`（Pi 扩展）
- **新增目录**: `pi-multi-review/`（action 定义、reviewer 配置、文档）
- **CI/CD**: 新增示例 workflow `.github/workflows/pi-multi-review.yml`
- **API/Token**: 需要 `PI_API_KEY` 或兼容的 LLM provider key
- **与现有 action 的关系**: 独立于 `review/` 和 `architect-review/`，不修改现有 action
