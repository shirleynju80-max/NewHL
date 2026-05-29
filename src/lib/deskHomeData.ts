import { buildIndexSpreadRows, indexSeriesForMode } from "../data/indexCsv";
import type { BondSeriesPoint, IndexDefinition } from "../types";
import type { EtfProductRecord } from "./etfProducts";
import { formatPct, formatSignedPct } from "./formatDisplay";
import {
  calcMetricBlock,
  sliceSeriesForWindow,
  type MetricBlock,
  type MetricWindowId,
} from "./indexPanelMetrics";
import {
  CONFIG_DIMENSIONS,
  OBSERVATION_POOL_INDEX_COLUMNS,
  type DimensionCardSnapshot,
} from "./configFramework";
import { resolveBondAnchorForIndex } from "./bondAnchor";

/** 配置总览现金流 vs 沪深300：近5年窗口，与指数研究页一致 */
export const CASH_BENCHMARK_FCF = "980092";
const CASH_BENCHMARK_HS300 = "000300";
/** 与 IndicesListPage 默认「近5年」、indexPanelMetrics.sliceSeriesForWindow 一致 */
export const CASH_BENCHMARK_WINDOW: MetricWindowId = "y5";
const CASH_BENCH_MIN_POINTS = 20;

export type CashBenchmarkMetricKind = "return" | "vol" | "drawdown";

export type CashBenchmarkMetricRow = {
  label: string;
  fcf: string;
  hs300: string;
  fcfBetter: boolean;
  kind: CashBenchmarkMetricKind;
  /** 用于对比条长度；波动行为绝对值 */
  fcfValue: number;
  hs300Value: number;
  showCompareBar: boolean;
};

export type CashBenchmarkComparison = {
  periodLabel: string;
  fcfColumnLabel: string;
  hs300ColumnLabel: string;
  metrics: CashBenchmarkMetricRow[];
  footnote: string;
};

export type DeskProductCard = {
  etfCode: string;
  name: string;
  desc: string;
  tags: { label: string; highlight?: boolean }[];
  indexCode: string;
};

export type CoreIndexCard = {
  code: string;
  name: string;
  subtitle: string;
  tags: string[];
  href: string;
};

function yearsSinceInception(inception?: string): number | null {
  if (!inception) return null;
  const t = new Date(`${inception}T00:00:00`).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (365.25 * 24 * 3600 * 1000);
}

function y5MetricBlock(def: IndexDefinition | undefined): MetricBlock | null {
  if (!def?.bars.length) return null;
  const tri = sliceSeriesForWindow(
    indexSeriesForMode(def.bars, "tri"),
    CASH_BENCHMARK_WINDOW,
  );
  if (tri.length < CASH_BENCH_MIN_POINTS) return null;
  return calcMetricBlock(tri);
}

function formatY5PeriodLabel(block: MetricBlock): string {
  if (block.startDate && block.endDate) {
    return `近5年（${block.startDate} → ${block.endDate}）`;
  }
  return "近5年";
}

export function buildCashBenchmarkComparison(
  indices: IndexDefinition[],
): CashBenchmarkComparison | null {
  const fcfDef = indices.find((d) => d.meta.index_code === CASH_BENCHMARK_FCF);
  const hsDef = indices.find((d) => d.meta.index_code === CASH_BENCHMARK_HS300);
  const fcf = y5MetricBlock(fcfDef);
  const hs = y5MetricBlock(hsDef);
  if (!fcf || !hs) return null;

  const periodLabel = formatY5PeriodLabel(fcf);
  const annEdge = (fcf.annualReturnPct ?? 0) - (hs.annualReturnPct ?? 0);
  const volEdge = (hs.annualVolPct ?? 0) - (fcf.annualVolPct ?? 0);
  const ddEdge =
    Math.abs(hs.maxDrawdownPct ?? 0) - Math.abs(fcf.maxDrawdownPct ?? 0);

  const fcfColumnLabel = fcfDef?.meta.name?.trim() || "国证自由现金流指数";

  return {
    periodLabel,
    fcfColumnLabel,
    hs300ColumnLabel: "沪深300",
    metrics: [
      {
        label: "年化收益",
        fcf: formatSignedPct(fcf.annualReturnPct),
        hs300: formatSignedPct(hs.annualReturnPct),
        fcfBetter: annEdge > 0,
        kind: "return",
        fcfValue: fcf.annualReturnPct ?? 0,
        hs300Value: hs.annualReturnPct ?? 0,
        showCompareBar: true,
      },
      {
        label: "年化波动",
        fcf: formatPct(fcf.annualVolPct),
        hs300: formatPct(hs.annualVolPct),
        fcfBetter: volEdge > 0,
        kind: "vol",
        fcfValue: fcf.annualVolPct ?? 0,
        hs300Value: hs.annualVolPct ?? 0,
        showCompareBar: false,
      },
      {
        label: "最大回撤",
        fcf: formatPct(fcf.maxDrawdownPct),
        hs300: formatPct(hs.maxDrawdownPct),
        fcfBetter: ddEdge > 0,
        kind: "drawdown",
        fcfValue: fcf.maxDrawdownPct ?? 0,
        hs300Value: hs.maxDrawdownPct ?? 0,
        showCompareBar: true,
      },
    ],
    footnote:
      "与指数研究「近5年」口径一致：自各指数最新交易日回溯约5个日历年，全收益序列；展示国证自由现金流指数数据。",
  };
}

