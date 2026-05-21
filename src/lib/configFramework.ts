/**
 * 价值底仓配置台：配置层口径（现金创造 / 股东回报）
 * 产品说明见 docs/product-redesign.md
 */
import { buildIndexSpreadRows } from "../data/indexCsv";
import { indexSeriesForMode, type IndexValueMode } from "../data/indexCsv";
import type { BondSeriesPoint, EtfDefinition, EtfMeta, IndexCategory, IndexDefinition, IndexMeta, IndexTrackingRow } from "../types";
import { buildMetricRow } from "./indexPanelMetrics";

export type ConfigDimensionId = "cash_creation" | "shareholder_return";
export type ConfigDimensionFilter = "all" | ConfigDimensionId;

export type EtfLandingGroupId =
  | "cash_creation"
  | "shareholder_return_cn"
  | "shareholder_return_hk"
  | "other";

export type DataAvailability = "ok" | "no_bars" | "sparse" | "missing_div_yield";

export type AllocationZoneId = "window" | "neutral" | "caution" | "insufficient";

export const CONFIG_DIMENSIONS: Record<
  ConfigDimensionId,
  { title: string; subtitle: string; frameworkBlurb: string }
> = {
  cash_creation: {
    title: "现金创造",
    subtitle: "自由现金流指数",
    frameworkBlurb:
      "观察企业主营业务产生现金的能力，适合作为长期质量底仓入口。v1 展示历史表现与数据完整性，不作估值时机判断。",
  },
  shareholder_return: {
    title: "股东回报",
    subtitle: "红利指数",
    frameworkBlurb:
      "观察企业以分红等方式回报股东的行为。股息率相对国债利差可作为红利资产性价比参考。",
  },
};

export const CONFIG_DIMENSION_OPTIONS: { id: ConfigDimensionId; title: string; subtitle: string }[] = [
  { id: "cash_creation", title: CONFIG_DIMENSIONS.cash_creation.title, subtitle: CONFIG_DIMENSIONS.cash_creation.subtitle },
  { id: "shareholder_return", title: CONFIG_DIMENSIONS.shareholder_return.title, subtitle: CONFIG_DIMENSIONS.shareholder_return.subtitle },
];

export const ETF_LANDING_GROUPS: Record<
  EtfLandingGroupId,
  { title: string; subtitle: string; emptyText: string }
> = {
  cash_creation: {
    title: "现金创造类 ETF",
    subtitle: "跟踪自由现金流相关指数，作为质量底仓候选观察。",
    emptyText: "暂无现金创造类产品。",
  },
  shareholder_return_cn: {
    title: "股东回报类 ETF：A 股红利",
    subtitle: "跟踪 A 股红利、低波、质量、央企等股东回报维度指数。",
    emptyText: "暂无 A 股红利产品。",
  },
  shareholder_return_hk: {
    title: "股东回报类 ETF：港股红利",
    subtitle: "跟踪港股通红利、低波、高股息、央企红利等指数。",
    emptyText: "暂无港股红利产品。",
  },
  other: {
    title: "其他产品",
    subtitle: "尚未归入现金创造或股东回报主线的产品。",
    emptyText: "暂无其他产品。",
  },
};

/** 配置层代表指数（用于首页卡片与完整性统计） */
export const REPRESENTATIVE_INDEX_CODES: Record<ConfigDimensionId, string[]> = {
  cash_creation: ["932365", "980092", "FCFQCD"],
  shareholder_return: ["H30269", "000922", "000015"],
};

const MIN_BARS_OK = 60;
const MIN_BARS_SPARSE = 20;

export function indexToConfigDimension(category: IndexCategory): ConfigDimensionId | null {
  if (category === "现金流") return "cash_creation";
  if (category === "A股红利" || category === "港股红利") return "shareholder_return";
  return null;
}

export function etfToLandingGroup(meta: EtfMeta): EtfLandingGroupId {
  if (meta.product_kind === "现金流类") return "cash_creation";
  if (meta.dividend_market_scope === "A股红利") return "shareholder_return_cn";
  if (meta.dividend_market_scope === "港股红利") return "shareholder_return_hk";
  return "other";
}

