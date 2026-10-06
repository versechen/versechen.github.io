# 樱花动效

樱花主题增加全站分层落樱、花瓣翻转、周期微风、鼠标带风和右下角「风起」。浅色花瓣使用柔粉渐变，深色保持柔光；首页更丰盈，正文两侧留少量落樱。文章文字和目录区域不会持续覆盖花瓣。手机滚过首屏后停止画布，不在阅读区持续绘制；手机正文及边距不足的文章页自动收起动效按钮并同步停止、清空画布，避免遮挡及出现无法暂停的动效。回到有足够空间的区域时按已保存的偏好恢复。

页面进入时有一次花风横掠与标题轻入场，桌面 980ms、手机 820ms；前进／后退在浏览器提供方向信息时反向播放。保留 Astro 多页导航，不拦截点击、不等待动画才跳转、不替换 DOM、不修改 history 或滚动恢复。原生跨文档 View Transition 在验证环境 Chromium 151 中连默认转场也卡首帧，因此采用独立 CSS 入场，兼容不支持该接口的浏览器。动画层不接收指针，清理含 `animationend` 与 1100ms 兜底，快速离开或 BFCache 恢复不会残留遮罩。

2026-10-06 轻柔微调：保留现有花风转场，只缩短横向行程与上下摆幅、减小旋转，采用平缓起止和更低峰值透明度。转场 SVG 改用粉白与浅樱粉；自动入场和同视口历史恢复只带轻风，不重排花瓣。日常花瓣池、手动「风起」、布局及原生导航保持原样。

## 偏好与性能

- 暂停按钮记住 `sakura-effects`；系统减少动态效果优先，运行时变更也生效。存储被禁用仍可控制当前页。
- 单个 Canvas、缓存三种花瓣位图，桌面最多 60 片／60fps，手机最多 24 片／30fps，节省流量模式 14 片／30fps。风起重复触发有节流，不增加粒子、DOM 或计时器。
- DPR 上限桌面 1.5、手机 1.25，总位图最多约 300 万像素。隐藏页面停帧，离开页面取消帧与观察器，BFCache 恢复重连但不重复注册监听。
- 海滨主题保持原效果；记录工作台、编辑预览和项目文档不展示樱花动效。无 JavaScript 时内容和链接正常，动效控制隐藏。
- 不依赖 WebGL、第三方动画库、外部图片或字体；花瓣 SVG 为本项目绘制。

## 验证

```sh
npm ci
npm run test:sakura
npm run test:toc
npm run test:covers
npm run check
npm run build
npm run preview -- --host 127.0.0.1 --port 4323
# Playwright 可从现有测试工具安装导入，不作为网站运行依赖。
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs PREVIEW_URL=http://127.0.0.1:4323 node scripts/verify-sakura-motion.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs PREVIEW_URL=http://127.0.0.1:4323 node scripts/verify-toc-bounds.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs PREVIEW_URL=http://127.0.0.1:4323 node scripts/verify-poetize-motion.mjs
```

新增 6 个无浏览器生命周期测试进入 Pages 工作流；浏览器脚本覆盖可见入场、光暗模式、风起、快速连续导航、键盘导航、实际历史及滚动恢复、正文透明像素、开关持久化、动态 reduced-motion、后台停帧、反复恢复不叠加、手机 DPR/帧率/正文停帧、目录锚点、海滨与工作台隔离、禁用存储及禁用 JavaScript。证据默认写入 `/tmp/sakura-evidence/`（截图与 `results.json`）。

限制：浏览器检查使用 Chromium 与触屏设备模拟，未在实体 iPhone/Android 上测量电量；低性能设备的实际帧率可能低于上限。浏览器不提供历史方向时沿用向前花风。多页架构仍由浏览器加载新文档，入场并不消除网络加载时间。

2026-10-06 本地验收：19 项单元测试通过（樱花 6、目录 6、封面 7）；Astro 检查 0 errors / 0 warnings，保留编辑器原有 4 项弃用提示；37 页生产构建成功。樱花浏览器回归全部通过并实际命中 BFCache，测得桌面 60fps、手机 30fps；文章正文画布像素透明，320 项目录几何/可访问性检查和原海滨动效回归通过。另测 3840×2160、DPR 2 的画布为 2,999,391 像素，1024px 文章阅读区自动隐藏动效按钮。本地环境无法访问 Mermaid CDN，作为既有外部资源失败单独记录；项目同步部分外部仓库也使用既有占位回退。
