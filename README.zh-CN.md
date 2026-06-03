# opencode-actions 中文文档

[English Documentation](README.md)

可复用的 GitHub Actions，用于在其他仓库中安装和运行 OpenCode。

本仓库基于 Apache 2.0 许可证。

## 快速开始

在你的 CI.yaml 中写入：

```yaml
- name: Run OpenCode review
  uses: sun-praise/opencode-actions/review@v3
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}

    # 以下密钥只需提供一个即可
    deepseek-api-key: ${{ secrets.DEEPSEEK_API_KEY }}
    zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
    opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
```

你将获得一个自动化的 PR 审查机器人（默认中文回复，可通过 `language` 输入切换语言）。

或将技能添加到你的项目：

```bash
npx skills add sun-praise/opencode-actions
```

## 包含的 Actions

- `review`：内置 prompt 和模型默认值的 PR 审查封装
- `feature-missing`：对照关联 issue 的需求，审计 PR 实现的完整性
- `spec-coverage`：对照项目规格/任务文件，交叉检查 PR 实现的覆盖度
- `github-run-opencode`：`opencode github run` 常用工作流的一步封装
- `setup-opencode`：安装 OpenCode，恢复缓存，导出二进制路径
- `run-opencode`：运行 `opencode`，支持 GitHub 网络抖动的重试逻辑

## 语言配置

所有 action 均支持 `language` 输入参数，用于控制 agent 的回复语言：

- `zh`（默认）：中文回复
- `en`：英文回复

```yaml
- name: Run OpenCode review (英文)
  uses: sun-praise/opencode-actions/review@v3
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    language: en
```

也可以从仓库变量中读取：

```yaml
- name: Run OpenCode review
  uses: sun-praise/opencode-actions/review@v3
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    language: ${{ vars.OPENCODE_LANGUAGE }}
```

## 三个审查 Action 的区别

| Action | 审查范围 | 发现的问题 |
| --- | --- | --- |
| `review` | PR diff | 代码质量、安全问题、Bug |
| `feature-missing` | PR 标题/正文 + 关联 issue | PR 自述需求的完整性 |
| `spec-coverage` | 项目规格/任务文件 | 计划范围 vs 实际实现的差距 |

## review

最简单的 PR 审查方案。

- 内置审查 prompt 模板
- 内置 `MODEL` 解析：显式 `model` 输入 > `MODEL_NAME` 环境变量 > `zhipuai-coding-plan/glm-5.1`
- 内置 `timeout-seconds` 默认值：`600`（10 分钟）
- 可选的 `fallback-models` 支持超时驱动的模型轮换

## feature-missing

配合 `review` 使用，审计 PR 是否完整实现了关联 issue 中的需求。

- 自动通过 `gh pr view` 读取关联 issue 作为需求规格
- 如无关联 issue，从 PR 标题和正文提取需求
- 按严重程度分类：CRITICAL / MEDIUM / LOW

```yaml
- name: Run feature missing audit
  uses: sun-praise/opencode-actions/feature-missing@v3
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
    opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
```

## spec-coverage

配合 `review` 和 `feature-missing` 使用，审计 PR 是否实现了项目规格/任务文件中的全部计划。

与 `feature-missing`（检查 PR 自述范围）不同，`spec-coverage` 使用项目自身的规格文件作为**预期范围的权威来源**。可以发现 PR 实现了大型计划功能的一部分但跳过了关键集成步骤的情况。

- 自动发现 `openspec/changes/*/tasks.md`、`specs/**` 等位置的规格文件
- 智能跳过不需要规格的 bug 修复和小改动
- 当功能型 PR 缺少规格文件时报告为 CRITICAL 级别的遗漏
- 按严重程度分类：CRITICAL / MEDIUM / LOW

```yaml
- name: Run spec coverage audit
  uses: sun-praise/opencode-actions/spec-coverage@v3
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    zhipu-api-key: ${{ secrets.ZHIPU_API_KEY }}
    opencode-go-api-key: ${{ secrets.OPENCODE_GO_API_KEY }}
```

## 使用方式

```yaml
uses: sun-praise/opencode-actions/review@v3
uses: sun-praise/opencode-actions/feature-missing@v3
uses: sun-praise/opencode-actions/spec-coverage@v3
uses: sun-praise/opencode-actions/github-run-opencode@v3
uses: sun-praise/opencode-actions/setup-opencode@v3
uses: sun-praise/opencode-actions/run-opencode@v3
```

更多示例请参见 `examples/` 目录。

## 本地验证

```bash
bash tests/test.sh
```
