## Context

Multi-review 的 review 流程是：多个 reviewer 并行审查 → coordinator 合成 → PR comment。当前所有输出都是纯文本，没有结构化的严重度信息。`ReviewResult` 类型只有 `content: string`，coordinator prompt 只要求两级分类（阻塞/建议），代码侧无法解析、校验、或按严重度做 CI 决策。

核心文件：
- `multi-review/src/types.ts` — 类型定义
- `multi-review/src/orchestrator.ts` — reviewer 并行执行 + coordinator 合成
- `multi-review/src/index.ts` — 主流程，组装最终 comment
- `multi-review/reviewers/*.yaml` — reviewer prompt 定义
- `multi-review/action.yml` — action 输入/输出

## Goals / Non-Goals

**Goals:**
- Reviewer 和 coordinator 输出包含三级分类：阻塞（blocking）、警告（warning）、建议（suggestion）
- PR comment 按严重度分级渲染，视觉上清晰区分
- 新增 `fail-on-severity` action 输入，允许基于严重度控制 CI 结果
- LLM 输出不遵从新格式时 fallback 到旧行为，不 break 现有流程

**Non-Goals:**
- 不修改单个 reviewer action（`review/`）的行为，它是独立的
- 不引入 JSON schema 约束 LLM 输出（OpenCode SDK 目前不支持）
- 不修改 `github-run-opencode.py`
- 不做 issue 级别的文件/行号定位（后续可扩展）

## Decisions

### D1: 文本解析而非 JSON 结构化输出

**选择**: coordinator/reviewer 仍然输出 markdown 纯文本，后端用正则解析三级分类。

**替代方案**: 让 LLM 输出 JSON，代码侧直接反序列化。

**理由**: OpenCode SDK 不支持 response schema 约束。纯文本 + 正则解析有 fallback 保证——解析失败时原文照贴。JSON 输出格式失败时整个流程会 break。正则解析也和现有的 `escapeHashReferences` 等文本处理模式一致。

### D2: 解析层放在 coordinator 输出之后

**选择**: 只在 coordinator 输出后做一次解析，不在每个 reviewer 输出后解析。

**理由**: Reviewer 的输出是中间产物，最终用户看到的是 coordinator 合成的报告。只在 coordinator 层解析减少代码复杂度。如果未来需要 per-reviewer 的结构化数据，可以扩展。

### D3: 三级 severity 枚举

**选择**: `blocking` | `warning` | `suggestion`，对应 emoji 🔴🟡🟢。

**理由**: 
- `blocking` — 合并前必须修复（安全漏洞、逻辑错误、数据丢失风险）
- `warning` — 强烈建议修复，不阻断合并但可能引发问题（性能问题、可维护性风险）
- `suggestion` — 可选改进（代码风格、命名、文档）

### D4: fail-on-severity 的阈值设计

**选择**: 新增 action input `fail-on-severity`，取值 `none`（默认）| `blocking` | `warning`。

- `none` — 永远不因 severity 失败（当前行为）
- `blocking` — 存在 blocking issue 时 exit 1
- `warning` — 存在 warning 或 blocking issue 时 exit 1

**理由**: 不提供 `suggestion` 选项，因为建议级问题不应该阻断 CI。

### D5: 解析策略

**选择**: 按 markdown 标题/列表结构解析。

Coordinator prompt 会要求输出格式：
```
### 🔴 阻塞项 / Blocking Issues
- issue 1
- issue 2

### 🟡 警告项 / Warnings  
- issue 1

### 🟢 建议项 / Suggestions
- issue 1
```

解析器匹配 `### 🔴 阻塞项` 或 `### 🔴 Blocking` 等 heading，提取其下直到下一个 `###` 或文档结束的所有列表项。支持中英文 heading。

## Risks / Trade-offs

- **LLM 格式遵从率**: Coordinator 可能不严格按三级 heading 输出。缓解：解析器检测不到任何 heading 时 fallback 到纯文本 comment，不 break。
- **中英文混合**: 标题可能是中文、英文或混合。解析正则需要覆盖两种语言的 heading。已在 D5 中通过匹配 emoji + 双语关键词缓解。
- **Reviewer prompt 改动量大**: 6 个 YAML 文件都需要加"警告"级别指令。风险低但需逐一验证。
- **向后兼容**: 自定义 coordinator prompt（`coordinator-prompt` input）的用户不受影响——解析器只在默认 prompt 下激活，自定义 prompt 输出原样展示。
