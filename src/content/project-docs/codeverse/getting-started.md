---
title: 快速开始
description: 安装依赖并启动开发服务器
order: 2
section: 开始
---

# 快速开始

## 环境要求

- Node.js `22.12.0` 或更高（见仓库 `.nvmrc`）
- npm 9+

## 安装与启动

```bash
nvm use
npm ci
npm run dev
```

浏览器打开 `http://localhost:4321`。

## 验证构建

发布前建议执行：

```bash
npm run verify
```

它会依次跑类型检查与生产构建。
