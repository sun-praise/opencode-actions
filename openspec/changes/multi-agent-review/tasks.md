## 1. 项目结构搭建

- [ ] 1.1 创建 `multi-review/` action 目录结构
- [ ] 1.2 创建内置 reviewer prompt 模板文件（quality, security, performance, architecture）

## 2. 编排脚本核心逻辑

- [ ] 2.1 实现 YAML reviewer 配置文件解析（加载内置角色 + 合并自定义角色）
- [ ] 2.2 实现并行 reviewer 启动逻辑（subprocess.Popen 多进程并行）
- [ ] 2.3 实现 reviewer 结果收集逻辑（等待所有进程完成、读取输出）
- [ ] 2.4 实现全局超时管理（global timeout + per-reviewer timeout）
- [ ] 2.5 实现 coordinator agent 调用（将所有 reviewer 输出作为 prompt 上下文）
- [ ] 2.6 实现 fallback 机制（每个 reviewer 独立使用 model fallback）

## 3. GitHub Actions 集成

- [ ] 3.1 创建 `multi-review/action.yml`（定义 inputs、outputs、composite steps）
- [ ] 3.2 实现 PR 评论发布逻辑（coordinator 输出 + collapsible reviewer 原始输出）
- [ ] 3.3 实现 error comment 清理逻辑（复用现有 cleanup_error_comments 模式）

## 4. 默认配置与文档

- [ ] 4.1 配置默认 reviewer team（quality + security）和默认 coordinator prompt
- [ ] 4.2 编写 `multi-review/README.md` 使用说明和 YAML 配置示例
- [ ] 4.3 在项目根 README 中添加 multi-review action 的引用

## 5. 测试验证

- [ ] 5.1 编排脚本单元测试（配置解析、超时计算、进程管理）
- [ ] 5.2 端到端验证：在测试 repo 创建 PR，触发 multi-review action
- [ ] 5.3 验证：reviewer 超时场景下的降级行为
