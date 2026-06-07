# Science Review — 多角色科学文本审查 Action

**日期**: 2026-05-29
**仓库**: `sun-praise/science-review`（private）
**依赖**: `sun-praise/opencode-actions/setup-opencode@v3`

## 背景

现有的 opencode-actions 提供了代码审查能力（review、multi-review、architect-review 等），但缺少面向科学文本的审查。science-review 是一个独立 repo，作为 GitHub Action 使用，复用 multi-review 的多角色并行 + coordinator 综合架构，但专注于科学文本质量审查。

## 目标

- 覆盖论文/学术文献、技术文档、实验报告、通用科学文本四种场景
- 从 PR diff 中自动识别文本内容进行审查
- 四个专职 researcher 并行审查 + coordinator 综合报告
- 输出科学严谨性评级：严谨 / 基本严谨 / 存在问题 / 严重缺陷
- 默认中文输出，通过 `language` input 可配置

## 仓库结构

```
sun-praise/science-review
├── README.md
├── action.yml                     # 单一 action 入口
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                   # SDK 启动 + 主流程
│   ├── researchers.ts             # 加载 researcher YAML
│   ├── orchestrator.ts            # 并行 researcher + coordinator 综合
│   ├── types.ts                   # 类型定义
│   └── platform.ts                # PR diff 获取、评论发布
├── researchers/
│   ├── methodologist.yaml         # 方法论审查
│   ├── data-analyst.yaml          # 数据分析审查
│   ├── citation-checker.yaml      # 引用验证
│   └── logic-reviewer.yaml        # 逻辑审查
└── dist/
    └── index.cjs                  # 构建产物
```

setup-opencode 通过 `uses: sun-praise/opencode-actions/setup-opencode@v3` 引用，不在本 repo 内。

## Researcher 角色

### methodologist（方法论审查）

检查项：
- 实验设计是否合理（对照组、变量控制、样本量）
- 研究方法是否恰当且与目标匹配
- 是否存在方法论层面的遗漏或偏差
- 可重复性评估

### data-analyst（数据分析审查）

检查项：
- 统计方法选择是否正确
- 数据处理流程是否透明完整
- 图表是否准确反映原始数据
- 是否存在选择性报告或 p-hacking 迹象

### citation-checker（引用验证）

检查项：
- 引用是否准确（是否歪曲原意）
- 参考文献是否过时或已被推翻
- 是否遗漏该领域关键文献
- 引用格式一致性

### logic-reviewer（逻辑审查）

检查项：
- 论证链条是否完整自洽
- 结论是否有充分的数据/证据支撑
- 是否存在逻辑谬误（因果倒置、以偏概全、滑坡等）
- 假设与推论之间的 gap

### 统一输出格式

每个 researcher 独立输出：

```
第一行：严谨 / 基本严谨 / 存在问题 / 严重缺陷
简要总结
阻塞项：...
建议项：...
```

## Coordinator

默认 coordinator prompt 整合所有 researcher 结果：

规则：
1. 跨 researcher 去重（同一问题只提一次）
2. 交叉验证：至少 2 个 researcher 同意的问题标记为"已确认"
3. 冲突时取多数意见
4. 保留领域特定见解
5. 使用最严重发现的评级作为最终评级
6. 只报告当前文本中仍存在的问题

最终输出格式：
- 第一行：最终评级（严谨 / 基本严谨 / 存在问题 / 严重缺陷）
- 简要总结
- 阻塞项
- 建议题
- 各 researcher 详细结果（折叠展示）

## Action Inputs

| Input | 说明 | 默认值 |
|-------|------|--------|
| `language` | 输出语言（`zh`/`en`） | `zh` |
| `model` | 模型（format: provider/model） | 同 multi-review 默认 |
| `timeout-seconds` | 全局超时 | `900` |
| `coordinator-timeout-seconds` | coordinator 超时 | `300` |
| `coordinator-prompt` | 自定义 coordinator prompt | 内置科学审查 prompt |
| `default-team` | reviewer 团队定义 | `methodologist:1,data-analyst:1,citation-checker:1,logic-reviewer:1` |
| `reasoning-effort` | 推理深度（low/medium/high/max） | `max` |
| `enable-thinking` | 启用思考模式 | `true` |
| `github-token` | GitHub token | `""` |
| `gitea-token` | Gitea token | `""` |
| `zhipu-api-key` | 智谱 API key | `""` |
| `opencode-go-api-key` | OpenCode Go API key | `""` |
| `deepseek-api-key` | DeepSeek API key | `""` |
| `extra-env` | 额外环境变量 | `""` |
| `cleanup-error-comments` | 自动清理错误评论 | `true` |

基础设施参数（install、cache 等）通过 setup-opencode action 处理。

## 技术实现

- TypeScript + Node.js，使用 `@opencode-ai/sdk`
- 构建工具：tsup（和 multi-review 一致）
- 代码结构从 multi-review 复用并适配：替换 reviewer 加载路径、coordinator prompt、决策格式
- researcher YAML 格式：`name` + `prompt`，和 multi-review/reviewers/ 一致
- 语言切换：在 prompt 末尾根据 `language` input 动态注入响应语言指令
