# Codex 交接说明（2026-05-21，Cursor P0 后）

本文件供 **Codex** 接手时快速对齐；产品全文见 `docs/product-redesign.md`，全局状态见 `docs/project-status.md`。

## 当前状态一句话

价值底仓配置台 UI 框架已在分支 `cursor/overview-monitor-registry-tickflow` 提交 **`3b26d2e`** 落地；配置逻辑集中在 `src/lib/configFramework.ts`，**请勿在页面里重复实现分类/利差/完整性判断**。

生产站 <https://newhl-dashboard.pages.dev/> 仍是旧构建（HTML 标题「红利 ETF 看板」），需另行 Pages 部署后才与本地一致。

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
// 首页双卡片
import { buildHomeDimensionSnapshots, CONFIG_DIMENSIONS, siteDataIntegrityLine } from "../lib/configFramework";

// 指数研究筛选
import {
  CONFIG_DIMENSION_OPTIONS,
  filterIndicesByDimensionOption,
  indexStyleTags,
  indexDataAvailability,
  dataAvailabilityLabel,
  dataAvailabilityTone,
} from "../lib/configFramework";

// 产品落地分组
import { groupEtfsForLanding } from "../lib/configFramework";

// 红利配置观察（详情页 / 首页股东回报卡）
import { dividendAllocationObservation } from "../lib/configFramework";
```

口径约束：

- 利差模块：仅 `A股红利`、`港股红利` 指数展示；现金流维度 v1 **不**输出配置窗口。
- 股息率缺失：保持空，不做前向填充（见 `indexCsv.ts` 与 `IndexDetailPage` 占位文案）。

## Codex 建议任务清单

| 优先级 | 任务 | 说明 |
|--------|------|------|
| P0 | 验证 GitHub Actions | 手动运行 `realtime-crawler.yml`、`index-t1-sync.yml`；确认能 push CSV 变更 |
| P0 | 股息率 / H30269 数据 | 若 UI 仍标「缺股息率序列」，查红色火箭同步脚本与 `index_bars` |
| P1 | 国际指数行情 | `SPCLLHCP.SPI`、`SPAHLVCP.SPI`、`FCFQCD` 历史仍缺 |
| P1 | workflow 失败通知 | 尚无 Actions 失败告警 |

## Codex 不要做（除非用户明确要求）

- 重复部署 Cloudflare Pages（Cursor/用户负责）
- 重写 `Home.tsx` / `IndicesListPage.tsx` 整块 UI
- 在 UI 内联复制 `configFramework` 里的分类、利差、完整性规则
- 把 `tsconfig.app.tsbuildinfo`、`workers/data-api/package-lock.json` 混入功能提交

## 本地验证命令

```bash
npm run build
npm run dev
python3 scripts/realtime_crawler/sync_etf_realtime.py --skip-history --dry-run
python3 scripts/index_data_sync/sync_a_share_dividend_indices.py
python3 scripts/index_data_sync/sync_h30269_dividend_yield_redrocket.py
```

## 给 Codex 的复制块（会话开头可贴）

```
分支：cursor/overview-monitor-registry-tickflow，HEAD 3b26d2e。
请先读 docs/project-status.md 与 docs/codex-handoff-ui.md。
UI 框架（Layout/Home/IndicesList/IndexDetail + configFramework）已由 Cursor 完成并本地验收；你的重点是 GitHub Actions 跑通、指数/ETF CSV 口径与 H30269 股息率，不要重做整块 UI。
生产站尚未部署本次改版；不要默认 wrangler pages deploy。
```
