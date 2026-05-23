# 项目状态与交接

更新时间：2026-05-22（新版已合并 `main`）  
当前默认分支：`main`（已合并 `cursor/overview-monitor-registry-tickflow` + `origin/main` TickFlow 历史）  
最新提交：见 `git log -1` on `main`  
生产站：<https://newhl-dashboard.pages.dev/>（若 Cloudflare 绑 `main` 自动构建，合并 push 后可能更新为「价值底仓配置台」）

## 当前结论

项目已经从“原型和补数”进入“生产化收口”阶段。前端站点已可访问，静态 CSV 数据链路可用；Worker API 与 R2 已写好代码，但因 R2 尚未开通，生产站当前仍以静态 `public/data/*.csv` 为主要数据源。前端已支持“优先 API、失败回退静态 CSV”，所以 R2 开通前不应阻塞 Pages 部署。

## 已完成

- 前端主页面已打通：ETF 总览、指数汇总、指数详情、ETF 详情、盘中信号、策略回测与注册。
- 生产站已部署到 Cloudflare Pages：`https://newhl-dashboard.pages.dev/`。
- DataSource 加载顺序已明确：
  - 若配置 `VITE_DATA_API_BASE_URL`，优先请求 Worker `/api/bundle`。
  - Worker/R2 不可用时，自动回退 `public/data/*.csv`。
  - 本地开发默认读取 `public/data/*.csv`。
- ETF 主数据链路已切到实时爬虫：
  - GitHub Actions：`.github/workflows/realtime-crawler.yml`
  - 定时：北京时间工作日 11:00、14:00
  - 写入：`public/data/barsmore.csv`
- 指数主数据链路为 T-1：
  - GitHub Actions：`.github/workflows/index-t1-sync.yml`
  - 写入：`public/data/index_bars.csv`、`indices.csv`、`index_tracking_etfs.csv`
- TickFlow workflow 已停用：
  - `.github/workflows/tickflow-sync.yml` 已删除。
  - `scripts/tickflow_sync/` 仅保留为备用数据源，不再作为默认 CI。
- Cloudflare Worker API 代码已存在：
  - Worker：`workers/data-api/`
  - 前端 API client：`src/api/dataBundle.ts`
  - 上传脚本：`npm run r2:upload`
  - Worker 部署脚本：`npm run worker:deploy`

## 当前数据口径

- ETF 盘中数据：用东方财富 quote，失败时用新浪 quote 兜底；场外基金代码跳过实时 quote。
- ETF 产品落地：`public/data/etf_products.csv` 是产品落地数据底表；盘中信号只使用每个指数 `is_primary=true` 的默认产品，非主产品仅用于产品落地参考。
- ETF 历史补缺：手动运行 `python scripts/realtime_crawler/sync_etf_realtime.py` 可补历史并校验今年以来重合日期一致性。
- 指数价格/全收益：官方 T-1 或盘后数据为准，不做盘中实时。
- 指数实时：暂不接入。沪深300、上证红利等少数交易所主指数可从新浪 quote 获取，但 H30269 等策略指数没有稳定可验证实时 quote；不要用 ETF proxy 冒充指数实时值。
- 股息率：指数 DID 主要来自红色火箭；缺失日期保持为空，不做前向填充。

## P0 验收记录（2026-05-21）

| 项 | 结果 |
|----|------|
| UI 框架自测（本地 `npm run build` + `npm run dev`） | 通过：首页双维度卡片、指数研究一级/二级筛选与数据完整性标签、指数列表→详情→ETF 跳转；修复详情页在 CSV 加载完成前误重定向；控制台无数据加载错误。 |
| 生产站静态 CSV（curl） | 通过：`/` 与 `/data/indices.csv` 均 HTTP 200；**尚未部署**本次 UI 改版（生产 HTML 标题仍为「红利 ETF 看板」）。 |
| 同步脚本本地烟测 | ETF `sync_etf_realtime.py --dry-run` 通过（25 quote）；指数 `sync_a_share_dividend_indices.py` 可跑通。 |
| 指数股息率 CSV | **已写入** `index_bars.csv`：`sync_h30269_dividend_yield_redrocket.py` 已跑；H30269 649 个观测日有 `div_yield_nominal_pct`（最新 2026-05-20 → 4.8674%），与详情页利差图一致。 |
| GitHub Actions `workflow_dispatch` | **未执行**：本机无 `gh` / `GITHUB_TOKEN`；需在 GitHub Actions 页手动触发或安装 `gh` 后 `gh workflow run`。 |

