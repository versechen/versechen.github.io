# 页面主题

导航栏 🌊 开启「海蓝诗境」（Poetize 风格），🌸 切回原有樱花主题。太阳 / 月亮只切换浅色和深色，两个选择互相独立。

`visual-theme` 保存 `original` 或 `poetize`；第一次访问使用樱花，旧 `forest` 自动迁移到 `poetize`。存储禁用时按钮仍可切换当前页。审查链接可带 `?visual-theme=poetize`，应用后移除此参数，避免刷新覆盖之后手动选择。

## 第二版视觉与交互

- 首页使用原创精细海岸绘画、较短首屏、半透明打字字幕、两层缓慢波浪和可点击下行入口；正文使用作者侧栏与双列配图卡片。触屏改为单列，保留原内容和路由。
- 文章使用另一幅原创面海书桌绘画作为标题背景；文章自身封面保留在正文摘要旁，可点击放大，Escape 关闭并返回焦点。
- 全页轻量花瓣、导航下划线、图片渐进放大、阅读进度、返回顶部和专注阅读按钮。动画按钮记住开关；系统减少动态效果时停用，页面隐藏或非当前主题时停止花瓣循环。工作台和文档不启用装饰动画。
- 樱花原布局保留。视觉样式以 `html[data-visual-theme='poetize']` 限定；不改变文章 Markdown、已有鉴权或发布流程。

## 实现与资源

- `src/styles/poetize.css`：新主题色、页面布局、动画和响应式样式。
- `src/components/PoetizeWorld.astro`：主题按钮、互动小宠物。
- `src/components/PoetizeEffects.astro`：全页花瓣、动画偏好、阅读工具及封面灯箱。
- `public/themes/poetize-{coast,writing}.webp` 和对应 `-mobile.webp`：本次原创生成的绘画，见 [资源来源](theme-assets.md)。没有下载参考站独有插画。
- `src/layouts/BaseLayout.astro`：首次绘制前恢复偏好；挂载主题组件。

## 即时 Markdown 编辑

工作台 `/notes/` 新增默认「即时」模式。标题、段落、列表、引用、代码、链接、图片和表格按块原位排版；点击块编辑它的 Markdown，空行、离开块或 Ctrl/⌘+Enter 后恢复排版。完整 Markdown textarea 仍是唯一正文源，不进行 HTML 反向序列化。

保留源码、分栏和阅读模式，以及原保存、导出、鉴权和显式发布流程。即时与源码共用撤销历史；输入法组合期间保留活动编辑控件。没有新增依赖或外部 CDN。

这是块级即时编辑，并非完整复刻 Typora：活动块仍显示 Markdown 标记，表格通过源码编辑；即时模式使用顶部插入菜单，斜杠菜单保留在源码模式。复杂跨块扩展（如脚注、图表）以源码/阅读模式为准。

## 验证与预览

```sh
npm ci
npm run sync:projects
npm run check
npm run build
npm run preview -- --host 0.0.0.0
```

文章入口：`/blog/markdown-style-guide/?visual-theme=poetize`。首页、博客、读书、项目、生活、友链、关于、标签及文章详情共用主题。验证脚本及限制见 [验证记录](preview-validation.md)。工作台编辑功能测试使用现有本地开发模式；生产版本仍要求原站长鉴权。

### 无账号体验入口

`/editor-preview/?visual-theme=poetize` 是可直接访问的独立演示页，复用同一个 `LiveMarkdown` 类。它只使用示例文档与 `codeverse.editor-preview.draft.v1` 浏览器草稿，提供即时/源码、撤销/重做和 Markdown 导出。它不导入工作台、GitHub 同步或发布模块，不读取令牌，也不访问文档 API。外部图片与 PlantUML URL 在插入 DOM 前替换为占位说明，避免把输入内容发送到外部渲染服务；原 Markdown 保留供导出。正式 `/notes/` 的鉴权没有改变。

### 动效细节补充

保留已确认的插画与排版，追加一次性的侧栏／列表卡片轻入场、仅精细指针启用的卡片悬浮、键盘焦点描边与配图反馈、目录当前项轻移、阅读进度柔和跟随、灯箱入场和主题配色过渡。主题切换不替换 DOM，编辑器光标与 Markdown 保持不变。触屏不依赖悬浮；减少动态效果时跳过入场和切换过渡。隐藏页面停止装饰动画，离开页面释放新增观察器及动画帧。
