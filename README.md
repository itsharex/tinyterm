![TinyTerm Screenshot](image.png)

# TinyTerm

![TinyTerm Logo](src/assets/logo.png)


一个基于 Tauri + React 的轻量级桌面 SSH 客户端。

## 功能

- 多主机管理
- 密码 / 私钥认证
- 多标签终端
- 本地/远端文件管理（SFTP）
- 文件上传下载

## 开发

```bash
npm install
npm run tauri dev
```

## 打包

```bash
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`。

## 许可证

MIT
