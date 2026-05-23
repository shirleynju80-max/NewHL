# Codex 交接说明（Cursor → Codex）

更新时间：**2026-05-21（第二轮 UI + 口径 + 盘中实时）**  
产品全文：`docs/product-redesign.md`  
全局状态：`docs/project-status.md`  
产品数据任务：`docs/etf-product-data-task.md`

---

## 0. 执行前必读

```bash
git status
git log -3 --oneline
```

**当前关键事实**：`main` 与 `origin/main` 同步，但工作区有 **大量未提交改动**（约 23 个已跟踪文件修改 + 多个新文件）。  
本地 `npm run build` 已通过；**生产站 https://newhl-dashboard.pages.dev/ 仍是旧构建**，未包含本轮改动。

| 未提交的影响 | 说明 |
|--------------|------|
| 仅本机可见 | `npm run dev` 跑的是新代码 |
| 远程/生产不可见 | 不 commit + push 则 Pages、他人、`git pull` 都是旧版 |
| 协作风险 | Codex 若只读 GitHub，会以为功能未做，可能重复改 UI |

**处理原则**（`docs/project-status.md` 亦有写）：

- 先 `git status`，区分 Cursor 工作区 vs 已 push 内容。
- **不要**顺手格式化或重写无关文件。
- **不要**把 `tsconfig.app.tsbuildinfo`、`workers/data-api/package-lock.json` 混入功能提交（除非用户明确要求）。

---

## 1. 本轮 Cursor 已完成（未提交汇总）

### 1.1 配置总览 / 产品落地 UI

| 项 | 说明 |
|----|------|
| 首页双卡 | `ConfigDeskOverview.tsx`：现金创造 + 股东回报；真实 `etf_products`、利差、长期表现（tri） |
| 样式 | 顶栏保留原 **蓝黑 `fin-header`**；内容区浅色 `fin-panel`（非纯黑 mock） |
| 产品表 | `EtfProductSections.tsx`：`IndexTrackingProductsTable`、`ProductLandingGroup` |
| 数据 | `src/lib/etfProducts.ts`；`DataSourceContext` 加载 `etf_products.csv` |
| 配置逻辑 | `configFramework.ts`：`buildCashCreationHomeOverview`、`buildCashCreationPerformanceLines`、`buildConfigDeskCandidates`、`INDEX_BASE_PUBLISH_FOOTNOTE` |

### 1.2 指数指标口径统一

| 页面 | 口径 |
|------|------|
| **指数研究列表** `IndicesListPage.tsx` | 仅用 **`tri_close` 全收益**；`buildIndexOverviewFromSeries`（与详情页同一套 `indexPanelMetrics`）；「主跟踪产品」列来自 `etf_products` 的 `is_primary` |
| **指数详情 · 指数比较** | 新增对比线固定 **全收益**（`indexSeriesForMode(..., "tri")`），图例带「全收益」 |
| **指数详情 · 默认曲线** | 仍同时显示 **价格指数 + 全收益 + 沪深300(tri)** |

`compareEtfs.buildSeriesOverviewRowFromNav` 仍按 **末尾固定交易日数**切片，**仅用于 ETF 对比总览**，指数列表勿再用。

### 1.3 ETF 成立年限 & 跟踪产品链接

| 文件 | 行为 |
|------|------|
| `src/lib/etfListingAge.ts` | `ETF_MIN_BACKTEST_YEARS = 2`；`etfBacktestEligible`；`etfDashboardHref` |
| 满 2 年 | 「策略执行」→ `?tab=backtest` |
| 未满 2 年 | 隐藏策略回测/信号台账页签；「策略执行」链到 `?tab=intraday` |
| 文案统一 | **策略执行** / **盘中信号**（顶栏原「盘中观察」→「盘中信号」） |

### 1.4 盘中信号 · 实时最新价

