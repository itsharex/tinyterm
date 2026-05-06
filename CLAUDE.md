# TinyTerm 项目助手指令

## 快捷工作流

### git-commit：提交当前修改

当用户说"提交代码"、"提交并推送"、"git commit"时，按以下流程执行：

1. 运行 `git status` 和 `git diff --stat` 查看变更
2. 分析修改内容，按 Conventional Commits 规范确定 type 和 scope：
   - feat：新功能
   - fix：Bug 修复
   - docs：文档变更
   - style：代码格式调整
   - refactor：代码重构
   - test：添加或修改测试
   - chore：构建、依赖、维护
   - perf：性能优化
3. 生成中文提交信息，格式：`<type>(<scope>): <中文描述>`
   - 示例：`feat(ssh): 添加私钥认证支持`、`fix(terminal): 修复内存泄漏`
4. 向用户展示提交信息并确认
5. 执行 `git add -A && git commit -m "..." && git push`
6. 验证：`git log --oneline -3`

### git-release：发布新版本

当用户说"发布版本"、"打 tag"、"release"时，按以下流程执行：

1. **先执行上述 `git-commit` 的完整流程**，确保当前修改已提交
2. 询问版本升级类型（patch/minor/major）
3. 读取当前版本号（同步检查 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`）
4. 计算新版本号并确认
5. 更新三个文件中的版本号
6. 询问发布说明（中文）
7. 更新 `CHANGELOG.md`（在 `## [Unreleased]` 上方插入新版本记录）
8. 提交版本变更：`git add . && git commit -m "chore(release): 发布 vX.Y.Z" && git push`
9. 创建 tag：`git tag -a vX.Y.Z -m "Release vX.Y.Z - <中文说明>"`
10. 推送 tag：`git push origin vX.Y.Z`
11. 验证：`git log --oneline --decorate -5 && git tag -l`

## 提交规范

- type 和 scope 使用英文（Conventional Commits）
- 冒号后的描述使用**中文**
- 描述以小写字母或中文开头，句末不加句号

## 版本号文件路径

```
tinyterm/
├── package.json
├── src-tauri/
│   ├── Cargo.toml
│   └── tauri.conf.json
└── CHANGELOG.md
```
