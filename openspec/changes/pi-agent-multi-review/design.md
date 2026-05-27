## Context

本项目 `opencode-actions` 是一套 GitHub Actions 集合，用于在 CI 中运行 AI agent。之前的 `multi-review/` 模块基于 `opencode github run` subprocess 方案，因 stdout 无法捕获 AI review 内容（只输出 CLI boilerplate）已在 PR #101 中移除。

issue #102 调研发现 pi-agent 生态提供了可行替代：
- `shaftoe/pi-coding-agent-action` 是成熟的 GitHub Action，支持加载 Pi 扩展
- `messense/pi-parallel-agents` 提供 DAG 团队模式，天然适配多 reviewer 并行 + 合成的架构

现有 action（`review/`、`architect-review/`）都是单 reviewer 模式。本方案新增独立 action，不修改现有 action。

## Goals / Non-Goals

**Goals:**
- 提供开箱即用的多 reviewer 并行 PR 审查 action
- 支持预定义 reviewer persona（security、performance、quality、architecture）
- 支持用户自定义 reviewer persona 和 DAG 编排
- 输出为单条 PR comment，包含结构化评审结果
- 两种触发方式：`pull_request` 事件自动触发 + issue comment `/multi-review` 手动触发

**Non-Goals:**
- 不替代现有 `review/` 和 `architect-review/` action
- 不自己实现 agent 编排逻辑（交给 pi-parallel-agents）
- 不支持 pi-parallel-agents 以外的编排引擎
- 不实现 reviewer 之间的迭代改进循环（v1 只做单轮并行 + 合成）

## Decisions

### 1. 使用 shaftoe/pi-coding-agent-action 作为底层 action

**选择**: 直接引用 `shaftoe/pi-coding-agent-action@v2`，不复刻它。

**替代方案**:
- A) 用 `cv/pi-action` — 不支持 extensions 输入，无法加载 pi-parallel-agents
- B) 自己写 Docker action 调用 Pi CLI — 维护成本高，重复造轮子

**理由**: shaftoe action 原生支持 `extensions` 参数、内置 GitHub 工具、暴露 structured outputs，且已在 Marketplace 发布。

### 2. 使用 composite action 封装

**选择**: 创建 `action.yml` composite action，封装 pi-coding-agent-action 的调用和默认配置。

**理由**: 与项目现有 action（`review/`、`architect-review/`）风格一致；用户可通过 `uses: sun-praise/opencode-actions/pi-multi-review@v1` 直接引用。

### 3. Reviewer persona 以 YAML 配置文件形式提供

**选择**: 在 action 中内置 `reviewers/` 目录存放 persona 定义（YAML），用户可通过 `reviewers-config` 输入覆盖。

**理由**:
- pi-parallel-agents 团队模式的 DAG 定义本身就是声明式的
- YAML 配置可读性好，用户可自定义 reviewer 角色、prompt、model
- 避免硬编码 reviewer persona

### 4. 输出为单条 PR comment

**选择**: 使用 synthesizer agent 合并所有 reviewer 结果，最终只发一条 comment。

**替代方案**:
- A) 每个 reviewer 各发一条 comment — 信息分散，难阅读
- B) 发一条 thread，每个 reviewer 一个 reply — 需要额外的 GitHub API 管理

**理由**: 单条 comment 更简洁，与之前 multi-review 的设计目标一致。pi-parallel-agents 的团队模式天然支持 synthesizer 角色。

### 5. prompt 模板化

**选择**: 使用 Handlebars 风格的 prompt 模板，支持 `{{diff}}`、`{{title}}`、`{{body}}`、`{{files}}` 等变量。

**理由**: 与 shaftoe action 的模板系统一致，用户可自定义 reviewer 的审查重点。

## Risks / Trade-offs

- **[pi-parallel-agents 是社区扩展]** → 锁定 shaftoe action 的 `extensions` 机制，如果 pi-parallel-agents 停维，用户可直接在 prompt 中用单 agent 多次调用作为降级方案
- **[Token 消耗高]** → 多个 reviewer 并行意味着多次 LLM 调用。通过 `model` 输入让用户选择性价比更高的模型；支持配置 reviewer 数量（可只用 2 个而非 4 个）
- **[pi-coding-agent-action 版本变更]** → 锁定主要版本（`@v2`），在 action.yml 中暴露 `pi-action-version` 输入供用户 pin 到 exact version
- **[GitHub API rate limit]** → PR diff 获取和 comment 发布受 API 限制。shaftoe action 已内置 rate limit 处理，无需额外处理
