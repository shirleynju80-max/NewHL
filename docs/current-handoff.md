# 当前交接（2026-06-02）

## 状态一览

| 项 | 说明 |
|----|------|
| 生产站 | <https://newhl-dashboard.pages.dev/> 正常 |
| 发布 | `push main` → Actions **Cloudflare Pages deploy**；三步 ✓ = 对外 UI 已更新 |
| 数据 | 前端**同域 `/data/*.csv` 为主源**（与部署/R2 同源同新），缺失/失败才回退 Worker `/api/bundle`；sync workflow 成功后 R2 upload，无需 redeploy Pages |
| 本地 | `npm run dev`；CSV 在 `public/data/` |

## 本轮已完成（首屏性能）

- **去双下载**：首屏不再 CSV + API 各下一遍全量，CSV 成功即停（`DataSourceContext`）。
- **并行拉取**：`tryFetchPublicCsv` 多文件 `Promise.all`，去掉串行瀑布。
- **CSV 压缩**：`_headers` 把 `/data/*.csv` 的 `Content-Type` 改 `text/plain`，触发 Cloudflare br/gzip（`index_bars.csv` 传输 3.3MB → 856KB）。
- **恢复缓存**：去掉 `/data` fetch 的 `no-store` + `?_t`，让 `max-age=300` 生效。
- 实测：Chromium 冷加载数据窗口 ~600ms、0 长任务；手机 WeChat / Safari 干净加载明显变快。

详细口径与命令 → [project-status.md](./project-status.md)  
部署与验收 → [cloudflare-deploy.md](./cloudflare-deploy.md)

## 工作区注意

- `exports/`：导出脚本产物，**不提交**（`scripts/export_featured_tracking.mts`、`scripts/export_index_total_return.py`）。
- `docs/donation-design.md`：打赏产品设计草案，**代码未实现**。

## 短期待办

- [ ] 精选跟踪：按超额/年化/分位的最小排序或筛选
- [ ] 盘中监控 ↔ 精选跟踪：分位数与触发状态用词统一
- [ ] 首屏再降载（可选，B 方案）：构建/同步期**预计算快照 JSON**（首页利差分位、精选回测摘要），首屏读快照 + 近 5 年 bars 画图，完整 bars 按需加载。**不可**简单按近 5 年切片 CSV——头条数字按全历史算，会算错（见 AGENTS.md 数据口径）。`index_bars.csv` 因首页利差分位强依赖全历史，不能直接移出首屏。

## 接手时

1. `git status --short` — 勿回滚未确认改动  
2. 读本文件 + [project-status.md](./project-status.md) + [AGENTS.md](../AGENTS.md)  
3. 改 UI/文案前读 [ui-spec.md](./ui-spec.md)  
4. 改完 `npm run build`；涉及页面则本地或 Actions 验收
