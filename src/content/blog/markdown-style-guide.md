---
title: 'Markdown 写作能力指南'
description: '集中演示本站支持的目录、提示块、任务列表、表格、代码高亮、数学公式、脚注与原生 HTML 扩展。'
pubDate: '2026-07-15'
updatedDate: '2026-07-15'
heroImage: '../../assets/images/cover-markdown.svg'
tags: ['Markdown', 'Astro', '写作']
category: '使用指南'
---

本站基于 Astro 的内容集合管理文章，并使用 unified、remark、rehype 与 Shiki 完成 Markdown 渲染。右侧目录会根据二至四级标题自动生成；标题后的 `#` 可复制章节链接。

> [!NOTE]
> 普通 Markdown 和 MDX 共享同一套格式支持。文章正文请从二级标题开始，页面标题会作为唯一的一级标题。

## GitHub Flavored Markdown

### 任务列表与删除线

- [x] 支持 GFM 表格、自动链接与脚注
- [x] 支持任务列表
- [ ] 继续完善更多写作组件

需求变更后，可以用 ~~旧方案~~ 新方案清晰记录修订结果。

### 表格

宽表格在手机端可以横向滚动，不会撑破页面：

| 能力 | 语法 | 渲染方式 | 状态 |
| --- | --- | --- | --- |
| 代码高亮 | 围栏代码块 | Shiki 双主题 | 已支持 |
| 数学公式 | `$...$` / `$$...$$` | KaTeX | 已支持 |
| 提示块 | `> [!NOTE]` | GitHub Alert | 已支持 |
| 文章目录 | 二至四级标题 | 构建时生成 | 已支持 |

## 提示块

支持 GitHub 风格的 `NOTE`、`TIP`、`IMPORTANT`、`WARNING` 与 `CAUTION`：

> [!TIP]
> 一篇文章只解决一个核心问题，标题层级尽量保持连续。

> [!WARNING]
> Markdown 中的原生 HTML 只适合可信内容。若将来开放用户投稿，需要额外启用 HTML 白名单过滤。

## 代码高亮与复制

代码块会根据浅色或深色主题自动切换配色，并提供复制按钮：

```ts
interface Article {
  title: string;
  tags: string[];
  draft?: boolean;
}

export function publish(article: Article) {
  return {
    ...article,
    draft: false,
    publishedAt: new Date().toISOString(),
  };
}
```

行内代码适合展示命令或变量，例如 `npm run check` 与 `Astro.site`。

## 数学公式

行内公式示例：圆的面积为 $S = \pi r^2$。

块级公式会自动居中，内容过宽时可以横向滚动：

$$
\operatorname{softmax}(x_i) =
\frac{\exp(x_i)}{\sum_{j=1}^{n}\exp(x_j)}
$$

## 引用与脚注

> 程序首先是写给人读的，只是偶尔让计算机执行。<br>
> —— Harold Abelson

Astro 将内容在构建时转换为静态 HTML，因此文章页面不依赖客户端 JavaScript[^static]。

[^static]: 目录高亮和代码复制属于渐进增强；即使 JavaScript 不可用，正文仍可完整阅读。

## 链接与图片

[Astro 官方文档](https://docs.astro.build/)这类外部链接会在新标签页打开，并自动补充安全属性。

![Markdown 与代码写作的抽象插图](../../assets/images/cover-markdown.svg)

## 原生 HTML 扩展

可以使用少量语义化 HTML 丰富技术文档：

- 按下 <kbd>Command</kbd> + <kbd>K</kbd> 打开命令面板。
- 使用 <mark>高亮文本</mark> 标记重点。
- <abbr title="Web Content Accessibility Guidelines">WCAG</abbr> 是 Web 内容无障碍指南。

<details>
  <summary>展开查看写作建议</summary>

  保持段落简短，为图片填写有意义的替代文本，并让链接文字描述真实目的。
</details>

---

以上格式均经过生产构建验证，可直接用于 `src/content/blog/` 下的 `.md` 或 `.mdx` 文件。