## 待完成

| 优先级 | 事项 | 状态 / 说明 |
|--------|------|-------------|
| P0 | 生产站 UI 设计评审 | 本地已验收；部署 Pages 后复查生产站首屏与移动端。 |
| P0 | 数据加载验收 | 本地静态 CSV 通过；R2 开通后验证 Worker `/api/bundle`。 |
| P0 | GitHub Actions 验证 | 本地脚本烟测通过；需在 GitHub 手动 `workflow_dispatch` 两条 workflow。 |
| P1 | R2 / Worker 上线 | 用户绑卡开通 R2 后执行 `npm run r2:upload` 与 `npm run worker:deploy`。 |
| P1 | 告警与失败可见性 | 数据 workflow 失败时目前没有通知机制。 |
| P1 | 国际指数历史行情 | `SPCLLHCP.SPI`、`SPAHLVCP.SPI`、`FCFQCD` 仍缺可靠授权历史行情。 |

## ETF 产品数据层（2026-05-22）

- 已新增 `public/data/etf_products.csv`，字段覆盖产品代码、名称、产品分组、跟踪指数、交易所、管理人、首交易日、主产品标记、数据状态和备注。
- 已新增生成脚本 `scripts/generate_etf_products.mjs`，从 `index_tracking_etfs.csv` 出发，合并 `etfs.csv`、`etfsmore.csv`、`bars.csv`、`barsmore.csv`、`fund_bars.csv` 和 `indices.csv`。
- 已新增月更脚本 `scripts/sync_etf_products_monthly.mjs`，从天天基金 F10 补充规模、管理费、托管费、综合费率、来源链接和更新时间；当前本地运行覆盖 22 行产品中的 21 行 ETF，场外基金不自动补 F10。
- 已新增 helper `src/lib/etfProducts.ts`，提供 `parseEtfProductsCsv`、`groupEtfProductsForLanding`、`getProductsForIndex`、`getPrimaryProductForIndex`、`etfProductDataStatusLabel`。
- 已新增校验脚本 `scripts/verify_etf_products.mjs`：校验每行可回连 `indices.csv`，每个指数只有一个主产品，且 `H30269 -> 512890`、`159201/159232/159399 -> cash_creation`。
- 已新增 GitHub Actions `.github/workflows/etf-products-monthly.yml`，支持手动 `workflow_dispatch`，并默认每月 5 日北京时间 09:20 刷新 `etf_products.csv`。
- 产品选择口径：同指数多个 ETF 时，只保留少量已核验候选；`is_primary=true` 是盘中监控默认产品，其余只作为产品落地参考，降低盘中信号冗余。
- 更新频率：产品基础映射按需/每周更新；首交易日和数据状态随行情 CSV 更新后重跑生成脚本；规模、管理费、托管费、综合费率按月更新；成交额、折溢价、实际跟踪误差仍待单独数据源，不估算。
- 后续需要补充候选发现机制：搜索接口只生成 `needs_review` 候选，不自动加入产品池；盘中监控仍只使用 `is_primary=true` 的默认 ETF。

## Cursor / Codex 协作边界

为减少重复工作，默认按下面边界协作：

- Cursor 优先负责：
  - 大块 UI 重构、样式细节、浏览器内可视化验收。
  - Cloudflare Pages 手动部署。
  - Worker/R2 开通后的配置落地。
- Codex 优先负责：
  - 数据脚本、CSV 口径、workflow、文档与交接。
  - 小范围 P0 修复、构建验证、风险梳理。
  - 对 Cursor 已部署/已改内容做状态确认，不重复部署，除非用户明确要求。

执行前先看本文件和 `git status`。如果发现已有未提交文件，先判断是否来自另一方工作；不要顺手格式化或重写无关文件。

## 产品框架改版交接（Cursor → Codex）

产品框架唯一依据：`docs/product-redesign.md`。UI 接入示例：`docs/codex-handoff-ui.md`。

### 指数 / ETF 分工口径（2026-05-21 追加）

- 指数负责研究判断：编制逻辑、长期收益风险、股息率、利差、分位和配置参考。
- ETF 负责产品落地：跟踪指数、成立时间、费率、规模、流动性、折溢价、跟踪误差和盘中执行状态。
- 策略研究默认用指数长历史做规则验证；ETF 回测只做产品执行复核。
- 盘中观察用 ETF 盘中价格做执行监控，把指数回测得到的参数映射到可交易产品。
- 产品落地字段与数据补全任务见 `docs/etf-product-data-task.md`。

