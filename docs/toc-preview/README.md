# 阅读目录交互预览

修复原目录在有左侧空白时自动展开、手机始终展开的问题。沿用 TableOfContents 组件与原锚点，没有新增另一套目录。

- 默认 collapsed：只保留左侧固定的44×48px「目录」按钮，位置45vh。无整条左侧鼠标热区，不占正文布局列。
- 精细鼠标在按钮停留220ms后 temporary；按钮点击/Enter/Space也可打开。键盘打开进入关闭按钮，Tab遍历目录，Escape关闭并将面板内焦点送回触发按钮。
- 鼠标或键盘焦点在面板中时保持显示，目录自身滚动不触发隐藏；离开后只累计向下的页面滚动。前40px保持，后200px逐渐淡出，累计240px收起。向上滚动不重新弹出或恢复目录。关闭后 inert、aria-hidden和pointer-events保证不拦截点击或Tab。
- 图钉进入 pinned，页面滚动不隐藏；取消固定进入 temporary。明确关闭（按钮/×/Escape）同时解除固定。新持久化键 `codeverse.articleToc.pin.v2` 只记录新版明确操作，忽略旧 `codeverse.articleToc.pinned`，避免旧状态导致默认常驻。存储不可用时本次操作仍有效。
- 触屏使用明确按钮打开、关闭及固定；面板覆盖层不挤压阅读列。保留标题锚点的导航栏偏移与原生hash/back导航，并更新当前标题高亮。
- 减少动态效果时取消过渡，仍按距离更新透明度。没有改动字体、图片、文章、鉴权或编辑器。

验证：`npm run check` 0错误/0警告/4既有提示；构建32页通过。`scripts/verify-toc-intent.mjs` 实测两主题×浅深色，默认收起/旧pin忽略、hover延迟、悬停与焦点保持、140px中途透明度、240px后收起、固定触发位置、Enter/Space/Tab/Escape与焦点恢复、固定刷新持久化/解除固定、锚点头部偏移及当前项、浏览器返回、resize与390px触屏、正常与减少动态效果模式均通过。没有执行生产发布。

截图：poetize-dark-collapsed 为默认阅读；poetize-dark-fade 为半透明中途；desktop-pinned 与 touch-pinned 为主动固定。所有截图来自公开示例文章。
