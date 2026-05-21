# Codex 交接说明（2026-05-21）

本文件供 **Codex** 接手时快速对齐；产品全文见 `docs/product-redesign.md`，全局状态见 `docs/project-status.md`。

## 当前状态一句话

- **UI 框架**：`3b26d2e`（`configFramework` + Layout/Home/IndicesList/IndexDetail）。
- **交接文档**：`7070031`。
- **指数股息率 CSV**：Cursor 已跑 RedRocket 同步并提交进 `index_bars.csv`（见最新 `git log`）；H30269 详情页利差/股息率图与 CSV 一致。

配置逻辑集中在 `src/lib/configFramework.ts`，**请勿在页面里重复实现分类/利差/完整性判断**。

生产站 <https://newhl-dashboard.pages.dev/> 仍是旧构建，需 Pages 部署后才与本地一致。

## 指数股息率（已澄清，勿再当 P0 缺口）

| 指数 | `div_yield_nominal_pct` 非空行数 | 最新（2026-05-20） |
|------|----------------------------------|---------------------|
| H30269 | 649 / 4949 | 4.8674% |
| 000922 | 939 / 5191 | 5.0845% |
| 000015 | 1112 / 5191 | 5.0411% |
| 930955 | 2179 / 4949 | 5.1330% |

数据源：红色火箭 DID → `scripts/index_data_sync/sync_h30269_dividend_yield_redrocket.py`（脚本名含 H30269，实际更新 `REDROCKET_SECURITY_CODES` 内所有已入库指数）。

此前 UI 显示「缺股息率序列」是因为 **CSV 未灌入**，不是 H30269 无股息率。

## Cursor 已改动的 UI 文件（Codex 默认勿大改）

| 文件 | 状态 |
|------|------|
| `src/components/Layout.tsx` | 顶栏品牌、数据截至日、`dataFreshness` |
| `src/pages/Home.tsx` | 双维度首屏、候选指数、产品落地、对比折叠区 |
| `src/pages/IndicesListPage.tsx` | 一级维度 + 二级筛选 + 完整性标签 |
| `src/pages/IndexDetailPage.tsx` | 利差模块 + 加载中占位（避免误重定向） |
| `src/pages/Monitor.tsx` / `Registry.tsx` / `EtfDashboard.tsx` | 文案/导航等小改 |

## 配置层 helper（只读扩展，勿复制逻辑）

```ts
import { buildHomeDimensionSnapshots, CONFIG_DIMENSION_OPTIONS, filterIndicesByDimensionOption,
  indexStyleTags, indexDataAvailability, dataAvailabilityLabel, dataAvailabilityTone,
  groupEtfsForLanding, dividendAllocationObservation } from "../lib/configFramework";
```

口径约束：

- 利差模块：仅 `A股红利`、`港股红利`；现金流维度 v1 不输出配置窗口。
- 股息率：仅用 `index_bars` 中**显式**的 `div_yield_nominal_pct`；缺失日保持空，不做前向填充。

## Codex 建议任务清单（更新后）

| 优先级 | 任务 | 说明 |
|--------|------|------|
| P0 | GitHub Actions | 手动跑 `realtime-crawler.yml`、`index-t1-sync.yml`；**T-1 之后补跑** `sync_h30269_dividend_yield_redrocket.py` |
| P0 | workflow 顺序 | 避免仅提交 T-1 的 `index_bars` 把股息率列冲空；必要时改 workflow 串联两步 |
| P1 | 国际指数行情 | `SPCLLHCP.SPI`、`SPAHLVCP.SPI`、`FCFQCD` 历史仍缺 |
| P1 | workflow 失败通知 | 尚无 Actions 失败告警 |

~~P0 查 H30269 是否缺股息率~~ → **已由 Cursor 写入 CSV，Codex 只需维护 CI 顺序。**

## Codex 不要做（除非用户明确要求）

- 重复部署 Cloudflare Pages
- 重写 `Home.tsx` / `IndicesListPage.tsx` 整块 UI
- 在 UI 内联复制 `configFramework` 规则
- 把 `tsconfig.app.tsbuildinfo`、`workers/data-api/package-lock.json` 混入功能提交

## 本地验证命令

```bash
npm run build
npm run dev
python3 scripts/index_data_sync/sync_a_share_dividend_indices.py
python3 scripts/index_data_sync/sync_h30269_dividend_yield_redrocket.py
python3 scripts/realtime_crawler/sync_etf_realtime.py --skip-history --dry-run
```

## 给 Codex 的复制块（会话开头可贴）

```
分支：cursor/overview-monitor-registry-tickflow
请先读 docs/project-status.md、docs/codex-handoff-ui.md

已完成（Cursor）：
- UI 框架 3b26d2e + 交接 7070031
- index_bars.csv 已灌 RedRocket DID（H30269 等；观测日有值，非每日）
- IndexDetailPage 深链加载修复

请你做：
- GitHub Actions：realtime-crawler + index-t1-sync；T-1 后必须再跑 sync_h30269_dividend_yield_redrocket.py
- 不要把 T-1 整表提交冲掉 div_yield_nominal_pct

不要做：整块重做 UI、默认 wrangler pages deploy
```
