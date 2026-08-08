# 内容写作

## 博客与读书

- 博客：`src/content/blog/` 下的 `.md` / `.mdx`
- 读书：`src/content/books/` 下的 `.md`

完整 Markdown 格式示例见 `src/content/blog/markdown-style-guide.md`。

## 项目（来自 GitHub）

项目卡片与文档**不再手写维护正文**，而是由同步脚本生成：

| 路径 | 说明 |
| --- | --- |
| `src/data/github-projects.json` | 项目清单（仓库、展示名、图标、docs 配置） |
| `src/content/projects/` | 同步生成的 README（构建产物，勿手改） |
| `src/content/project-docs/` | 同步生成的 docs（构建产物，勿手改） |

要展示新仓库：在清单里加一项，然后执行 `npm run sync:projects`。
