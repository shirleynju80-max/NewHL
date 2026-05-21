# 项目状态与交接

更新时间：2026-05-21（Cursor P0 验收后交接 Codex）  
当前主协作分支：`cursor/overview-monitor-registry-tickflow`  
最新提交：`3b26d2e` — `feat: ship value desk product framework and P0 UI verification`  
生产站：<https://newhl-dashboard.pages.dev/>（**仍为改版前构建**，见 P0 验收记录）

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

### 建议 Codex 接手（按优先级）

1. **GitHub Actions**：在仓库 Actions 页手动 `workflow_dispatch` 运行 `realtime-crawler.yml`、`index-t1-sync.yml`；确认 bot 能提交 `public/data/*.csv`（或记录失败日志）。
2. **数据与口径**：H30269 等指数股息率序列若仍显示「缺股息率序列」，检查 `sync_h30269_dividend_yield_redrocket.py` 与 `index_bars` 列；勿用前向填充。
3. **构建/文档**：`npm run build` 复验；按需更新 `docs/project-status.md` 中 P0 行状态。
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

# R2 / Worker，待 R2 开通后再执行
npm run r2:upload
npm run worker:deploy
```
