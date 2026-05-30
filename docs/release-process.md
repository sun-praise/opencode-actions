# Release Process

版本发布和验证流程。

## 流程概览

```
功能开发 → 合并 PR → bump version → 打 tag → 创建测试 PR → CI 通过 → 发布 Release → 更新大版本 tag
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

创建测试 PR 验证 review actions 是否正常：

1. 从 main 创建测试分支：`git checkout -b test-release/vX.Y.Z origin/main`
2. 修改 `.github/workflows/multi-review.yml`，将 `uses: ./multi-review` 改为 `uses: sun-praise/opencode-actions/multi-review@vX.Y.Z`
3. 修改 `.github/workflows/feature-missing.yml`，将 action 引用改为 `@vX.Y.Z`
4. 提交并创建 PR（标题加 `test:` 前缀）
5. 等 CI 通过，确认 multi-review 和 feature-missing action 正常执行

### 4. 发布 Release

测试通过后，在 GitHub 上基于 tag 创建 Release：

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes "<changelog>"
```

### 5. 更新大版本 Tag

手动将大版本 tag 移动到新版本：

```bash
git tag -f vN vX.Y.Z
git push origin vN --force
```

例如将 `v3` 更新到 `v3.0.1`：

```bash
git tag -f v3 v3.0.1
git push origin v3 --force
```

### 6. 清理

关闭测试 PR（不要合并），删除测试分支。

## 注意事项

- 测试 PR **不要合并**，仅用于验证
- 每次 bump version 前检查 CHANGELOG.md 确保条目完整
