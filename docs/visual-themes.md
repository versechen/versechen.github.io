# 页面主题

导航栏的 🌊 按钮开启「海蓝诗境」（Poetize 风格），🌸 按钮切回原有樱花主题。旁边的太阳 / 月亮按钮只切换浅色和深色，两个选择互相独立。

`visual-theme` 保存 `original` 或 `poetize`，第一次访问仍使用樱花主题；旧值 `forest` 自动迁移为 `poetize`。禁用存储时按钮仍能切换当前页面。审查链接可带 `?visual-theme=poetize` 或 `?visual-theme=original`，支持存储时会记住指定选择。

## 结构

- `src/styles/poetize.css`：全部新样式限定在 `html[data-visual-theme='poetize']`，为首页、文章详情、列表与普通页面提供海蓝色系、插画标题区、透明导航、波浪过渡和圆角卡片。工作台和项目文档保留紧凑布局。
- `src/components/PoetizeWorld.astro`：主题切换和延续原森林组件的互动小宠物。宠物更换为海蓝描边，问候语与鼠标粒子跟随新主题；不再显示森林飘雪。
- `public/themes/poetize-coast.svg`、`poetize-wave.svg`：本次原创矢量海岸和波浪，没有使用参考站插画、远程字体或图片。
- `src/layouts/BaseLayout.astro`：首次绘制前恢复选择、迁移旧值，挂载主题组件。
- 文章内容与封面保留。新主题将封面展示在正文卡片开头，樱花主题仍按原布局展示；目录定位、代码高亮与复制、文章翻页沿用原实现。

减少动态效果时关闭宠物动画和指针粒子。手机目录限定高度，可滚动浏览；正文代码块、表格保持横向滚动。

## 本地预览

```sh
npm ci
npm run sync:projects
npm run check
npm run build
npm run preview -- --host 0.0.0.0
```

优先审查文章：`http://localhost:4321/blog/markdown-style-guide/?visual-theme=poetize`。
同时检查 `/`、`/blog/`、`/reading/`、`/projects/`、`/life/`、`/friends/`、`/about/`、`/tags/`。分别测试两个视觉主题 × 两个明暗模式、刷新、跨页面、手机菜单和禁用存储。
