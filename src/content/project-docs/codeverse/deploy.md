---
title: 部署
description: GitHub Pages 自动构建说明
order: 4
section: 指南
---

# 部署

推送到 `main` 后，`.github/workflows/deploy.yml` 会使用 Node.js 22 执行：

```bash
npm ci
npm run check
npm run build
```

构建产物通过 GitHub Pages 发布。静态资源经 Astro 资源管线产出带内容哈希的文件名，避免浏览器陈旧缓存。
