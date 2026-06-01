# 文档索引

**新人 / Agent 阅读顺序**：`project-status.md` → `current-handoff.md` → 按需打开专题文档。

| 文档 | 何时读 |
|------|--------|
| [project-status.md](./project-status.md) | 项目结论、数据口径、待办、常用命令 |
| [current-handoff.md](./current-handoff.md) | 当前焦点与短期未完成项（轻量，避免重复 status） |
| [cloudflare-deploy.md](./cloudflare-deploy.md) | 发布、R2/Worker、**Actions 三步验收** |
| [csv-schema.md](./csv-schema.md) | CSV 列定义 |
| [ui-spec.md](./ui-spec.md) | UI 规范与文案术语（改视觉/文案必读） |
| [etf-product-data.md](./etf-product-data.md) | 产品表字段与 F10 数据源 |
| [donation-design.md](./donation-design.md) | 自愿打赏入口设计（未实现，产品草案） |
| [../scripts/index_data_sync/README.md](../scripts/index_data_sync/README.md) | 指数 CSV 同步脚本 |
| [../public/data/README.txt](../public/data/README.txt) | 本地 `public/data` 说明 |
| [../README.md](../README.md) | 仓库简介与快速启动 |
| [../AGENTS.md](../AGENTS.md) | AI 助手约束与踩坑 |

## 发布与验收（摘要）

- **UI / 文案**：`git push origin main` → GitHub Actions **Cloudflare Pages deploy** 三步均 ✓（含 **Verify production site**）即对外已更新。细节见 [cloudflare-deploy.md](./cloudflare-deploy.md)。
- **行情 / 指数数据**：sync workflow → R2 upload；**不必**为数据单独 redeploy Pages。
- **应急回退**：`npm run release:worker-pages`（非常规）。
