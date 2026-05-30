# Release Process

版本发布和验证流程。

## 流程概览

```
功能开发 → 合并 PR → bump version → 打 tag → 创建测试 PR → CI 通过 → 发布 Release → v3 tag 自动更新
```

## 步骤

### 1. Bump Version

使用 `/update-version` 命令或在 worktree 中手动更新：

- `multi-review/package.json`: 更新 `version` 字段
- `CHANGELOG.md`: 添加新版本条目，归类 changes（Added / Changed / Fixed）
- 提交并创建 PR，**不要在 PR 中创建 tag**

> ⚠️ `setup-opencode/default-version` 是 opencode CLI 最低版本要求，**不要修改**。

### 2. 创建 Tag

PR 合并后，在本地打 tag：

```bash
git fetch origin main
git tag -a vX.Y.Z -m "Version X.Y.Z

<Changes summary>"
git push origin vX.Y.Z
```

### 3. 验证

触发 **Release Test** workflow（GitHub Actions → Release Test → Run workflow）：

- **version**: 输入版本号，如 `v3.0.1`
- **publish**: 不勾选（先测试）

Workflow 会自动：

1. 创建测试分支，将 `multi-review.yml` 和 `feature-missing.yml` 指向新 tag
2. 创建测试 PR（标题带 `test:` 前缀）
3. 等待 CI（multi-review、feature-missing）通过
4. 失败时自动评论并关闭 PR

检查测试 PR 的 CI 结果：
- multi-review action 是否正常执行
- feature-missing action 是否正常执行

### 4. 发布 Release

测试通过后，在 GitHub 上基于 tag 创建 Release：

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes "<changelog>"
```

或再次触发 **Release Test** workflow，勾选 **publish**，会自动完成。

发布后，`update-major-tag` workflow 会自动将大版本 tag（如 `v3`）移动到新版本。

### 5. 清理

关闭测试 PR（如果未自动关闭），删除测试分支。

## 注意事项

- 测试 PR **不要合并**，仅用于验证
- 大版本 tag（`v3`）由 `update-major-tag` workflow 自动管理，不要手动操作
- 每次 bump version 前检查 CHANGELOG.md 确保条目完整
