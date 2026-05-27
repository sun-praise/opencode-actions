## 1. Action 骨架

- [x] 1.1 创建 `pi-multi-review/` 目录结构（`action.yml`、`reviewers/`、`README.md`）
- [x] 1.2 编写 `pi-multi-review/action.yml` composite action 定义，声明所有 inputs（`model`、`api-key`、`max-tokens`、`reviewers-config`、`pi-action-version`）
- [x] 1.3 在 composite action 中配置调用 `shaftoe/pi-coding-agent-action@v2`，传入 `extensions: npm:pi-parallel-agents`

## 2. 默认 Reviewer Persona

- [x] 2.1 创建 `pi-multi-review/reviewers/default.yml`，定义 4 个内置 persona（quality、security、performance、architecture），每个包含 name、role、prompt 模板
- [x] 2.2 为每个 reviewer 编写 prompt 模板，支持 `{{diff}}`、`{{title}}`、`{{body}}`、`{{files}}` 占位符

## 3. DAG 构建 & Prompt 编排

- [x] 3.1 编写 shell script 或 composite step，将 reviewer YAML 配置转换为 pi-parallel-agents 团队模式的 DAG prompt
- [x] 3.2 实现 synthesizer 角色定义，汇总各 reviewer 输出并生成结构化 PR comment
- [x] 3.3 处理 reviewer config 的加载逻辑：有自定义配置用自定义，无则用默认 4 persona

## 4. 触发条件处理

- [x] 4.1 在 composite action 中添加 `if` 条件判断，支持 `pull_request` 和 `issue_comment`（`/multi-review`）两种触发模式
- [x] 4.2 处理 issue_comment 触发时从 comment event 中提取 PR number 的逻辑

## 5. 示例 Workflow & 文档

- [x] 5.1 创建 `.github/workflows/pi-multi-review.yml` 示例 workflow，演示两种触发模式和推荐 permissions
- [x] 5.2 编写 `pi-multi-review/README.md`，包含使用说明、配置示例、inputs 说明
- [x] 5.3 在项目根 `README.md` 中添加 pi-multi-review action 的简介和链接

## 6. 测试验证

- [ ] 6.1 在测试仓库中验证 action 能正确触发并生成 PR comment
- [ ] 6.2 验证自定义 reviewers-config 能覆盖默认 persona
- [ ] 6.3 验证部分 reviewer 失败时 action 仍能产出部分结果
