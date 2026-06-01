# 项目状态

更新时间：2026-06-01  
生产站：<https://newhl-dashboard.pages.dev/>  
分支：`main`

## 结论

- **前端**：Direct Upload Pages；`push main` → [cloudflare-pages-deploy.yml](../.github/workflows/cloudflare-pages-deploy.yml) 构建并部署；CI **Verify production site** 自动验收 `Home-*.js` 上线。
- **数据**：生产构建注入 `VITE_DATA_API_BASE_URL` 时，首屏优先 Worker `/api/bundle`（R2）；失败回退 `dist/data/` 静态 CSV。本地开发读 `public/data/*.csv`。
- **验收**：Actions 三步 ✓ 即可；不必手查 `index-*.js` hash（见 [cloudflare-deploy.md](./cloudflare-deploy.md)）。

## 近期已完成（2026-05 ~ 06）

| 模块 | 变化 |
|------|------|
| 部署 | Actions 构建校验 + 生产 CDN 自动验收；wrangler pin 4.95.0 + commit-hash |
| 配置总览 | 指数小字链至详情页；页底数据来源说明；Safari 白屏 `_headers` + dev no-cache |
| 精选跟踪 / 监控 / 指数研究 | UI 与文案收敛（`7bb7a2b` 等） |
| 指数详情 | 主跟踪 ETF 可跳转；候选 ETF 数据状态/操作为「未接入 / 暂无」 |
| 数据同步 | 指数 T-1、ETF 前复权、OTC fund bars、R2 upload 链路在 CI 运行 |

## 数据口径

| 类型 | 说明 |
|------|------|
| ETF 行情 | `bars.csv` + `barsmore.csv`；场外 `fund_bars.csv` |
| 指数行情 | `index_bars.csv` 为主；股息率**仅观测值，不前填** |
| 产品表 | `etf_products.csv`（月更 F10 规模/费率） |
| 参数表 | `etf_params.csv`（红利主跟踪 RSI/布林） |
| 标普代理 | 无官方 TRI 时主跟踪 ETF 代理，页面**显式注释** |

字段细节 → [csv-schema.md](./csv-schema.md)。

## 待办（建议顺序）

| 优先级 | 事项 |
|--------|------|
| P1 | 精选跟踪：排序/筛选（超额、年化、分位） |
| P1 | 盘中监控与精选跟踪统一「分位/触发」文案 |
| P1 | 标普官方 TRI；007751 跟踪差 |
| P2 | 自愿打赏入口（见 [donation-design.md](./donation-design.md)，未实现） |

已完成、不再列入近期：Pages 手工发布为主链路、流动性/折溢价/跟踪误差字段、R2/Worker 基础链路搭建。

## 常用命令

```bash
npm run dev
npm run build          # 改完至少跑一遍
npm test
npm run lint
npm run format

# 数据（本地）
python3 scripts/index_data_sync/sync_a_share_dividend_indices.py
node scripts/sync_etf_products_monthly.mjs
node scripts/verify_etf_products.mjs

# 部署与数据（非常规 / 应急，见 cloudflare-deploy.md）
npm run r2:upload
npm run worker:deploy
npm run release:worker-pages
```

## 关键源码

```text
src/pages/FeaturedTrackingPage.tsx   精选跟踪
src/pages/Monitor.tsx              盘中监控
src/components/ConfigDeskOverview.tsx  配置总览
src/lib/strategy.ts                信号逻辑
src/context/DataSourceContext.tsx  数据加载（API → CSV 回退）
.github/workflows/cloudflare-pages-deploy.yml  生产前端发布
public/_headers                    Pages 缓存策略
```
