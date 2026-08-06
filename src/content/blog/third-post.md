---
title: '为什么我选择 Astro 构建个人博客'
description: '从整站 JavaScript 到内容优先的静态输出，聊聊 Astro Islands 架构为何更适合个人博客。'
pubDate: 'Sep 15 2023'
updatedDate: 'Jul 15 2026'
heroImage: '/images/cover-architecture.svg'
tags: ['Astro', '前端', '性能优化']
category: '建站实践'
series: '从零搭建个人博客'
seriesOrder: 2
---

我曾经习惯用全栈 React 框架解决所有 Web 项目。它们能力强大，但个人博客的大多数页面只是标题、正文和少量导航，把完整客户端运行时发送给读者并不划算。

Astro 的默认方向正好相反：先输出静态 HTML，只有明确需要交互的组件才发送 JavaScript。

## 内容站真正需要什么

博客的核心路径很简单：

```text
Markdown → 内容校验 → 静态路由 → HTML
```

这条路径需要稳定的 Markdown 管线、清晰的内容模型、良好的 SEO 和快速首屏，而不是复杂的客户端状态管理。

## Islands 架构的边界

Astro 页面和组件默认只在构建阶段运行。若某个组件需要浏览器能力，可以通过 `client:load`、`client:visible` 等指令单独激活。

例如，评论区可能需要框架运行时，但文章正文、目录和页脚并不需要。最终页面可以只为评论区加载 JavaScript，而不是让整个站点都变成单页应用。

> [!NOTE]
> “零 JavaScript”不是目的。目标是让每段脚本都对应明确的用户价值。

## Content Collections

内容集合让 Markdown 不再是无法约束的散落文件。每篇文章都必须通过 schema：

```ts
const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});
```

日期写错、缺少标题或字段类型不符时，生产构建会直接失败。这比上线后出现空标题或失效页面更可靠。

## 保留渐进增强

本站仍然使用少量客户端脚本：

- 主题切换；
- 博客和读书标签筛选；
- 图片灯箱；
- 代码复制与目录滚动高亮。

这些功能在脚本失败时不会阻止正文阅读，符合渐进增强原则。

## 选择的代价

Astro 并不是所有项目的答案。高度动态的后台系统、复杂的实时协作或强客户端状态应用，可能更适合完整应用框架。技术选型的关键仍然是需求匹配，而不是框架排名。

对于以 Markdown 为核心、部署到静态托管平台的个人博客，Astro 给出了足够清晰且长期成本较低的答案。