/** 二级风格标签（指数研究筛选，启发式） */
export function indexStyleTags(meta: IndexMeta): string[] {
  const tags = new Set<string>();
  const text = `${meta.name} ${meta.index_code}`;
  if (meta.category === "现金流" || /自由现金流|现金流/.test(text)) tags.add("自由现金流");
  if (/低波|低波动/.test(text)) tags.add("低波");
  if (/质量/.test(text)) tags.add("质量");
  if (/央企|国企/.test(text)) tags.add("央企");
  if (meta.category === "A股红利" || meta.category === "港股红利") {
    if (!tags.has("自由现金流")) tags.add("红利");
  }
  if (meta.market === "H") tags.add("港股");
  else if (meta.market === "A") tags.add("A股");
  return [...tags];
}

export function indexDataAvailability(def: IndexDefinition): DataAvailability {
  const n = def.bars.length;
  if (n < MIN_BARS_SPARSE) return "no_bars";
  if (n < MIN_BARS_OK) return "sparse";
  const dim = indexToConfigDimension(def.meta.category);
  if (dim === "shareholder_return") {
    const hasDiv = def.bars.some((b) => typeof b.div_yield_nominal_pct === "number" && !Number.isNaN(b.div_yield_nominal_pct));
    if (!hasDiv && def.meta.fallback_div_yield_pct == null) return "missing_div_yield";
  }
  return "ok";
}

export function etfDataAvailability(def: EtfDefinition): DataAvailability {
  const n = def.bars.length;
  if (n < MIN_BARS_SPARSE) return "no_bars";
  if (n < MIN_BARS_OK) return "sparse";
  return "ok";
}

export function dataAvailabilityLabel(status: DataAvailability): string {
  switch (status) {
    case "ok":
      return "数据可用";
    case "sparse":
      return "样本偏短";
    case "no_bars":
      return "暂无行情";
    case "missing_div_yield":
      return "缺股息率序列";
    default:
      return "—";
  }
}

export function dataAvailabilityTone(status: DataAvailability): "good" | "warn" | "muted" {
  if (status === "ok") return "good";
  if (status === "sparse" || status === "missing_div_yield") return "warn";
  return "muted";
}

/** 股东回报：利差配置观察（与 IndexDetailPage 原逻辑一致，供全站复用） */
export function dividendAllocationObservation(
  spread: number | null | undefined,
  divYield: number | null | undefined
): { zone: AllocationZoneId; title: string; tone: string; body: string } {
  const hasDivYield = typeof divYield === "number" && Number.isFinite(divYield);
  if (typeof spread !== "number" || !Number.isFinite(spread)) {
    return {
      zone: "insufficient",
      title: "数据不足",
      tone: "border-zinc-200 bg-zinc-50 text-zinc-700",
      body: "当前缺少可对齐的股息率或国债收益率。",
    };
  }
  if (spread >= 2.5 || (hasDivYield && divYield >= 5.5 && spread >= 1.5)) {
    return {
      zone: "window",
      title: "配置窗口",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
      body:
        spread >= 2.5
          ? "红利相对债券的收益补偿较高，可作为提高关注度的配置参考。"
          : "股息率较高且相对债券仍有一定收益补偿，可作为配置参考。",
    };
  }
  if (spread < 1) {
    if (hasDivYield && divYield >= 5) {
      return {
        zone: "caution",
        title: "警惕（利差偏低）",
        tone: "border-amber-200 bg-amber-50 text-amber-900",
        body: "股息率仍有吸引力，但相对债券的收益补偿不足，适合谨慎观察。",
      };
    }
    return {
      zone: "caution",
      title: "警惕区",
      tone: "border-zinc-200 bg-zinc-50 text-zinc-700",
      body: "红利相对债券的收益补偿较低，配置性价比参考意义偏弱。",
    };
  }
  return {
    zone: "neutral",
    title: "中性观察",
    tone: "border-amber-200 bg-amber-50 text-amber-900",
    body: "配置吸引力不极端，更适合结合价格趋势与仓位继续观察。",
  };
}

export type DimensionIntegritySlice = {
  dimension: ConfigDimensionId;
  representativeTotal: number;
  withBars: number;
  label: string;
};

