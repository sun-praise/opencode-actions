## 1. Action 定义

- [x] 1.1 创建 `architect-review/action.yml`，基于 review/action.yml 模板，修改 name、description、prompt 和 cache key
- [x] 1.2 在 action.yml 中添加 `architecture-context` input（类型 string，默认空）
- [x] 1.3 编写架构审查专用 prompt，覆盖耦合、分层、职责边界、接口设计、散弹枪修改五个维度

## 2. Prompt 细节

- [x] 2.1 prompt 包含中文输出格式要求：首行判定（可合并/有条件合并/不可合并），架构阻塞项和架构建议项
- [x] 2.2 prompt 支持 architecture-context 文件注入逻辑（有值时追加读取指令，无值时跳过）
- [x] 2.3 在 action.yml 中增加 shell 步骤，将 architecture-context 指定的文件内容读取并拼接到 prompt 末尾，文件不存在时输出 warning 并跳过
- [x] 2.4 prompt 设置 read-only 模式约束，禁止修改代码

## 3. 执行引擎集成

- [x] 3.1 确认 action.yml 正确引用 `setup-opencode/install-opencode.sh` 安装 opencode
- [x] 3.2 确认 action.yml 正确引用 `github-run-opencode/run-github-opencode.py` 执行
- [x] 3.3 确认 GITHUB_RUN_OPENCODE_PERMISSION 设置为 deny 所有写操作
- [x] 3.4 确认 architecture-context 通过环境变量传递到执行脚本

## 4. 示例 Workflow

- [x] 4.1 创建 `examples/opencode-architect-review.yml`，展示独立使用 architect-review action

## 5. 验证

- [x] 5.1 检查 action.yml 语法正确（YAML 合法、inputs 完整、steps 引用路径正确）
- [x] 5.2 检查示例 workflow 语法正确且 permissions 设置合理
- [x] 5.3 确认不修改任何现有 action 文件
