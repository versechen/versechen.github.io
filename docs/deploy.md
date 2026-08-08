# 部署

推送到 `main` 后，GitHub Actions 会：

1. `npm ci`
2. `npm run sync:projects`（用 `GITHUB_TOKEN` 拉取各仓库 README / docs）
3. `npm run check && npm run build`
4. 发布到 GitHub Pages

因此远端仓库更新文档后，重新部署本站（或 push 触发构建）即可看到最新内容，无需把文档复制进本仓库。
