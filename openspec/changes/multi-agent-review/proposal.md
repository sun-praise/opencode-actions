## Why

当前 `review` action 是单 agent 单次通过模式——一个模型、一个 prompt、一次运行。参考 Cloudflare 的 AI Code Review 博客和 [open-code-review](https://github.com/spencermarx/open-code-review) 项目，多 agent 并行审查 + 辩论（discourse）+ 冗余（redundancy）能显著提升审查质量：不同视角独立发现问题，辩论消除误报，冗余确保关键问题不被遗漏。

GitHub Actions 环境下的多 agent 审查目前没有成熟方案。将 open-code-review 的多 agent 机制引入 opencode-actions，可以让每个 PR 自动获得高质量的多视角审查，无需开发者手动触发。

## What Changes

- 新增 `multi-review` action：支持配置多个 reviewer agent，每个 agent 使用独立的 prompt（角色）并行运行，最后由一个 coordinator agent 汇总、去重、辩论并输出最终结论
- 每个 reviewer agent 是一次独立的 `opencode github run` 调用，使用不同的 prompt（如安全审查、性能审查、代码质量审查）
- Coordinator agent 收集所有 reviewer 的输出，执行 discourse 辩论（AGREE/CHALLENGE/CONNECT/SURFACE），产出最终合并审查报告
- 支持冗余配置：同一角色可运行多个实例，coordinator 通过多数投票/一致性检查消除误报
- 输出为一条合并后的 PR 评论，包含各角色发现和最终结论

## Capabilities

### New Capabilities
- `multi-agent-pipeline`: 多 agent 并行审查流水线——定义 reviewer 角色、并行调度、coordinator 汇总与辩论、最终合成输出
- `reviewer-personas`: 内置和自定义 reviewer 角色系统——提供预设角色（security, performance, quality, architecture），支持用户通过配置文件自定义角色 prompt

### Modified Capabilities
（无现有 spec 需要修改）

## Impact

- 新增 `multi-review/` action 目录，包含 `action.yml` 和 Python 编排脚本
- 复用现有 `setup-opencode/`, `github-run-opencode/` 基础设施
- GitHub Actions 中的运行时间会增加（并行运行多个 agent），需要合理设置默认超时和 reviewer 数量
- 新增 reviewer 角色配置文件（YAML 格式）
- Token 消耗增加（多个 agent 并行），用户需评估成本
