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

## 动效细节验证（2026-10-02）

- `npm run check`：48 文件，0 errors / 0 warnings（4 条既有 API 提示）。`npm run build` 通过。
- `verify-poetize-motion.mjs`：桌面悬浮／键盘焦点、主题切换过渡清理与刷新持久化、模拟 visibilitychange 暂停／恢复、编辑器焦点及源码不变、减少动态效果、390px 触屏卡片导航及无横向溢出全部通过。
- `verify-visual-themes.mjs`：88 个路由／主题／明暗／视口组合通过；原 Mermaid CDN 动态模块在此环境仍加载失败，属于外部依赖限制。
- `verify-poetize-interactions.mjs` 与 `verify-editor-preview.mjs` 全部通过，覆盖动画开关、灯箱、专注阅读、进度／返回顶部、编辑撤销与导出、草稿持久化、无外发请求及正式工作台鉴权。
- 已查看 1440×1000 与 390×844 截图。新增动效使用 translate/opacity，不改变文档尺寸；后台行为采用模拟可见性事件验证，未在真实手机或 Safari 上测试。

## 即时编辑块边界修复（2026-10-02）

复现整段替换为不带尾换行的文本后，下一个标题直接拼接到段落的问题。共享 `LiveMarkdown` 现在将原有块间空白排除在可替换范围之外，输入时即保留分隔符，覆盖自动保存、Ctrl/⌘+Enter 和失焦提交；正式工作台与演示页均复用修复。

`verify-live-boundaries.mjs` 在修复前复现失败，修复后 6 组用例通过：后接标题／列表／代码块、两种空行间隔、精确源码、撤销重做及源码往返。`verify-editor-preview.mjs`、本地开发工作台 `verify-live-editor.mjs`、check（0 错误／警告）与 build（32 页）通过。没有执行生产工作台远端写入。

## 深色首屏与字体修复（2026-10-02）

已复现深色首页 `.hero-gradient` 的计算背景仅剩樱花 radial-gradient，原因是原页面 scoped 深色 background 简写覆盖海岸图；现将该原规则限定为非 Poetize。文章卡片图未改。

新增 `verify-poetize-hero.mjs`，修复前在 2048 深色失败，修复后 2048／1440／390 × 深浅色通过：海岸图片解码成功、全宽图层可见、标题 500／卡片 600 字重、中文字体回退、主题切换及刷新持久化。已查看桌面与手机深色实际截图，插画清晰、文字可读。check／build、88 页面组合、块边界六用例和编辑演示回归通过；Mermaid 外部 CDN 在环境中仍不可达。

## 第四轮海滨预览验证

- `verify-coastal-refinement.mjs`：2048／1440／390／360 × 深浅色 × 9 路由，共 72 组合，DPR2。验证响应式图片解码、逐页图案映射、无横滚、宽屏内容宽度、字体、搜索空态、年份筛选刷新、樱花隔离及主题持久化。
- `verify-coastal-contrast.mjs`：正文／辅助字／弱级字／侧栏／选中态共 10 组文字配色对比度为 5.12–11.05:1；实测搜索焦点、标签选中态。该数值是实色 UI 配色，不是对插画每个像素的文字对比承诺。
- 既有 88 组合路由测试、6 组 Markdown 边界、编辑演示、波浪／灯箱／专注／返回顶部、减少动态效果、切换不丢编辑焦点及桌面手机首屏检查通过。外部 Mermaid CDN 仍在云环境不可达。
- check：0 errors / 0 warnings，4 个既有 API 提示；build：32 页。截图含首页深浅宽屏/手机、九类页面与侧栏焦点/选中状态，保存于执行环境 `coastal-refinement-evidence`。
- 未在 Safari／真实手机执行；DPR2 使用 Chromium 模拟。首页原生 2172×724 并非 4K，宽屏 DPR2 仍重采样；对此不宣称无损高清。没有推送或部署正式 main。

### v4 最后可读性与统一性 QC

首页、关于、友链标题增加局部柔化衬底与轻阴影，导航改为 600 字重无衬线并仅顶部条带补强对比；未加重整张图片。首页仅两篇使用 `cover-markdown.svg` 模板的已知文章，海滨缩略图分别映射写作阳台／工作室，原 metadata、原封面文件、文章详情封面、樱花主题均不变。

侧栏计数提升对比；博客筛选页和文章页停止花瓣画布而保留波浪；手机隐藏装饰宠物、工具贴边，首卡提前约 59px。`verify-coastal-final-qc.mjs` 的 32 组明暗／视口／路由检查、Markdown 边界六用例、编辑演示及既有波浪／灯箱／专注阅读交互检查通过，check 0 错误／警告，build 32 页。已查看手机主标题、关于与友链局部对比和宽屏系列缩略图；更新 `docs/preview-v4` 的实际像素证据。

## v5 首页远景预览（2026-10-02，仅本地）

- `npm run check`：通过，0 errors / 0 warnings / 4 既有 hints。
- `npm run build`：通过，32 页面。
- `verify-visual-themes.mjs`：通过；88 路由／主题／浅深色／视口组合，主题切换、刷新记忆、旧 forest 迁移及基础交互。Mermaid 外部 CDN 动态导入仍受当前网络限制。
- `verify-coastal-final-qc.mjs`：通过；32 组主页／关于／友链／博客桌面与手机 DPR2 状态、无溢出、原封面与樱花保留。
- 额外实际观察 1024px 首页，440px 高度下标题、按钮与探索提示均可见；2048/DPR2 及390/DPR2截图见 `docs/preview-v5/`。裁切和候选源实测见 before/after-crop.json。
- 本轮没有改动编辑器或鉴权，未重跑编辑器专用测试；未执行生产部署、远端推送或 PR，未作生产验证。
- 字体保持现有 OFL Noto Serif 子集。原生 4K 生成受工具能力限制，最终源图仍为 2172×724，清晰度欠缺没有被冒称解决。