export function buildDeskPerspective(
  shareholderCard: DimensionCardSnapshot,
  cashHasData: boolean,
): string {
  const parts: string[] = [];
  const bullet = shareholderCard.bullets[0];
  if (bullet) parts.push(bullet.replace(/。$/, ""));
  if (cashHasData) {
    parts.push("自由现金流指数适合作为长期质量底仓观察");
  }
  return parts.join("；") + (parts.length ? "。" : "数据加载后显示配置视角。");
}

/** 配置总览现金流示例产品（与示例 HTML 文案一致；ETF 代码以观察池主跟踪为准） */
const CASH_SHOWCASE_SPECS: {
  indexCode: string;
  fallbackName: string;
  fallbackEtf: string;
  desc: string;
  tags: { label: string; highlight?: boolean }[];
}[] = [
  {
    indexCode: "980092",
    fallbackName: "国证自由现金流ETF",
    fallbackEtf: "159201",
    desc: "跟踪国证指数 · 发布满5年 · 历史最长",
    tags: [{ label: "规模领先", highlight: true }, { label: "费率 0.15%" }],
  },
  {
    indexCode: "932365",
    fallbackName: "中证全指自由现金流ETF",
    fallbackEtf: "159232",
    desc: "全市场覆盖 · 均衡性较好",
    tags: [{ label: "覆盖面广" }, { label: "费率 0.15%" }],
  },
  {
    indexCode: "FCFQCD",
    fallbackName: "富时自由现金流ETF",
    fallbackEtf: "159399",
    desc: "富时编制 · 含成长因子",
    tags: [{ label: "风格补充" }, { label: "费率 0.15%" }],
  },
];

/** 配置总览红利示例产品（与示例 HTML 文案一致） */
const DIVIDEND_SHOWCASE_SPECS: {
  indexCode: string;
  fallbackName: string;
  fallbackEtf: string;
  desc: string;
  tags: { label: string; highlight?: boolean }[];
}[] = [
  {
    indexCode: "H30269",
    fallbackName: "中证红利低波动",
    fallbackEtf: "512890",
    desc: "低波动+高股息 · 防御性强",
    tags: [{ label: "低波动" }, { label: "规模超300亿", highlight: true }],
  },
  {
    indexCode: "000922",
    fallbackName: "中证红利",
    fallbackEtf: "515080",
    desc: "经典全市场红利策略",
    tags: [{ label: "长期稳健" }, { label: "费率 0.15%" }],
  },
  {
    indexCode: "HSI114",
    fallbackName: "恒生港股通高股息低波",
    fallbackEtf: "513630",
    desc: "港股红利低波 · QDII税收优势",
    tags: [{ label: "港股补充" }, { label: "低波红利" }],
  },
];

function resolvePrimaryProduct(
  products: EtfProductRecord[],
  indexCode: string,
): EtfProductRecord | undefined {
  return (
    products.find((p) => p.indexCode === indexCode && p.isPrimary) ??
    products.find((p) => p.indexCode === indexCode)
  );
}