### Cursor 已在 `3b26d2e` 完成

| 范围 | 文件 / 说明 |
|------|-------------|
| 配置层 helper | `src/lib/configFramework.ts`、`src/lib/dataFreshness.ts` |
| 顶栏与品牌 | `src/components/Layout.tsx`、`index.html`（站点名「价值底仓配置台」） |
| 配置总览 | `src/pages/Home.tsx` — 双维度卡片、`groupEtfsForLanding`、对比区 |
| 指数研究 | `src/pages/IndicesListPage.tsx` — 一级维度 tab、风格/成立期筛选、完整性标签 |
| 指数详情 | `src/pages/IndexDetailPage.tsx` — `dividendAllocationObservation`；**修复** CSV 未就绪时误 `Navigate` 到列表 |
| 其它页面小改 | `Monitor.tsx`、`Registry.tsx`、`EtfDashboard.tsx` |
| 利差 CSV 口径 | `src/data/indexCsv.ts` — 仅 `A股红利` / `港股红利` 展示利差模块 |
| 指数数据 | `public/data/index_bars.csv`、`indices.csv`、`index_tracking_etfs.csv` 与同步脚本 |
| 文档 | `docs/product-redesign.md`、`docs/codex-handoff-ui.md` |

本地 `npm run build` 与浏览器走查已通过（见「P0 验收记录」）。**未**执行 Pages 部署、**未**在 GitHub 触发 workflow。

### Cursor 追加（股息率 CSV，待提交）

- 已运行 `python3 scripts/index_data_sync/sync_h30269_dividend_yield_redrocket.py`，更新 `public/data/index_bars.csv`。
- **口径**：红色火箭 DID 按观测日写入 `div_yield_nominal_pct` / `div_yield_redrocket_did_pct`；非观测日保持空，**禁止前向填充**。
- **H30269**：649/4949 行有股息率；`2026-05-20` = 4.8674%（UI 显示约 4.87%）。
- **注意**：`index-t1-sync` 若整表重写 `index_bars` 且不带股息率列，会冲掉本次写入；CI 应 **先 T-1 行情、再 RedRocket**，或 T-1 脚本只改 `tri_close`/`price_close`。

### 建议 Codex 接手（按优先级）

1. **GitHub Actions**：手动 `workflow_dispatch` `realtime-crawler.yml`、`index-t1-sync.yml`；**`index-t1-sync` 跑完后务必再跑** `sync_h30269_dividend_yield_redrocket.py`（或把两步串进同一 workflow）。
2. **workflow 顺序**：确认定时任务不会只用 T-1 脚本提交 `index_bars` 而导致股息率列再次全空。
3. **构建/文档**：`npm run build` 复验；确认列表页 H30269 标签为「数据可用」而非「缺股息率序列」。
4. **勿重复**：不要重写 `configFramework` 或整块重做 `Home` / `IndicesListPage`，除非发现明确 bug。

### 仍归 Cursor / 用户（非 Codex 默认）

- Cloudflare Pages 部署：`npm run build && npx wrangler pages deploy dist --project-name=newhl-dashboard`
- 生产站 UI/移动端复查
- R2 绑卡后的 `npm run r2:upload`、`npm run worker:deploy`

## 当前本地注意事项

最近一次检查时存在两个非当前文档任务产生的本地未提交文件：

- `tsconfig.app.tsbuildinfo`
- `workers/data-api/package-lock.json`

处理原则：除非用户确认，否则不要把它们混进 UI 或文档提交里。

## 常用命令

```bash
# 本地开发
npm run dev

# 构建
npm run build

# 手动部署 Pages（Cursor 已跑过；非必要不重复）
npx wrangler pages deploy dist --project-name=newhl-dashboard

# ETF 实时爬虫 dry-run
python3 scripts/realtime_crawler/sync_etf_realtime.py --skip-history --dry-run

# ETF 历史补缺 + 今年以来一致性校验
python3 scripts/realtime_crawler/sync_etf_realtime.py

# 指数 T-1 同步
python3 scripts/index_data_sync/sync_a_share_dividend_indices.py
python3 scripts/index_data_sync/sync_h30269_dividend_yield_redrocket.py

# ETF 产品属性月更
node scripts/sync_etf_products_monthly.mjs
node scripts/verify_etf_products.mjs

# R2 / Worker，待 R2 开通后再执行
npm run r2:upload
npm run worker:deploy
```
