不要直接在 main 分支改代码，也不要在当前目录改代码。创建 worktree 在本目录的 .worktrees 下改代码。改完提交 PR。

## bump version 注意事项

`setup-opencode/default-version` 文件存放的是 opencode CLI 的最低版本要求（如 `1.14.30`），不是 action 自身的版本号。bump version 时**不要修改**这个文件。action 的版本号定义在 `package.json` 和 git tag 中。
