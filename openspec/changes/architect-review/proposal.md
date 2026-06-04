## Why

当前 review action 仅关注代码层面的质量（lint、bug、安全、性能），但缺少架构维度的审查。PR 可能代码质量过关但引入了架构问题：不必要的模块耦合、违反分层约定、接口过度设计、散弹枪修改等。这类问题在 code review 阶段容易被遗漏，却在长期演化中造成高维护成本。

## What Changes

- 新增 `architect-review/` action，与 `review/`、`spec-coverage/`、`feature-missing/` 平行
- 提供专门针对架构层面的 prompt，关注耦合、分层、职责边界、接口设计等维度
- 复用现有的 `github-run-opencode/run-github-opencode.py` 执行引擎和 `setup-opencode/` 安装逻辑
- 新增示例 workflow `examples/opencode-architect-review.yml`
- 支持通过 `architecture-context` input 注入项目架构文档路径（如 `AGENTS.md`、`docs/architecture.md`）

## Capabilities

### New Capabilities
- `architect-review`: 架构层面的 PR 审查 action，包含架构审查 prompt、action.yml 定义、示例 workflow

### Modified Capabilities

（无需修改现有 spec）

## Impact

- 新增 `architect-review/` 目录和 `action.yml`
- 新增 `examples/opencode-architect-review.yml`
- 不影响现有 `review/`、`spec-coverage/`、`feature-missing/` action
- 用户需在 workflow 中显式引用新 action，无 breaking change