export function buildCashProductCards(
  products: EtfProductRecord[],
): DeskProductCard[] {
  return CASH_SHOWCASE_SPECS.map((spec) => {
    const p = resolvePrimaryProduct(products, spec.indexCode);
    return {
      etfCode: p?.code ?? spec.fallbackEtf,
      name: p?.name ?? spec.fallbackName,
      desc: spec.desc,
      tags: spec.tags,
      indexCode: spec.indexCode,
    };
  });
}

export function buildDividendProductCards(
  products: EtfProductRecord[],
): DeskProductCard[] {
  return DIVIDEND_SHOWCASE_SPECS.map((spec) => {
    const p = resolvePrimaryProduct(products, spec.indexCode);
    return {
      etfCode: p?.code ?? spec.fallbackEtf,
      name: p?.name ?? spec.fallbackName,
      desc: spec.desc,
      tags: spec.tags,
      indexCode: spec.indexCode,
    };
  });
}

export function buildCoreIndexSections(
  indices: IndexDefinition[],
  products: EtfProductRecord[],
): { title: string; cards: CoreIndexCard[] }[] {
  const nameByCode = new Map(
    indices.map((d) => [d.meta.index_code, d.meta.name]),
  );
  const primaryByIndex = new Map<string, string>();
  for (const p of products) {
    if (p.isPrimary) primaryByIndex.set(p.indexCode, p.code);
  }

  return OBSERVATION_POOL_INDEX_COLUMNS.map((col) => ({
    title: col.title,
    cards: col.indices.map((ix) => {
      const fullName = nameByCode.get(ix.code) ?? ix.name;
      const years = yearsSinceInception(
        indices.find((d) => d.meta.index_code === ix.code)?.meta.inception_date,
      );
      const etf = primaryByIndex.get(ix.code);
      const subtitleParts = [ix.code];
      if (years != null && years >= 5) subtitleParts.push("发布满5年");
      const tags: string[] = [];
      if (etf) tags.push(`代表 ETF ${etf}`);
      if (col.title === "现金流") tags.push("质量底仓");
      if (col.title === "A股红利") tags.push("A股红利");
      if (col.title === "港股红利") tags.push("港股红利");
      return {
        code: ix.code,
        name: fullName,
        subtitle: subtitleParts.join(" · "),
        tags,
        href: `/indices/${encodeURIComponent(ix.code)}`,
      };
    }),
  }));
}

/** 利差历史分位 → 配置总览展示用语 */
export function spreadPercentileDeskLabel(pct: number | null): string | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct >= 80) return "（高性价比）";
  if (pct >= 60) return "（性价比较好）";
  if (pct >= 40) return "（中性）";
  if (pct >= 20) return "（性价偏低）";
  return "（性价偏低）";
}

function formatTradeDateLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

/** 股东回报利差区脚注：锚定指数名 + 数据截止交易日 */
export function buildDividendSpreadDeskNote(
  indices: IndexDefinition[],
  bondByDate: Record<string, BondSeriesPoint>,
): string {
  const anchor =
    indices.find((d) => d.meta.index_code === "H30269") ??
    indices.find((d) => d.meta.index_code === "000922");
  if (!anchor) {
    return "注：待红利指数与国债序列加载后显示数据口径。";
  }
  const rows = buildIndexSpreadRows(
    anchor,
    bondByDate,
    resolveBondAnchorForIndex(anchor),
  );
  const latestDate = rows.at(-1)?.date;
  const indexName = anchor.meta.name;
  if (!latestDate) {
    return `注：展示${indexName}数据，更新日期待确认。`;
  }
  return `注：展示${indexName}数据，更新时间 ${formatTradeDateLabel(latestDate)}。`;
}

export function spreadPercentileForDesk(
  indices: IndexDefinition[],
  bondByDate: Record<string, BondSeriesPoint>,
): number | null {
  const anchor =
    indices.find((d) => d.meta.index_code === "H30269") ??
    indices.find((d) => d.meta.index_code === "000922");
  if (!anchor) return null;
  const rows = buildIndexSpreadRows(
    anchor,
    bondByDate,
    resolveBondAnchorForIndex(anchor),
  );
  const spreads = rows
    .map((r) => r.spreadPct)
    .filter((v): v is number => Number.isFinite(v));
  if (spreads.length < 20) return null;
  const latest = spreads[spreads.length - 1]!;
  const below = spreads.filter((v) => v <= latest).length;
  return Math.round((below / spreads.length) * 100);
}

export { CONFIG_DIMENSIONS };