export function summarizeDimensionIntegrity(
  indices: IndexDefinition[],
  dimension: ConfigDimensionId
): DimensionIntegritySlice {
  const codes = REPRESENTATIVE_INDEX_CODES[dimension];
  const reps = codes
    .map((c) => indices.find((d) => d.meta.index_code === c))
    .filter((x): x is IndexDefinition => Boolean(x));
  const withBars = reps.filter((d) => indexDataAvailability(d) === "ok" || indexDataAvailability(d) === "sparse").length;
  return {
    dimension,
    representativeTotal: codes.length,
    withBars,
    label: `${withBars}/${codes.length} 代表指数有行情`,
  };
}

export type DimensionCardSnapshot = {
  dimension: ConfigDimensionId;
  statusTitle: string;
  statusSubtitle: string;
  tone: "good" | "warn" | "neutral";
  stats: { label: string; value: string; note?: string }[];
  bullets: string[];
  integrity: DimensionIntegritySlice;
  highlightIndices: { code: string; name: string; note: string }[];
};

function indexY5Metrics(def: IndexDefinition, mode: IndexValueMode = "tri") {
  const series = indexSeriesForMode(def.bars, mode);
  const row = buildMetricRow(def.meta.index_code, def.meta.name, series);
  return row.windows.y5;
}

function latestSpreadForIndex(def: IndexDefinition, bondByDate: Record<string, BondSeriesPoint>) {
  const rows = buildIndexSpreadRows(def, bondByDate);
  return rows.length ? rows[rows.length - 1]! : null;
}

function spreadPercentileForIndex(def: IndexDefinition, bondByDate: Record<string, BondSeriesPoint>): number | null {
  const rows = buildIndexSpreadRows(def, bondByDate);
  if (!rows.length) return null;
  const latest = rows[rows.length - 1]!.spreadPct;
  const sorted = rows.map((r) => r.spreadPct).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const le = sorted.filter((v) => v <= latest).length;
  return Math.round((le / sorted.length) * 100);
}

function primaryTrackingLabel(code: string, tracking: IndexTrackingRow[]): string {
  const row = tracking.find((t) => t.index_code === code);
  if (!row?.etf_code) return "—";
  return row.note ? `${row.etf_code}（${row.note}）` : row.etf_code;
}

export function buildCashCreationCardSnapshot(
  indices: IndexDefinition[],
  tracking: IndexTrackingRow[]
): DimensionCardSnapshot {
  const integrity = summarizeDimensionIntegrity(indices, "cash_creation");
  const highlights = REPRESENTATIVE_INDEX_CODES.cash_creation.map((code) => {
    const def = indices.find((d) => d.meta.index_code === code);
    if (!def) return { code, name: code, note: "未入库" };
    const y5 = indexY5Metrics(def);
    const y5Ann = y5?.annualReturnPct;
    const dd = y5?.maxDrawdownPct;
    const avail = dataAvailabilityLabel(indexDataAvailability(def));
    const parts = [avail];
    if (y5Ann != null) parts.push(`近5年年化 ${y5Ann}%`);
    if (dd != null) parts.push(`回撤 ${dd}%`);
    parts.push(`主跟踪 ${primaryTrackingLabel(code, tracking)}`);
    return { code, name: def.meta.name, note: parts.join(" · ") };
  });

  return {
    dimension: "cash_creation",
    statusTitle: "质量底仓候选",
    statusSubtitle: "先看长期表现与数据完整性",
    tone: integrity.withBars >= 2 ? "good" : "neutral",
    stats: [
      { label: "代表指数行情", value: integrity.label },
      { label: "配置判断", value: "暂不输出", note: "v1 不使用 FCF Yield 或估值分位" },
    ],
    bullets: [
      "关注自由现金流指数的长期收益与回撤，不输出择时买卖点。",
      "富时等部分指数行情仍在补齐，见数据完整性提示。",
    ],
    integrity,
    highlightIndices: highlights,
  };
}

