# Poetize 风格预览验证

- 基线：远端 main `7f28240a2324871b53819556fe3542a7d6b9d70d`。
- 本地分支：`preview/poetize-global`；未 push、未创建 PR、未合并、未部署 GitHub Pages。
- 环境：Node 24.19.0 / Chromium；云环境可用，文件和预览进程均已确认保留。
- 没有仓库 AGENTS.md、.agents/skills/SKILL.md；工作区 .agents 目录为空。已阅读 README 与 docs/visual-themes.md。

## 通过

- `npm ci --cache /tmp/codeverse-npm --no-audit --no-fund`。
- `ASTRO_TELEMETRY_DISABLED=1 npm run check`：41 个文件，0 errors、0 warnings、4 个原有弃用 API hints。
- `ASTRO_TELEMETRY_DISABLED=1 npm run build`：31 个静态页面。
- `git diff --check`。
- Chromium 1440×1000、390×844；樱花/Poetize × 浅色/深色 × 11 条路由，88 个组合均返回 200、视觉主题正确且无页面横向溢出。
- 路由：首页、博客列表、Markdown 写作能力指南文章、读书、项目、生活、友链、关于、标签、记录、codeverse 项目文档。
- 视觉按钮切换、刷新持久化、跨路由恢复、旧 forest 值迁移、明暗与视觉主题独立、手机菜单与 Escape、代码复制、宠物交互、减少动态效果、禁用存储时两个切换按钮。
- codeverse 项目 README 面板打开和关闭。
- 人工查看文章首屏、代码与正文、目录、手机、深色、首页及项目列表截图。

自动浏览器复核：`scripts/verify-visual-themes.mjs`。需可用 Playwright（通过 PLAYWRIGHT_MODULE 指定）和 Chromium；默认访问本地生产预览 4322 端口，输出目录由 PREVIEW_EVIDENCE 指定。

## 限制与未验证

- 参考站 https://poetize.cn/ 的直接访问被网络代理拒绝（CONNECT 403）；仅能取得搜索索引与历史截图信息，未完成参考站实时截图对比。插画为本次原创 SVG，没有下载或复用参考站资产。
- GitHub 项目同步仅 codeverse 成功（README + 5 篇文档）。其余四个项目请求 `fetch failed`，沿用同步脚本的占位页机制；不把这些占位页当成完整内容验证。
- 文章已有 Mermaid CDN 动态导入被环境网络阻止，保留原有实现；Mermaid、远程 PlantUML 图片的最终渲染未通过本环境验证。
- 没有进行真实 GitHub 登录、发布文章、删除/归档文章等远端写操作。
- 云环境只提供本地 HTTP 服务，没有向用户暴露的端口转发地址；没有擅自使用额外托管服务。`localhost` 和环境内网 IP 不能作为公开预览交付。

## 交付

- 生产预览文章入口（环境内部）：`http://127.0.0.2:4322/blog/markdown-style-guide/?visual-theme=poetize`。
- 文章离线 HTML：内联现有构建的 CSS、JavaScript、本地图片与字体；默认海蓝主题，支持两个主题和明暗切换、正文与目录。导航至其他页面会提示使用完整预览包。外部图表依赖仍需网络。
- 完整预览包：包含 dist、截图、检查日志和补丁。解压后在 dist 运行 `python3 -m http.server 4321`，访问 `http://localhost:4321/blog/markdown-style-guide/?visual-theme=poetize`。
