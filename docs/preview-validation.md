# Poetize 风格预览验证

## 第一轮历史记录

- 基线：远端 main `7f28240a2324871b53819556fe3542a7d6b9d70d`。
- 分支：`preview/poetize-global`。第一轮本地验证后，用户已明确授权推送此独立预览分支；没有创建 PR、合并 main 或部署正式 GitHub Pages。
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

## 第二轮：精细绘画与即时编辑（2026-10-02）

参考依据来自父端实际浏览器观察：1174×753 首页短插画首屏、半透明字幕、双层慢波浪、全页花瓣、资料侧栏与双列配图卡片；文章较短的配图标题区、摘要卡片及返回顶部。父端提供可见行为的尺寸/动画参数，本环境直接访问参考站仍被代理拒绝；没有把参考站未加载的正文当成排版证据。

### 新增验证

- `scripts/verify-poetize-interactions.mjs`：读取实际 computed style，确认绘画 WebP、两个波浪动画；读取 Canvas alpha 确认真正绘制；点击下行入口后 scrollY 改变；卡片标题实际颜色非白色；hover 后图片 background-size=120%；关闭效果后动画暂停、Canvas 隐藏且刷新偏好保留。
- 文章封面灯箱打开、Escape 关闭、焦点返回；专注阅读可逆，正文保留；进度条随正文滚动，返回顶部到 scrollY=0；减少动态效果令动画按钮禁用、Canvas 隐藏。
- `scripts/verify-live-editor.mjs`：在本地开发模式验证标题/强调/链接/列表/引用/代码/图片/表格、原位编辑、工具栏选区、真实剪贴板粘贴、空行后新标题排版、即时/源码正文逐字一致、跨模式撤销重做、composition 事件期间控件不替换、Markdown 导出与刷新保存、390px 无横向溢出。
- 编辑器没有新增依赖，也没有修改鉴权与发布入口。生产预览未登录时仍显示原站长登录门槛；因此生产站长登录后的编辑链路、真实 GitHub 写操作没有测试。真实系统输入法候选窗口没有自动化，只验证了 composition 事件与正文保留。
- 即时模式是块级渲染；活动块仍显示 Markdown 标记，复杂表格通过源码编辑，不能称为完整 Typora 复刻。

88 个组合测试的范围仍是路由返回、主题状态、明暗状态和无页面横向溢出，并非每个组合都逐像素人工验收。人工查看首页及配图卡片、文章桌面/手机和深色、正文代码、专注阅读，以及编辑器桌面/手机截图。

## 无账号编辑演示入口

新增 `/editor-preview/`，并在实际生产构建上运行 `scripts/verify-editor-preview.mjs`：

- 不登录即可编辑，原位输入、空行排版、即时/源码逐字往返通过。
- 按钮与快捷键撤销/重做、Markdown 导出逐字一致、刷新后草稿恢复通过。
- 1440×1000 与 390×844 实测，手机无页面横向溢出。
- 监听演示期间全部浏览器请求：只有同源静态 GET，没有跨源、API 或非 GET 请求；输入外部图片和 PlantUML 块后也没有外发请求。
- 页面的本地草稿键独立于正式工作台，不读取账号令牌、不连接 GitHub、不提供发布。
- 同一生产构建访问 `/notes/`，原站长登录门槛仍可见、工作台未解锁。
- 类型检查 48 文件，0 errors / 0 warnings / 4 个原有 hints；构建 32 页。