export function buildShareholderReturnCardSnapshot(
  indices: IndexDefinition[],
  bondByDate: Record<string, BondSeriesPoint>,
  tracking: IndexTrackingRow[]
): DimensionCardSnapshot {
  const integrity = summarizeDimensionIntegrity(indices, "shareholder_return");
  const anchor =
    indices.find((d) => d.meta.index_code === "H30269") ??
    indices.find((d) => d.meta.index_code === "000922") ??
    indices.find((d) => d.meta.category === "A股红利" && d.bars.length > 0);
  const latest = anchor ? latestSpreadForIndex(anchor, bondByDate) : null;
  const percentile = anchor ? spreadPercentileForIndex(anchor, bondByDate) : null;
  const obs = dividendAllocationObservation(latest?.spreadPct, latest?.divYieldPct);

  const highlights = REPRESENTATIVE_INDEX_CODES.shareholder_return.slice(0, 3).map((code) => {
    const def = indices.find((d) => d.meta.index_code === code);
    if (!def) return { code, name: code, note: "未入库" };
    const sp = latestSpreadForIndex(def, bondByDate);
    const parts = [dataAvailabilityLabel(indexDataAvailability(def))];
    if (sp) parts.push(`利差 ${sp.spreadPct}%`);
    parts.push(`主跟踪 ${primaryTrackingLabel(code, tracking)}`);
    return { code, name: def.meta.name, note: parts.join(" · ") };
  });

  return {
    dimension: "shareholder_return",
    statusTitle: obs.title,
    statusSubtitle: latest
      ? `参考 ${anchor?.meta.name ?? "红利指数"} · 股息 ${latest.divYieldPct}% · 利差 ${latest.spreadPct}%`
      : "待补齐股息率与国债序列",
    tone: obs.zone === "window" ? "good" : obs.zone === "caution" ? "warn" : "neutral",
    stats: [
      { label: "最新股息率", value: latest ? `${latest.divYieldPct}%` : "—", note: latest?.date },
      { label: "股债利差", value: latest ? `${latest.spreadPct}%` : "—", note: latest?.date },
      { label: "利差历史分位", value: percentile == null ? "—" : `${percentile}%` },
    ],
    bullets: [obs.body, "A 股红利可结合利差与历史分位；港股红利注意国债锚口径说明。"],
    integrity,
    highlightIndices: highlights,
  };
}

export function buildHomeDimensionSnapshots(args: {
  indices: IndexDefinition[];
  bondByDate: Record<string, BondSeriesPoint>;
  indexTracking: IndexTrackingRow[];
}): Record<ConfigDimensionId, DimensionCardSnapshot> {
  return {
    cash_creation: buildCashCreationCardSnapshot(args.indices, args.indexTracking),
    shareholder_return: buildShareholderReturnCardSnapshot(args.indices, args.bondByDate, args.indexTracking),
  };
}

export function filterIndicesByDimension(indices: IndexDefinition[], dimension: ConfigDimensionId): IndexDefinition[] {
  return indices.filter((d) => indexToConfigDimension(d.meta.category) === dimension);
}

export function filterIndicesByDimensionOption(
  indices: IndexDefinition[],
  dimension: ConfigDimensionFilter
): IndexDefinition[] {
  if (dimension === "all") return indices.filter((d) => indexToConfigDimension(d.meta.category) != null);
  return filterIndicesByDimension(indices, dimension);
}

export function groupEtfsForLanding(definitions: EtfDefinition[]) {
  const cash: EtfDefinition[] = [];
  const cn: EtfDefinition[] = [];
  const hk: EtfDefinition[] = [];
  const other: EtfDefinition[] = [];
  for (const d of definitions) {
    const g = etfToLandingGroup(d.meta);
    if (g === "cash_creation") cash.push(d);
    else if (g === "shareholder_return_cn") cn.push(d);
    else if (g === "shareholder_return_hk") hk.push(d);
    else other.push(d);
  }
  return { cash, cn, hk, other };
}

/** 站点级数据完整性一行摘要（首页提示条） */
export function siteDataIntegrityLine(indices: IndexDefinition[], definitions: EtfDefinition[]): string {
  const cash = summarizeDimensionIntegrity(indices, "cash_creation");
  const div = summarizeDimensionIntegrity(indices, "shareholder_return");
  const etfOk = definitions.filter((d) => etfDataAvailability(d) === "ok").length;
  return `指数代表行情 ${cash.label} · 红利代表 ${div.label} · ETF 可用 ${etfOk}/${definitions.length}`;
}
