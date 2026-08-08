---
name: 代码陈诗
description: 基于 Astro 构建的个人博客与数字花园，追求极致阅读体验与性能。
icon: 🌸
tags: [Astro, TypeScript, CSS]
status: active
github: https://github.com/versechen/versechen.github.io
link: /
order: 1
hasDocs: true
---

# 代码陈诗

基于 Astro 7 构建的个人博客与数字花园，内容涵盖技术文章、读书笔记、项目和生活记录。

## 技术特点

- Astro Content Layer 管理博客与读书内容
- Markdown / MDX、GFM、GitHub 提示块和 KaTeX 数学公式
- Shiki 浅色/深色双主题代码高亮与一键复制
- 自动文章目录、标题锚点、标签和系列导航
- RSS、Sitemap、Canonical、Open Graph 与 Twitter Card
- 深色模式、响应式布局、键盘操作和减少动态效果支持
- GitHub Pages 自动构建与部署

## 开发环境

- Node.js 22.12.0 或更高版本
- npm 9.6.5 或更高版本

```bash
nvm use
npm ci
npm run dev
```

开发服务器默认运行在 `http://localhost:4321`。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run check` | 检查 Astro 模板与 TypeScript 类型 |
| `npm run build` | 构建生产站点到 `dist/` |
| `npm run verify` | 依次执行检查与生产构建 |
| `npm run preview` | 本地预览生产构建 |

## 内容目录

```text
src/
├── content.config.ts       # 内容集合与 frontmatter 校验
├── content/
│   ├── blog/               # Markdown / MDX 技术文章
│   ├── books/              # Markdown 读书笔记
│   ├── projects/           # 项目 README 预览
│   └── project-docs/       # 项目 docs 文档站
├── components/             # Astro 组件
├── layouts/                # 页面布局与 SEO
├── pages/                  # 文件路由
└── styles/global.css       # 全站设计系统与 Markdown 排版
```