| 项 | 说明 |
|----|------|
| `src/lib/liveQuote.ts` | 取价顺序：东财 `/api/quote` → `VITE_QUOTE_*` 网关 bars → 本地 `bars+barsmore` |
| `workers/data-api/src/eastmoneyQuote.ts` | Worker 侧东财 quote |
| `workers/data-api/src/index.ts` | 新增 `GET /api/quote?code=` |
| `vite.config.ts` | 开发环境 `/api/quote` 中间件（同源代理东财） |
| `src/hooks/useLiveQuote.ts` | 单标的 60s 自动刷新 |
| `src/components/IntradayQuoteBar.tsx` | 最新价 + 刷新 + **页底更新时间/来源** |
| `EtfDashboard.tsx` | 去掉滑条/随机模拟价 |
| `Monitor.tsx` | 多标的自动拉价；标的池折叠+芯片化；表底统一更新时间 |

### 1.5 其它

- `Registry.tsx`：年轻 ETF 拦截网格回测（沿用 `etfListingAge`）
- `indexPanelMetrics.ts`：`buildIndexOverviewFromSeries`（指数列表专用）
- `Layout.tsx` / `index.css` / `tailwind.config.js`：金融终端风、IBM Plex

---

## 2. 新增 / 主要改动文件清单（供 Codex 检索）

**新增（`??`）**

```
src/components/ConfigDeskOverview.tsx
src/components/EtfProductSections.tsx
src/components/IntradayQuoteBar.tsx
src/hooks/useLiveQuote.ts
src/lib/etfListingAge.ts
src/lib/etfProducts.ts
src/lib/liveQuote.ts
workers/data-api/src/eastmoneyQuote.ts
scripts/generate_etf_products.mjs
scripts/verify_etf_products.mjs
docs/etf-product-data-task.md
```

**已修改（`M`，节选）**

```
src/pages/Home.tsx
src/pages/IndicesListPage.tsx
src/pages/IndexDetailPage.tsx
src/pages/EtfDashboard.tsx
src/pages/Monitor.tsx
src/pages/Registry.tsx
src/lib/configFramework.ts
src/lib/indexPanelMetrics.ts
src/lib/compareEtfs.ts
src/context/DataSourceContext.tsx
vite.config.ts
workers/data-api/src/index.ts
```

---

## 3. 数据与基础设施（Codex 主责，勿与 UI 混淆）

### 3.1 口径约束（全项目）

- **指数层**：长期收益/回撤/利差/分位 → `index_bars.csv`；**不做指数盘中实时**；基日回测 vs 发布日见 `INDEX_BASE_PUBLISH_FOOTNOTE`。
- **ETF 层**：盘中信号用 **ETF 最新价**（东财 quote 或 `barsmore` 定点）；策略回测用 ETF 日 K。
- **股息率**：仅 `div_yield_nominal_pct` **显式有值的日期**；**禁止前向填充**。
- **利差模块**：仅 `A股红利`、`港股红利` 指数类别。

### 3.2 ETF 行情链路（已有）

- Actions：`.github/workflows/realtime-crawler.yml`（工作日 11:00、14:00 北京时间）
- 脚本：`scripts/realtime_crawler/sync_etf_realtime.py`
- 写入：`public/data/barsmore.csv`（与 `bars.csv` 同 code+date 时 **barsmore 覆盖**）

### 3.3 指数 T-1 + 股息率（已有，注意顺序）

1. `scripts/index_data_sync/sync_a_share_dividend_indices.py` → `index_bars.csv` 等  
2. **之后必须**跑 `sync_h30269_dividend_yield_redrocket.py`，否则 T-1 整表重写可能 **冲掉** `div_yield_nominal_pct`

H30269 等已灌入时，详情页股息率约 **4.87%**（2026-05-20）与 CSV 一致。

### 3.4 ETF 产品表（v1 已有脚本，CSV 可能 gitignore）

- 生成：`node scripts/generate_etf_products.mjs`
- 校验：`node scripts/verify_etf_products.mjs`
- 输出：`public/data/etf_products.csv`（本地需存在，前端 `DataSourceContext` 会 fetch）
- Helper：`src/lib/etfProducts.ts` — `is_primary` 决定盘中默认产品

#### 3.4.1 Codex 交付给 Cursor：ETF 产品落地数据层（2026-05-22）

Codex 已完成数据层，不再改大 UI 页面：

| 交付物 | 文件 |
|--------|------|
| 产品落地 CSV | `public/data/etf_products.csv` |
| 生成脚本 | `scripts/generate_etf_products.mjs` |
| 校验脚本 | `scripts/verify_etf_products.mjs` |
| UI helper | `src/lib/etfProducts.ts` |
| API bundle 字段 | `src/api/dataBundle.ts`、`workers/data-api/src/index.ts` |
| 文档 | `docs/etf-product-data-task.md`、`docs/project-status.md`、`public/data/README.txt` |

