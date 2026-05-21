## Context

当前 opencode-actions 的 `review` action 是单 agent 模式：一个模型 + 一个 prompt + 一次 `opencode github run`。`architect-review` 也是相同模式，只是 prompt 不同。

本次设计新增 `multi-review` action，在一个 GitHub Actions job 内并行启动多个 reviewer agent，再由一个 coordinator agent 汇总辩论，输出最终合并审查报告。

现有基础设施可复用：
- `setup-opencode/` — 安装和缓存 OpenCode CLI
- `github-run-opencode/run-github-opencode.py` — 单次运行的 Python 运行时（含 model fallback、timeout、retry）
- `run-opencode/run-opencode.sh` — 底层 shell 启动脚本

## Goals / Non-Goals

**Goals:**
- 在单个 GitHub Actions runner 上并行运行 2-5 个 reviewer agent
- 每个 reviewer 使用独立的 prompt（角色），支持内置角色和自定义角色
- Coordinator agent 汇总所有 reviewer 输出，执行辩论去重，输出最终报告
- 支持 reviewer 冗余（同一角色多实例）
- 复用现有 setup-opencode 和 model fallback 机制

**Non-Goals:**
- 不实现跨 runner 的分布式并行（不需要 matrix strategy）
- 不实现 Web Dashboard（open-code-review 有，但 GitHub Actions 环境不需要）
- 不实现多轮迭代审查（round-1/round-2），首版只做单次审查
- 不实现 reviewer 人格系统（famous engineer personas），只做功能角色
- 不修改现有 `review` / `architect-review` action 的行为

## Decisions

### D1: 单 job 内 Python subprocess 并行

**选择**: 在一个 GitHub Actions job 中，由 Python 编排脚本用 `subprocess.Popen` 并行启动多个 `opencode github run` 进程。

**替代方案**:
- GitHub Actions matrix strategy（多 job 并行）— 需要跨 job 传递大量文本（reviewer 输出），需要用 artifacts 或 cache，复杂且成本高
- 顺序执行 — 简单但太慢（3 个 reviewer × 10 分钟 = 30 分钟 vs 并行 10 分钟）

**理由**: 单 runner 上 subprocess 并行是最简洁的方案。OpenCode CLI 是 I/O 密集型（等 API 响应），多个实例在 CPU 上不冲突。

### D2: YAML 配置 reviewer 角色

**选择**: 用 YAML 配置文件定义 reviewer 角色列表，每个角色包含 `name`、`prompt`、`count`（冗余数）。

```yaml
reviewers:
  - name: quality
    prompt: |
      Review code quality, bugs, and logic errors...
    count: 1
  - name: security
    prompt: |
      Review security concerns...
    count: 1
  - name: performance
    prompt: |
      Review performance issues...
    count: 1
coordinator:
  prompt: |
    You are a coordinator. Synthesize the following reviewer reports...
```

**替代方案**:
- 在 action.yml inputs 中内联定义 — 太冗长，GitHub Actions inputs 不支持复杂结构
- 独立 JSON 文件 — 可以，但 YAML 更易读

**理由**: YAML 是 GitHub Actions 生态的标准配置格式，用户熟悉。

### D3: Coordinator agent 作为最后一步运行

**选择**: 所有 reviewer 完成后，启动一个 coordinator agent，将所有 reviewer 输出作为 prompt 上下文，执行汇总辩论并输出最终报告。

**辩论机制** (简化版 AGREE/CHALLENGE):
- coordinator 收到所有 reviewer 的原始输出
- coordinator 需要在输出中标注每个发现的来源 reviewer
- 如果多个 reviewer 独立发现相同问题，标注为 "多 reviewer 确认"
- 如果 reviewer 间有矛盾结论，coordinator 需要判断并给出最终立场

**替代方案**:
- 不做 coordinator，直接拼接所有 reviewer 输出 — 用户体验差，重复内容多
- 多轮辩论（reviewer 互相 review 对方的输出）— 成本太高，首版不做

### D4: 共享 opencode.json 配置

**选择**: 所有 reviewer 和 coordinator 共享同一个 `opencode.json` 配置（model、thinking、reasoning effort 等）。

**理由**: 简化实现。未来可扩展为 per-reviewer model 配置，但首版不需要。

### D5: 内置角色 + 自定义角色

**选择**: 提供 4 个内置角色（quality, security, performance, architecture），用户可通过 YAML 文件覆盖或新增角色。

**理由**: 开箱即用（默认 quality + security），同时保留自定义扩展能力。

## Risks / Trade-offs

- **[Token 成本增加]** → 并行运行 N 个 reviewer，token 消耗约为单次审查的 N+1 倍（N 个 reviewer + 1 个 coordinator）。默认 N=3，在 action.yml 文档中明确说明。
- **[运行时间增加]** → 即使并行，总时间仍大于单次审查（需要等最慢的 reviewer + coordinator）。默认 timeout 设为 900 秒。
- **[Runner 资源]** → 多个 OpenCode 实例同时运行，内存和网络连接数增加。GitHub-hosted runner 有 7GB RAM，3-5 个实例无压力。
- **[PR 评论格式]** → 需要设计清晰的输出格式，避免信息过载。使用折叠区块（`<details>`) 展示各 reviewer 原始输出。
