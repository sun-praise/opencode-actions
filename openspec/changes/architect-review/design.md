## Context

opencode-actions 目前提供三个审查类 action：`review`（代码质量）、`spec-coverage`（规格覆盖率）、`feature-missing`（功能遗漏）。它们都基于同一个执行引擎（`github-run-opencode/run-github-opencode.py` + `setup-opencode/`），通过不同的 `prompt` 实现差异化审查。

现有 action 的架构模式：
- 每个 action 独立目录，包含 `action.yml`
- `action.yml` 定义 inputs（复用通用的 opencode 参数 + 独有的 prompt）
- 通过 `GITHUB_RUN_OPENCODE_*` 环境变量传递参数给 Python 执行脚本
- 所有 action 均为 composite action，仅支持 Linux runner

## Goals / Non-Goals

**Goals:**
- 新增 `architect-review/` action，从架构层面审查 PR
- 完全复用现有的 opencode 执行引擎，零基础设施改动
- 提供聚焦架构问题的 prompt：耦合、分层、职责边界、接口设计、散弹枪修改
- 支持用户通过 `architecture-context` input 注入项目架构文档
- 提供示例 workflow

**Non-Goals:**
- 不修改现有 `review/`、`spec-coverage/`、`feature-missing/` action
- 不引入新的执行引擎或依赖
- 不做架构审查结果与 review 结果的合并展示
- 不自动分析目录结构生成架构上下文（由用户通过 input 提供）

## Decisions

### 1. 独立 action vs 合并到 review

**选择：独立 action**

理由：
- 架构审查与代码质量审查的关注点完全不同，合并会导致 prompt 过长、职责不清
- 用户可能只想启用其中一个，独立 action 更灵活
- 与 `spec-coverage`、`feature-missing` 保持一致的架构风格

### 2. 架构上下文注入方式

**选择：通过 `architecture-context` input 指定文件路径**

理由：
- 项目架构信息差异大（AGENTS.md、docs/architecture.md、openspec/ 等），无法自动推断
- 文件路径方式让用户精确控制注入内容
- prompt 中追加 "请先阅读以下架构文档" 即可，无需改执行引擎

替代方案：
- 自动扫描常见架构文档路径 → 不可靠，可能读到无关文件
- 嵌入式 YAML 配置 → 过于复杂，增加 action 使用门槛

### 3. 输出格式

**选择：与 review action 保持一致的中文输出格式**

理由：
- 用户体验一致，降低学习成本
- 使用相同的判定体系（可合并/有条件合并/不可合并）

### 4. action.yml 结构

**选择：完全复制 review action 的结构，仅修改 prompt 和 description**

理由：
- 所有 opencode 参数（cache、model、timeout 等）都是通用的
- 新增 `architecture-context` 作为独有 input
- 保持与其他 action 一致的参数命名和默认值

## Risks / Trade-offs

- **架构审查依赖模型能力** → 使用 `reasoning-effort: max` + `enable-thinking: true` 默认值，确保推理质量
- **架构上下文文件不存在** → action.yml 中不做强制校验，prompt 中说明"如果文件不存在则跳过此步骤"
- **与 review 结果可能冲突** → 文档中说明两个 action 的职责边界，建议同时使用
