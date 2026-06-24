# Preload 上次 Review 的上下文

## 想法

在发起新一轮 review 时，可以 preload（预加载）上一次 review 的上下文，避免每次都从 `read/` 文件重新开始，从而节省大量 context。

## 背景

当前 review 流程中，agent 通常需要：

1. 读取仓库结构与相关文件
2. 理解代码逻辑
3. 基于提示词和文件内容生成 review 意见

如果这是针对**同一 PR** 的多次 review（例如修复后再次 review），大量文件内容在上一次 review 中已经读取过。同一 PR 的上下文应当可以被复用。重新读取会导致：

- 重复消耗 context window / token
- 延长 review 耗时
- 对大型 PR 尤其明显

## 目标

- 复用上一次 review 中已经解析/理解的文件上下文
- 在新一轮 review 中减少不必要的 `read/` 调用
- 保持准确性：只跳过未变更或已充分理解的部分，对变更内容仍需重新分析

## 可能的实现方向

### 推荐：会话级上下文复用（保存完整会话历史）

在同一 opencode session 内保留上一轮 review 的完整上下文，是最靠谱的方向。核心场景是**同一 PR 的多次 review**：

- 保存**完整的会话历史**，而不是摘要或精简后的文件列表
- 完整历史包含用户指令、文件内容、LLM 分析过程和 review 结论，信息不丢失
- 上下文按 PR 维度关联，重新 review 同一 PR 时可自动恢复
- 不需要额外设计缓存格式或失效策略
- 能自然复用 LLM 已经“看过”的文件内容
- 适用于连续多轮 review，无需跨会话持久化
- 实现简单，风险最低

### 其他方向（暂不建议）

1. **缓存文件摘要**（不推荐）
   - 文件摘要会丢失大量细节，review 时容易误判
   - 维护「文件 → 摘要」映射的准确性和时效性成本高
   - 难以保证摘要能覆盖后续 review 真正需要的上下文

2. **增量 diff 驱动**
   - 记录上一次 review 对应的 commit sha
   - 新一轮 review 先获取 `git diff`，只读取有变更的文件
   - 可作为会话级复用的补充，但单独使用仍需要理解未变更文件的上下文

3. **持久化 review 快照**
   - 将 review 状态写入 `.opencode/review-cache/` 或类似目录
   - 跨会话恢复复杂，且容易因文件变更而失效
   - 优先级低于会话级复用

## 技术实现方案（multi-review MVP）

### 复用现有 cache

`multi-review/action.yml` 已经通过 `actions/cache` 缓存了 `XDG_CACHE_HOME`。cache key 与 PR 无关，因此同一仓库后续任意 run 都会命中同一个 cache，把 `XDG_CACHE_HOME` 里的内容一起恢复。我们要做的只是把 review 上下文文件也放进这个目录，让现有 cache 机制顺带恢复。

### 新增 `context-cache.ts`

负责按 PR 存取完整会话历史：

```ts
interface ReviewContext {
  version: 1;
  repo: string;
  prNumber: string;
  savedAt: string;
  sessions: ReviewSession[];
}

interface ReviewSession {
  name: string; // reviewer 名字或 "coordinator"
  messages: Message[];
}

interface Message {
  info: { role: string };
  parts: Array<{ type: string; text?: string }>;
}
```

- 文件路径：`$XDG_CACHE_HOME/opencode-actions/review-context/{owner}-{repo}-pr-{prNumber}.json`
- 加载：按当前 `GITHUB_REPOSITORY` + PR number 查找对应文件，忽略其他 PR 的缓存。
- 保存：追加本次 reviewer / coordinator 的完整 messages，写回同一文件。
- 失败时只 warning，不影响主流程。

### 修改 `types.ts`

给 `ReviewResult` 增加 `messages?: Message[]`，让 orchestrator 把完整消息带回来。

### 修改 `orchestrator.ts`

- `OrchestratorOptions` 增加 `previousContext?: ReviewContext | null`。
- 每个 reviewer 创建 session 后，构建 prompt 时先 prepend 历史上下文：

```
=== Previous review context for PR #N ===
[role: user] ...
[role: assistant] ...

=== Current review request ===
This is a re-review of the same PR. Focus on the CURRENT diff below.
<reviewer.prompt>

PR Diff:
```
<current diff>
```
```

- 每个 reviewer 跑完后，把 `client.session.messages()` 返回的完整数组塞回 `ReviewResult.messages`。
- coordinator 先不注入历史上下文（其职责是综合当前 reviews），但跑完后保存其完整 messages。

### 修改 `index.ts`

- PR number 解析完后调用 `loadReviewContext(prNumber)`，命中则打印日志。
- 把 `previousContext` 传给 `runParallelReviewers`。
- reviewer 和 coordinator 完成后，合并旧 sessions + 新 sessions，调用 `saveReviewContext()`。

### 风险与应对

| 风险 | 应对 |
|---|---|
| 历史上下文太长，撑爆 prompt | MVP 先不处理，后续加截断；依赖模型长上下文能力 |
| 旧 diff 与新 diff 混在一起 | prompt 明确区分 “Previous context” 和 “Current diff”，并 instruct 聚焦 current diff |
| 并发 run 写同一 PR cache | 后写覆盖先写，可接受；MVP 不做锁 |
| cache miss | 正常降级为全新 review |
| cache 目录不可写 | catch 错误，warning，继续 |

## 待决策（基于会话级复用）

- 上下文保留范围：**保留完整对话历史**，不压缩为摘要或文件列表
- PR 关联：按 `owner/repo#pr` 为 key 存取缓存文件
- 触发方式：自动复用，命中 cache 且存在当前 PR 上下文时自动注入
- 生命周期：cache miss / 目录不可写 / 无 PR 上下文时，优雅降级为全新 review
- 多轮边界：修复后重新 review 同一 PR 时，prompt 明确 instruct 模型聚焦 current diff，不再重复报告已修复问题

## 下一步

- 在 multi-review 中落地 `context-cache.ts` 及 orchestrator/index 改造
- 补充 `context-cache.test.ts` 单元测试
- 以会话级复用为 MVP 做原型验证
- 对比启用前后的 `read/` 调用次数与 token 消耗
