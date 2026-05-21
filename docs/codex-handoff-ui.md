# Cursor UI 接入说明（配置层 helper 已就绪）

`src/lib/configFramework.ts` 提供首页/指数研究所需的配置层口径，**请勿在 UI 里重复实现分类与利差配置逻辑**。

本文件只说明 UI 如何接入 helper；页面结构仍以 `docs/product-redesign.md` 为准。

## 快速用法（Home 首屏双卡片）

```ts
import { buildHomeDimensionSnapshots, CONFIG_DIMENSIONS, siteDataIntegrityLine } from "../lib/configFramework";

const { indices, bondByDate, indexTracking, definitions } = useDataSource();
const cards = buildHomeDimensionSnapshots({ indices, bondByDate, indexTracking });

// cards.cash_creation — 现金创造卡文案与代表指数
// cards.shareholder_return — 股东回报卡（含利差配置观察）
// card.stats — 可直接渲染为卡片核心数字
// card.integrity.label — 数据完整性摘要
// CONFIG_DIMENSIONS.cash_creation.frameworkBlurb — 框架说明
// siteDataIntegrityLine(indices, definitions) — 顶栏或首屏数据完整性一行
```

## 指数研究页筛选

```ts
import {
  CONFIG_DIMENSION_OPTIONS,
  filterIndicesByDimensionOption,
  filterIndicesByDimension,
  indexStyleTags,
  indexDataAvailability,
  dataAvailabilityLabel,
  dataAvailabilityTone,
} from "../lib/configFramework";

// 一级 tab：CONFIG_DIMENSION_OPTIONS
// 一级筛选：filterIndicesByDimensionOption(indices, "all" | "cash_creation" | "shareholder_return")
// 兼容旧用法：filterIndicesByDimension(indices, "cash_creation" | "shareholder_return")
// 二级：indexStyleTags(meta) 含 A股/港股/低波/质量/央企/自由现金流
// 列表列：dataAvailabilityLabel(indexDataAvailability(def))
// 标签色：dataAvailabilityTone(indexDataAvailability(def))
```

## 产品落地分组

```ts
import { groupEtfsForLanding } from "../lib/configFramework";

const { cash, cn, hk, other } = groupEtfsForLanding(definitions);
```

## 文件边界

- Cursor 改：`Layout.tsx`、`Home.tsx`、`IndicesListPage.tsx`
- 已提供 helper：`configFramework.ts`（本批）
- 利差观察与 `IndexDetailPage` 已统一为 `dividendAllocationObservation`
- 利差模块口径：只对 `A股红利` / `港股红利` 展示；现金流维度 v1 不输出配置窗口

产品全文：`docs/product-redesign.md`
