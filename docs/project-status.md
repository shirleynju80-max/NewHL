# 项目状态

更新时间：2026-05-28  
生产站：<https://newhl-dashboard.pages.dev/>  
当前分支：`cursor/config-desk-nav-ui`（待合并 main）

## 结论

前端 SPA 可用；主数据为 `public/data/*.csv`。配置 `VITE_DATA_API_BASE_URL` 时优先 Worker `/api/bundle`，失败回退静态 CSV。

## 产品框架

- **现金创造**：自由现金流指数 — 长期质量底仓观察；**现金流 ETF 暂不战术**（无 `etf_params`，详情页不展示策略回测）
- **股东回报**：红利指数 — 股息率、股债利差；主跟踪 ETF 可登记 RSI/布林等参数
- **分工**：指数 = 研究；ETF = 执行；`is_primary=true` = 盘中监控默认池

## 近期已完成（2026-05）

| 模块 | 内容 |
|------|------|
| 配置总览 / 导航 | 分层导航；首页收敛 |
| 指数研究 | 可排序列表；长历史图多频聚合；标普 ETF 代理（`indexEtfProxy.ts`） |
| 产品选择 | 按指数分组；列宽/状态色；筛选「行情已接入 / 暂无」 |
| **精选跟踪** | 代表指数矩阵（可排序）；红利 ETF 策略分组表；标普代理 + 页脚注释 |
| 盘中监控 | 仅 `etf_params` + 主跟踪；排除观测注册 |
| 策略研究 | Top2 = 全样本位 + 验证位；Registry 自定义 baseline |
| ETF 详情 | 满 2 年才回测；现金流/短历史提示「策略置信度不足」 |
| 数据/脚本 | 产品表 workflow；前复权全量刷新；`verify_param_top2.mjs` |

## 数据口径

| 类型 | 说明 |
|------|------|
| ETF 行情 | 爬虫 → `barsmore.csv`；历史 `bars.csv` |
| 指数行情 | T-1 → `index_bars.csv`；DID 股息率 **不前填** |
| 场外基金 | `fund_bars.csv`（007751 等） |
| 产品表 | `etf_products.csv` + F10 月更（见 [etf-product-data.md](./etf-product-data.md)） |
| 策略参数 | `etf_params.csv` — 红利主跟踪等；**不含现金流 ETF** |
| 标普代理 | `SPCLLHCP.SPI`→515450、`SPAHLVCP.SPI`→513630；页内注释 |

## 待办

| 优先级 | 事项 |
|--------|------|
| P0 | 合并分支、部署 Pages、生产 UI 复查 |
| P0 | Actions workflow_dispatch 跑通 |
| P1 | R2 / Worker 生产 bundle |
| P1 | 现金流 ETF 满 2 年后补参数与精选跟踪策略 |
| P1 | 标普官方 TRI；007751 跟踪差 |
| P2 | 流动性/折溢价/跟踪误差字段 |

## 常用命令

```bash
npm run dev
npm run build

python3 scripts/realtime_crawler/sync_etf_realtime.py --skip-history --dry-run
python3 scripts/index_data_sync/sync_a_share_dividend_indices.py
node scripts/sync_etf_products_monthly.mjs
node scripts/verify_etf_products.mjs
node scripts/verify_param_top2.mjs <code>

npx wrangler pages deploy dist --project-name=newhl-dashboard
```

## 目录要点

```
src/pages/FeaturedTrackingPage.tsx   精选跟踪
src/lib/indexEtfProxy.ts             标普 ETF 代理
src/lib/etfListingAge.ts             策略回测年限门槛
src/lib/paramVariants.ts             监控/详情参数来源
docs/README.md                       文档索引
AGENTS.md                            Agent 约定
```
