---
title: 内容写作
description: 博客、读书与项目内容的目录约定
order: 3
section: 指南
---

# 内容写作

## 博客

在 `src/content/blog/` 下新增 `.md` 或 `.mdx` 文件。正文建议从二级标题开始，页面会根据 frontmatter 自动生成标题、描述、日期、标签等信息。

完整格式示例见 `src/content/blog/markdown-style-guide.md`。

## 项目

- `src/content/projects/*.md`：项目卡片元数据 + README 正文（用于项目页快速预览）
- `src/content/project-docs/{slug}/*.md`：对应 GitHub 仓库 `docs/` 的文档站内容

文档 frontmatter 中的 `section` 与 `order` 决定侧栏分组与排序。
