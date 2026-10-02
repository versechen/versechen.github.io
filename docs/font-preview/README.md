# 海滨手写字体预览

选用 **霞鹜文楷 LXGW WenKai Regular v1.522**，是风格相近的替代字体，不是 Poetize 的原字库。

- 官方项目：https://github.com/lxgw/LxgwWenKai
- 固定版本：https://github.com/lxgw/LxgwWenKai/releases/tag/v1.522
- 原始 TTF：https://raw.githubusercontent.com/lxgw/LxgwWenKai/v1.522/fonts/TTF/LXGWWenKai-Regular.ttf
- 官方许可：https://github.com/lxgw/LxgwWenKai/blob/v1.522/OFL.txt
- SIL OFL 1.1 允许使用、修改、嵌入及再分发；随包保留版权和完整许可 `public/fonts/OFL-LXGW-WenKai.txt`。子集内部族名改为 Coastal Hand。

## 字体搭配与体积

标题、导航、卡片标题和文章/编辑预览小标题使用文楷真实 400 字重；长正文、说明和输入控件保留系统无衬线字体，代码及 Markdown 编辑区保持原等宽栈。仅海滨主题匹配；樱花保持原样。`font-display: swap`，无需外部 CDN，加载失败时用本地楷体/系统字体显示。

上游原字库含 46,490 个 Unicode 映射；当前网站源代码与内容子集保留 1,302 个字符，当前源文件中文无缺字。新增内容里的子集外字会回退；发布新内容后可重跑脚本纳入新增字形，不宣称小子集覆盖全部中文。

本地 `coastal-hand.woff2` **268,120 bytes（261.8 KiB）**，相比原 Noto 展示 WOFF 的 576,556 bytes 缩小 **53.5%**。只提供一套真实字重，不下载约24 MiB的原字库。旧字体资产暂保留供旧版本缓存，当前 CSS 不引用。

重建：安装 fonttools、brotli 后运行 `python scripts/build-coastal-wenkai.py /path/to/LXGWWenKai-Regular.ttf`。
原始 TTF SHA256：`39ad71264b588165b469e35e6afb162a378dacd1f95348160240ba9038ac3009`。

## 对比和验证

before/after 桌面、手机图均来自1440×1152、390×844视口，DPR2截图压缩为JPEG。另附博客深色和编辑预览，便于检查长文与手写标题搭配。此分支尚未发布 main。

检查通过：`npm run check`（0错误、0警告、4既有提示）、`npm run build`（32页）；`verify-coastal-font.mjs` 覆盖首页/博客/关于/文章/编辑预览 × 桌面/手机 × 浅深色20组，验证实际自托管字体加载、真实400字重、导航和标题一致、无横向溢出、正文与代码栈分离、樱花字体不变且初次访问不请求新字体。`verify-editor-preview.mjs` 通过中文编辑、撤销重做、导出、刷新持久化、手机布局及原鉴权门；无真实文章写入或API请求。未做生产发布/生产复核。
