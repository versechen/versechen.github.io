# 内容写作

## 博客与读书

- 博客：`src/content/blog/` 下的 `.md` / `.mdx`
- 读书：`src/content/books/` 下的 `.md`

完整 Markdown 格式示例见 `src/content/blog/markdown-style-guide.md`。

## 文章封面

记录页发布新文章时，会从 `src/config/blog-covers.json` 的 `presets` 中随机选择一张未使用图片，把 `heroImage` 和 `assigned` 分配记录一起写入 Git 提交。更新文章保留原封面；删除或归档文章也不释放它用过的图片。两个窗口同时发布时，仓库快进检查会阻止第二次提交覆盖第一份分配记录，刷新后重试即可。

直接写 Markdown 时，提交前执行：

```bash
npm run covers:assign
npm run check
npm run build
```

文章和封面清单必须一起提交。构建会检查它们是否一致，不会在每次构建或访问页面时重新随机。

预设用完会提示补充图片，不会重新使用旧封面。将新图片放进 `src/assets/images/`，把文件名加入 `presets` 即可扩充；保留 `assigned` 中的历史记录。启用前已有的文章封面保持原样，旧文章之间原有的重复也保留，新分配会排除这些已用图片。

## 项目（来自 GitHub）

项目卡片与文档**不再手写维护正文**，而是由同步脚本生成：

| 路径 | 说明 |
| --- | --- |
| `src/data/github-projects.json` | 项目清单（仓库、展示名、图标、docs 配置） |
| `src/content/projects/` | 同步生成的 README（构建产物，勿手改） |
| `src/content/project-docs/` | 同步生成的 docs（构建产物，勿手改） |

要展示新仓库：在清单里加一项，然后执行 `npm run sync:projects`。
