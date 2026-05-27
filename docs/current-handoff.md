# Current Handoff

Updated: 2026-05-28

## 一句话

**价值底仓配置台** — Vite + React；数据来自 `public/data/*.csv`（可选 Worker `/api/bundle`）。指数 = 研究；ETF = 执行；策略 = 回测/监控（非投资建议）。

## 产品分层

| 层 | 页面 | 职责 |
|----|------|------|
| 配置 | 首页 | 现金创造 + 股东回报框架，短文案 |
| 研究 | 指数研究 / 指数详情 | 全收益、股息率、利差、主跟踪 ETF |
| 执行 | 产品选择 / ETF 详情 | 规模、费率、行情、分红复权 |
| 策略 | 策略研究 / 盘中监控 / **精选跟踪** | 登记参数、标尺、回测 |

## 近期已完成（本会话）

- **产品选择**：列宽优化；数据状态「行情已接入」；筛选文案统一
- **精选跟踪**（`/featured-tracking`）：指数矩阵可排序；标普指数 ETF 代理（`indexEtfProxy.ts`）+ 页脚注释；删除现金流策略区；红利策略按 ETF 分组展示
- **策略口径**：`etfProductStrategyEligible` — 现金流类 **不登记/不展示** 策略；成立 **未满 2 年** 不做详情页回测（提示置信度不足）
- **盘中监控**：仅 `etf_params.csv` + 主跟踪池；Top2 网格按全样本/验证集各取 1（`paramBacktest.ts`）
- **文档**：删除 `codex-handoff-ui.md`、`product-redesign.md`、`newhl-codex-skill.md`；保留 `docs/README.md` 索引

## 数据规则（必守）

- `div_yield_nominal_pct` **禁止**前向填充
- `index_bars.csv` = 指数层；`bars*.csv` = 产品层，勿混写
- 标普 `SPCLLHCP.SPI` / `SPAHLVCP.SPI` 无官方 TRI 时，前端用主跟踪 ETF 代理，**必须**脚注说明
- `etf_params.csv` 仅登记红利等可战术标的；**无** `cash_creation` 行
- `public/data/*.csv` 多数 gitignore，仅 `bars.csv` 等少量入库；改数后本地「重载」或重新部署

## 待办（建议顺序）

1. **P0** — `npm run build` 通过后部署 Pages；生产 UI / 移动端抽查（产品选择、精选跟踪、监控、513910 Registry Top2）
2. **P0** — GitHub Actions `workflow_dispatch`：realtime、index-t1、etf-products-monthly、etf-adjusted-bars
3. **P1** — R2 + Worker 联调（`npm run r2:upload`、`npm run worker:deploy`）
4. **P1** — 现金流 ETF 满 2 年后补 `etf_params` 并开放精选跟踪策略区
5. **P1** — 标普指数官方 TRI 或 licensed 历史；007751 与指数 TRI 跟踪差核实
6. **P2** — 成交额/折溢价/跟踪误差字段接入后启用流动性维度

## 接手命令

```bash
git status --short          # 勿盲目 reset
npm run dev                 # :5173
npm run build
node scripts/verify_param_top2.mjs 513910   # Top2 抽检
node scripts/verify_etf_products.mjs
```

## 文档索引

见 [docs/README.md](./README.md)。
