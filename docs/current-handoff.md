# 当前交接（2026-06-01）

## 状态一览

| 项 | 说明 |
|----|------|
| 生产站 | <https://newhl-dashboard.pages.dev/> 正常 |
| 发布 | `push main` → Actions **Cloudflare Pages deploy**；三步 ✓ = 对外 UI 已更新 |
| 数据 | Worker/R2 为主；sync workflow 成功后 R2 upload，无需 redeploy Pages |
| 本地 | `npm run dev`；CSV 在 `public/data/` |

详细口径与命令 → [project-status.md](./project-status.md)  
部署与验收 → [cloudflare-deploy.md](./cloudflare-deploy.md)

## 工作区注意

- `exports/`：精选跟踪导出脚本产物，**不提交**（`scripts/export_featured_tracking.mts`）。
- `docs/donation-design.md`：打赏产品设计草案，**代码未实现**。

## 短期待办

- [ ] 精选跟踪：按超额/年化/分位的最小排序或筛选
- [ ] 盘中监控 ↔ 精选跟踪：分位数与触发状态用词统一
- [ ] 移动端冷启动 / 微信内浏览器抽验（Safari 强刷白屏已有 `_headers` 缓解）

## 接手时

1. `git status --short` — 勿回滚未确认改动  
2. 读本文件 + [project-status.md](./project-status.md) + [AGENTS.md](../AGENTS.md)  
3. 改 UI/文案前读 [ui-spec.md](./ui-spec.md)  
4. 改完 `npm run build`；涉及页面则本地或 Actions 验收
