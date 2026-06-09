## Why

Multi-review 的 review 结果只有"阻塞项"和"建议项"两级分类，缺少中间的"警告"级别。三级分类（阻塞/警告/建议）在 prompt 指令中被提及但从未在代码中实现——`ReviewResult` 只有自由文本 `content` 字段，没有结构化的 severity 信息。这导致：(1) PR comment 中无法视觉区分三个严重度等级；(2) 无法基于 severity 做 CI 决策（如警告级以上 exit 1）；(3) LLM 格式遵从率无法被代码校验。

## What Changes

- 在 `ReviewResult` 类型中引入结构化的 `issues` 数组，每个 issue 携带 `severity`（`blocking` | `warning` | `suggestion`）字段
- 更新所有 reviewer YAML prompt，统一要求输出阻塞/警告/建议三级
- 更新 coordinator prompt，要求跨 reviewer 去重后按三级分类输出
- 新增 LLM 输出解析器，从 coordinator 纯文本中提取结构化的三级分类数据
- 新增 comment 渲染层，按严重度分级渲染 PR comment（🔴 阻塞 / 🟡 警告 / 🟢 建议）
- 新增 `fail-on-severity` action 输入，允许用户配置达到哪个严重度级别时让 CI 失败

## Capabilities

### New Capabilities
- `severity-parsing`: 从 LLM reviewer/coordinator 纯文本输出中解析出结构化的三级（blocking/warning/suggestion）issue 列表
- `severity-rendering`: 按严重度等级分级渲染 PR comment，使用 emoji 和视觉层级区分阻塞/警告/建议
- `ci-severity-gate`: 基于最高严重度等级控制 action exit code，允许用户通过 `fail-on-severity` 参数配置阻断阈值

### Modified Capabilities
（无已有 spec）

## Impact

- **代码**: `multi-review/src/` 下的 `types.ts`、`orchestrator.ts`、`index.ts` 需要修改；新增解析和渲染模块
- **Reviewer prompts**: `multi-review/reviewers/*.yaml` 全部需要更新，增加"警告"级别的输出指令
- **Coordinator prompt**: `orchestrator.ts` 中的 `DEFAULT_COORDINATOR_PROMPT` 需要更新
- **Action inputs**: `multi-review/action.yml` 新增 `fail-on-severity` 输入
- **向后兼容**: LLM 不按新格式输出时，解析器 fallback 到旧行为（纯文本 comment），不会 break 现有流程
