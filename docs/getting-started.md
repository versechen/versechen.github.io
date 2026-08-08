# 快速开始

## 环境要求

- Node.js `22.12.0` 或更高（见仓库 `.nvmrc`）
- npm 9+

## 安装与启动

```bash
nvm use
npm ci
npm run sync:projects
npm run dev
```

浏览器打开 `http://localhost:4321`。

`sync:projects` 会从 GitHub 拉取各项目的 README 与 `docs/`，写入 Content Layer。首次开发或更新远端文档后需要执行一次。

## 验证构建

```bash
npm run verify
```

它会依次同步项目内容、跑类型检查与生产构建。
