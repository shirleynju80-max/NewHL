# 价值底仓配置台

Vite + React + TypeScript。从「现金创造」与「股东回报」两维度观察指数与 ETF，支持指数研究、产品选择、盘中监控与策略回测。

生产站：<https://newhl-dashboard.pages.dev/>

**状态与命令** → [docs/project-status.md](docs/project-status.md)  
**文档索引** → [docs/README.md](docs/README.md)  
**CSV 表结构** → [docs/csv-schema.md](docs/csv-schema.md) · [public/data/README.txt](public/data/README.txt)

## 本地运行

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

数据默认从 `public/data/*.csv` 加载；可配置 `VITE_DATA_API_BASE_URL` 走 Worker `/api/bundle`（失败回退 CSV）。无 CSV 时使用内置 mock。

## 主要页面

| 路径 | 说明 |
|------|------|
| `/` | 配置总览 |
| `/indices` | 指数研究 |
| `/products` | 产品选择 |
| `/monitor` | 盘中监控 |
| `/etf/:code` | ETF 详情（回测、信号、利差） |
| `/indices/:code` | 指数详情 |

## 数据同步（摘要）

| 链路 | 脚本 / Workflow | 输出 |
|------|-----------------|------|
| ETF 实时 | `scripts/realtime_crawler/sync_etf_realtime.py` · [realtime-crawler.yml](.github/workflows/realtime-crawler.yml) | `barsmore.csv` |
| 指数 T-1 | `scripts/index_data_sync/sync_a_share_dividend_indices.py` · [index-t1-sync.yml](.github/workflows/index-t1-sync.yml) | `index_bars.csv` 等 |
| 股息率 DID | `sync_h30269_dividend_yield_redrocket.py`；刷新日 `fetch_redrocket_div_yield_refresh.py` | `index_bars` 股息率列；`redrocket_div_yield_meta.json` |
| 产品表 | `node scripts/select_index_tracking_etfs.mjs` + `node scripts/sync_etf_products_monthly.mjs` · [etf-products-monthly.yml](.github/workflows/etf-products-monthly.yml) | `index_tracking_etfs.csv`、`etf_products.csv` |

## 部署

- Docker：`docker build -t dividend-dashboard . && docker run -p 8080:80 dividend-dashboard`
- Cloudflare Pages + R2 + Worker：见 [docs/cloudflare-deploy.md](docs/cloudflare-deploy.md)

```bash
npm run r2:upload
npm run worker:deploy
npx wrangler pages deploy dist --project-name=newhl-dashboard
```

## 目录

```
src/              前端
public/data/      CSV（多数 gitignore）
scripts/          爬虫与数据脚本
workers/data-api/ Worker API
.github/workflows CI
```