数据口径：

- `etf_products.csv` 每行必须有 `index_code`，并能回连 `indices.csv`；无法回连时必须标 `data_status=needs_review`。
- `product_group` 固定为：`cash_creation`、`shareholder_return_cn`、`shareholder_return_hk`、`otc_fund`。
- 每个 `index_code` 只有一个 `is_primary=true`。
- `is_primary=true` 是盘中信号 / 策略执行默认产品，保持“指数 -> 监控 ETF”一对一。
- 同指数的非主产品只在产品落地模块作为参考，不进入盘中监控。
- v1 不填估算规模、管理费、托管费、成交额、折溢价、跟踪误差；这些字段保持空。

当前校验结果：

- `node scripts/verify_etf_products.mjs`：通过，`verified 22 ETF product rows`
- `npm run build`：通过
- `H30269 -> 512890` 主产品已验证
- `159201`、`159232`、`159399` 已归入 `cash_creation`

更新频率建议：

- 产品基础映射：随 `index_tracking_etfs.csv` 变化按需更新，建议每周或新增产品时重跑生成脚本。
- `first_trade_date` / `data_status`：随 `bars.csv`、`barsmore.csv`、`fund_bars.csv` 更新后重跑生成脚本；可跟随每日/盘中数据 workflow。
- 规模、费率、跟踪误差：来自基金公告、定期报告、招募说明书或基金公司披露，建议按月检查、按季报/半年报/年报正式更新。
- 后续应增加低频产品属性爬虫：周频检查新 ETF / 名称 / 管理人，月频刷新规模与费率，季频刷新跟踪误差；不要用盘中频率刷新这些慢变量。

Cursor 可用 helper：

```ts
import {
  groupEtfProductsForLanding,
  productsForIndex,
  primaryProductForIndex,
  productDataStatusLabel,
  productDataStatusTone,
} from "../lib/etfProducts";
```

UI 接入建议：

- 首页 / 产品落地：按 `groupEtfProductsForLanding(etfProducts)` 分组展示。
- 指数详情底部：用 `productsForIndex(etfProducts, indexCode)` 展示跟踪产品表。
- 表格里建议明确区分：
  - `主跟踪 / 盘中默认`：`isPrimary === true`
  - `参考产品`：`isPrimary === false`
- 盘中信号入口只给主产品；非主产品不要出现“盘中观察/策略执行”主 CTA，可只给产品页或备注“参考产品”。
- 若当前 UI 仍展示旧 `index_tracking_etfs.csv` 表，建议改为优先使用 `etf_products.csv`，因为它已经带有分组、数据状态、首交易日、主产品标记。

### 3.5 Worker / R2（代码就绪，R2 未开通）

- Bundle：`GET /api/bundle`（现有）
- **新增**：`GET /api/quote?code=510880` → 东财实时（本轮 Cursor 加）
- 部署：`npm run r2:upload`、`npm run worker:deploy`
- 前端：`VITE_DATA_API_BASE_URL` 指向 Worker 后，`liveQuote` 会走 `${base}/api/quote`

---

## 4. Codex 建议任务（按优先级）

| 优先级 | 任务 | 说明 |
|--------|------|------|
| **P0** | 确认未提交 diff | `git diff --stat`；与用户确认是否由 Cursor 提交或 Codex 分模块提交 |
| **P0** | GitHub Actions | 手动 `workflow_dispatch`：`realtime-crawler.yml`、`index-t1-sync.yml`；**T-1 后**再跑 `sync_h30269_dividend_yield_redrocket.py` |
| **P0** | workflow 串联 | 避免仅 T-1 提交导致股息率列全空；文档化到 workflow YAML |
| **P1** | `etf_products.csv` 进库策略 | 若 gitignore：文档写清生成步骤；若入库：CI 校验 `verify_etf_products.mjs` |
| **P1** | Worker 部署 | R2 开通后部署含 `/api/quote` 的 Worker；验证 `VITE_DATA_API_BASE_URL` |
| **P1** | 国际指数历史 | `FCFQCD`、`SPCLLHCP.SPI`、`SPAHLVCP.SPI` 等仍缺授权历史 |
| **P2** | 更新 `docs/project-status.md` | 合并本轮 UI/实时价/口径说明（当前文档部分仍写旧标题「红利 ETF 看板」） |
| **P2** | Actions 失败通知 | 尚无 workflow 失败告警 |

