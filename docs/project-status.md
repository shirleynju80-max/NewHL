# 项目状态

更新时间：2026-05-28  
生产站：<https://newhl-dashboard.pages.dev/>  
当前分支：`main`

## 结论

站点以静态 Pages 为主路径可用，数据来自 `dist/data/*.csv`。当前未依赖 R2/Worker（无支付方式时也可运行）；若配置 `VITE_DATA_API_BASE_URL`，前端会先尝试 `/api/bundle`，失败后回退静态 CSV。

## 本周关键变化

| 模块 | 变化 |
|------|------|
| 部署稳定性 | 增加 `public/_headers`，将 `index.html` 设为 `no-cache`，降低 Safari 白屏概率 |
| 首页体验 | 配置总览“现金流 vs 沪深300”增加首屏加载文案，减少误判“无数据” |
| 精选跟踪 | ETF 策略表精简列（去回撤/波动/规模费率），新增策略年化与盘中价格；布林带文案改“分位数” |
| 触发逻辑 | 精选跟踪“当前状态”改为基于当前K触发，避免历史信号误标（如低分位显示卖出） |
| 文案收敛 | 多页面去除过度技术化提示（public/data、CSV内部字段） |
| 数据 API | Worker `/api/bundle` + R2 `newhl-data` 链路已具备；当前生产可继续以静态 CSV 为主路径 |

## 数据口径（保持）

| 类型 | 说明 |
|------|------|
| ETF 行情 | 历史 `bars.csv` + 增量 `barsmore.csv` |
| 指数行情 | `index_bars.csv` 为主；股息率只用观测值，**不前填** |
| 场外基金 | `fund_bars.csv`（如 007751）用于补足基金序列 |
| 产品表 | `etf_products.csv`（F10 月更） |
| 参数表 | `etf_params.csv`（红利主跟踪为主，现金流 ETF 暂无） |
| 标普代理 | 本地无官方 TRI 时，页面可用主跟踪 ETF 代理并显式注释 |

## 下一步（建议顺序）

| 优先级 | 事项 | 产出 |
|--------|------|------|
| P1 | 精选跟踪增加“排序/筛选”最小交互（按超额、年化、分位） | 提升可读性与操作效率 |
| P1 | 盘中监控与精选跟踪统一“分位/触发”口径文案 | 降低用户理解成本 |
| P1 | 标普官方 TRI；007751 跟踪差 | 补齐仍依赖代理或基金净值的研究口径 |

已完成/不再列入近期：分支合并、Pages 生产部署复查、Actions 手动触发链路、R2 / Worker bundle、流动性/折溢价/跟踪误差字段。

## 常用命令

```bash
npm run dev
npm run build

# 静态生产部署（当前主路径）
env -u VITE_DATA_API_BASE_URL npm run build
npx wrangler pages deploy dist --project-name=newhl-dashboard --branch=main --commit-dirty=true

# 数据脚本
python3 scripts/index_data_sync/sync_a_share_dividend_indices.py
node scripts/sync_etf_products_monthly.mjs
node scripts/verify_etf_products.mjs
node scripts/verify_param_top2.mjs <code>
```

## 关键文件

```text
src/pages/FeaturedTrackingPage.tsx    精选跟踪页（当前迭代核心）
src/pages/Monitor.tsx                 盘中监控页
src/lib/indicatorPercentile.ts        分位数/区间口径
src/lib/strategy.ts                   RSI/布林/MA 信号逻辑
public/_headers                       Pages 缓存策略
docs/current-handoff.md               接手清单与短期待办
```
