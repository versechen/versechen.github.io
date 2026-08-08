# 从 GitHub 同步项目

## 工作原理

```text
github-projects.json  →  sync-github-projects.mjs  →  Content Layer
        │                         │
        │                         ├─ GET /repos/.../readme
        │                         └─ GET docs/ + SUMMARY.md
        ▼
   元数据（名称、图标、标签）     正文（README / 文档 Markdown）
```

构建时（或本地手动）运行同步脚本，把远端 Markdown 写成 Astro Content Collections，项目预览页与 GitBook 文档站即可渲染。

## 清单字段

```json
{
  "slug": "openclaw",
  "repo": "versechen/openclaw",
  "name": "OpenClaw",
  "description": "一句话介绍",
  "icon": "🦞",
  "tags": ["TypeScript", "AI"],
  "status": "active",
  "github": "可省略，默认用 repo",
  "link": "https://example.com",
  "order": 2,
  "docs": {
    "path": "docs",
    "summary": "docs/SUMMARY.md",
    "maxFiles": 40,
    "exclude": [".gitbook", "assets"],
    "optional": false
  }
}
```

- 无 `docs`：只同步 README，项目页可预览，不显示「进入文档」
- `summary`：GitBook 风格目录，决定侧栏顺序与分组
- `optional: true`：远端没有 docs 时不失败（本站自身在尚未推送 docs 前可用）

## 本地命令

```bash
# 需要能访问 GitHub；已登录 gh 或设置 GITHUB_TOKEN 更稳
npm run sync:projects

# 只看某个项目
npm run sync:projects -- --slug=openclaw
```

## 安全

同步时会脱敏常见密钥形态（如 `sk-...`、`ghp_...`），避免把误提交进远端仓库的 token 写进本站静态页。仍建议在源仓库侧清理泄露密钥。