---

## 5. Codex 不要做（除非用户明确要求）

- 整块重写 `Home.tsx` / `ConfigDeskOverview` / `IndicesListPage`（除非发现明确 bug）
- 在页面内联复制 `configFramework` / `indexPanelMetrics` 规则
- 把指数列表改回 `compareEtfs` 的 1260 交易日窗口
- 把指数比较改回默认 `price_close`
- 恢复盘中「模拟价滑条」为主交互
- 默认执行 `wrangler pages deploy`（部署归用户/Cursor 明确要求时）
- 未读 `git status` 就覆盖 `public/data/*.csv`

---

## 6. 仍归 Cursor / 用户（非 Codex 默认）

- 浏览器走查与 UI 微调
- `git commit` / `push` 与 commit message 拆分策略
- Cloudflare Pages：`npm run build && npx wrangler pages deploy dist --project-name=newhl-dashboard`
- 生产站首屏 / 移动端验收

---

## 7. 本地验证命令

```bash
npm run build
npm run dev
# 打开 http://localhost:5173

# 指数口径：列表「近5年年化」应与详情页全收益线「近五年」列一致（如 H30269）

# 盘中实时（需网络）：ETF 页「盘中信号」应显示最新价 + 底部更新时间
# 开发环境走 Vite /api/quote；无网络时回退 barsmore 收盘

# 数据脚本
python3 scripts/realtime_crawler/sync_etf_realtime.py --skip-history --dry-run
python3 scripts/index_data_sync/sync_a_share_dividend_indices.py
python3 scripts/index_data_sync/sync_h30269_dividend_yield_redrocket.py
node scripts/verify_etf_products.mjs
```

---

## 8. 协作边界（简表）

| 负责方 | 范围 |
|--------|------|
| **Cursor** | 页面组件、样式、口径对齐、`liveQuote`、etfListingAge、浏览器验收 |
| **Codex** | CSV、爬虫、Actions、workflow 顺序、`etf_products` 生成/校验、Worker/R2、文档与 CI |

---

## 9. 给 Codex 的复制块（新会话开头粘贴）

```
请先读：docs/project-status.md、docs/codex-handoff-ui.md（本文件 2026-05-21 第二轮）

Git：main 与 origin 同步，但工作区有大量 Cursor 未提交改动；执行前务必 git status，勿覆盖未知文件。

Cursor 已完成（未提交，本地 build 通过）：
- 首页 ConfigDeskOverview + etf_products 产品落地
- 指数列表与详情指标统一为 tri 全收益（indexPanelMetrics）
- 指数比较默认全收益；跟踪产品链：策略执行 / 盘中信号；ETF<2年无回测
- 盘中信号：liveQuote 东财实时 + Worker /api/quote + vite 开发代理；去掉模拟滑条
- Monitor 标的池紧凑 + 多标的自动刷新行情

请你优先做（Codex）：
1. GitHub Actions：realtime-crawler + index-t1-sync；T-1 后必须再跑 sync_h30269_dividend_yield_redrocket.py
2. 确认 etf_products.csv 生成/入库策略与 verify 脚本
3. R2/Worker 开通后部署含 /api/quote 的 Worker
4. 与用户确认是否提交 Cursor 工作区 diff，勿擅自整块重做 UI

不要做：重做 Home/IndicesList、指数列表改回 compareEtfs 交易日窗口、默认 pages deploy
```

---

## 10. 与旧版交接的差异（避免混淆）

| 旧说明（`3b26d2e` / 第一轮） | 本轮追加 |
|-----------------------------|----------|
| 基础 configFramework + 列表/详情框架 | 首页 `ConfigDeskOverview`、etfProducts 接线 |
| 股息率 CSV 已灌 | 口径统一 + 实时价 + ETF 2 年门槛 |
| codex 复制块写 `cursor/overview-monitor-registry-tickflow` | 当前在 **main**，以 `git status` 为准 |

EOF
