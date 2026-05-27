import type { OhlcBar } from "../types";
import type { SeriesMetricBlock, SeriesOverviewRow } from "./compareEtfs";

export type DateValuePoint = { date: string; value: number };

export type MetricWindowId =
  | "mtd"
  | "m1"
  | "m3"
  | "ytd"
  | "y1"
  | "y3"
  | "y5"
  | "y10"
  | "all";

export type MetricBlock = {
  totalReturnPct: number | null;
  annualReturnPct: number | null;
  annualVolPct: number | null;
  maxDrawdownPct: number | null;
  calmar: number | null;
  startDate: string | null;
  endDate: string | null;
  points: number;
};

export type MetricRow = {
  id: string;
  label: string;
  windows: Record<MetricWindowId, MetricBlock>;
};

export const METRIC_WINDOWS: { id: MetricWindowId; label: string }[] = [
  { id: "mtd", label: "本月" },
  { id: "m1", label: "近一月" },
  { id: "m3", label: "近三月" },
  { id: "ytd", label: "年至今" },
  { id: "y1", label: "近一年" },
  { id: "y3", label: "近三年" },
  { id: "y5", label: "近五年" },
  { id: "y10", label: "近十年" },
  { id: "all", label: "成立/可得以来" },
];

/** 与指数详情指标表列一致，勿在页面单独维护另一份 id 列表。 */
export const RETURN_METRIC_WINDOW_IDS: MetricWindowId[] = [
  "m1",
  "m3",
  "ytd",
  "y1",
  "y3",
  "y5",
  "y10",
];

export const ANNUAL_METRIC_WINDOW_IDS: MetricWindowId[] = [
  "y1",
  "y3",
  "y5",
  "y10",
];

const EMPTY_METRIC_BLOCK: MetricBlock = {
  totalReturnPct: null,
  annualReturnPct: null,
  annualVolPct: null,
  maxDrawdownPct: null,
  calmar: null,
  startDate: null,
  endDate: null,
  points: 0,
};

export function metricWindowBlock(
  row: MetricRow,
  id: MetricWindowId,
): MetricBlock {
  return row.windows[id] ?? EMPTY_METRIC_BLOCK;
}

const TRADING_DAYS = 252;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isValidPoint(p: DateValuePoint): boolean {
  return Boolean(p.date) && Number.isFinite(p.value) && p.value > 0;
}

export function cleanDateValueSeries(
  series: DateValuePoint[],
): DateValuePoint[] {
  return series
    .filter(isValidPoint)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function shiftYears(date: Date, years: number): Date {
  const d = new Date(date.getTime());
  d.setFullYear(d.getFullYear() + years);
  return d;
}

/** 自最新观测日回溯的窗口起点（含起点当日）；与指数详情页快捷区间一致。 */
export function windowStartDate(
  id: MetricWindowId,
  latest: string,
): string | null {
  if (id === "all") return null;
  const d = new Date(`${latest}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  if (id === "mtd") return `${latest.slice(0, 8)}01`;
  if (id === "m1") {
    const x = new Date(d.getTime());
    x.setMonth(x.getMonth() - 1);
    return x.toISOString().slice(0, 10);
  }
  if (id === "m3") {
    const x = new Date(d.getTime());
    x.setMonth(x.getMonth() - 3);
    return x.toISOString().slice(0, 10);
  }
  if (id === "ytd") return `${latest.slice(0, 4)}-01-01`;
  if (id === "y1") return shiftYears(d, -1).toISOString().slice(0, 10);
  if (id === "y3") return shiftYears(d, -3).toISOString().slice(0, 10);
  if (id === "y5") return shiftYears(d, -5).toISOString().slice(0, 10);
  if (id === "y10") return shiftYears(d, -10).toISOString().slice(0, 10);
  return null;
}

export function metricWindowDateRange(
  series: DateValuePoint[],
  id: MetricWindowId,
): { start: string; end: string } | null {
  const sliced = sliceSeriesForWindow(series, id);
  if (!sliced.length) return null;
  return { start: sliced[0]!.date, end: sliced[sliced.length - 1]!.date };
}

export function ohlcBarsToSeries(bars: OhlcBar[]): DateValuePoint[] {
  return cleanDateValueSeries(
    [...bars]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((b) => ({ date: b.date, value: b.close })),
  );
}

/** ETF 对比 / 回测切片：与指数列表、详情指标表同一日历窗口。 */
export function sliceBarsForWindow(
  bars: OhlcBar[],
  id: MetricWindowId,
): OhlcBar[] {
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  if (id === "all" || !sorted.length) return sorted;
  const keep = new Set(
    sliceSeriesForWindow(ohlcBarsToSeries(sorted), id).map((p) => p.date),
  );
  return sorted.filter((b) => keep.has(b.date));
}

export function sliceSeriesForWindow(
  series: DateValuePoint[],
  id: MetricWindowId,
): DateValuePoint[] {
  const clean = cleanDateValueSeries(series);
  const latest = clean.at(-1)?.date;
  if (!latest || id === "all") return clean;
  const start = windowStartDate(id, latest);
  return start ? clean.filter((p) => p.date >= start) : clean;
}

/** 固定日历区间（含起止日），用于配置总览等不随「当前日」滚动的对比。 */
export function sliceSeriesByDateRange(
  series: DateValuePoint[],
  startInclusive: string,
  endInclusive: string,
): DateValuePoint[] {
  const clean = cleanDateValueSeries(series);
  return clean.filter(
    (p) => p.date >= startInclusive && p.date <= endInclusive,
  );
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function round4(v: number): number {
  return Math.round((v + Number.EPSILON) * 10000) / 10000;
}

export function calcMetricBlock(series: DateValuePoint[]): MetricBlock {
  const pts = cleanDateValueSeries(series);
  const first = pts[0];
  const last = pts.at(-1);
  if (!first || !last || pts.length < 2) {
    return {
      annualReturnPct: null,
      totalReturnPct: null,
      annualVolPct: null,
      maxDrawdownPct: null,
      calmar: null,
      startDate: first?.date ?? null,
      endDate: last?.date ?? null,
      points: pts.length,
    };
  }

  const startMs = Date.parse(`${first.date}T00:00:00`);
  const endMs = Date.parse(`${last.date}T00:00:00`);
  const elapsedDays =
    Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(1, (endMs - startMs) / MS_PER_DAY)
      : pts.length;
  const years = Math.max(elapsedDays / 365.25, pts.length / TRADING_DAYS);
  const annualReturn = (last.value / first.value) ** (1 / years) - 1;
  const totalReturn = last.value / first.value - 1;

  const rets: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]!.value;
    const next = pts[i]!.value;
    if (prev > 0 && next > 0) rets.push(Math.log(next / prev));
  }
  let annVol: number | null = null;
  if (rets.length >= 2) {
    const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
    const variance =
      rets.reduce((s, x) => s + (x - mean) ** 2, 0) /
      Math.max(1, rets.length - 1);
    annVol = Math.sqrt(variance * TRADING_DAYS);
  }

  let peak = first.value;
  let maxDd = 0;
  for (const p of pts) {
    if (p.value > peak) peak = p.value;
    const dd = peak > 0 ? p.value / peak - 1 : 0;
    if (dd < maxDd) maxDd = dd;
  }

  const maxDrawdownPct = round2(maxDd * 100);
  const totalReturnPct = round2(totalReturn * 100);
  const annualReturnPct = round2(annualReturn * 100);
  const annualVolPct = annVol == null ? null : round2(annVol * 100);
  const calmar = maxDd < 0 ? round4(annualReturn / Math.abs(maxDd)) : null;

  return {
    totalReturnPct,
    annualReturnPct,
    annualVolPct,
    maxDrawdownPct,
    calmar,
    startDate: first.date,
    endDate: last.date,
    points: pts.length,
  };
}

export function shouldShowAnnualizedReturn(id: MetricWindowId): boolean {
  return (
    id === "y1" ||
    id === "y3" ||
    id === "y5" ||
    id === "y10" ||
    id === "all"
  );
}

export function buildMetricRow(
  id: string,
  label: string,
  series: DateValuePoint[],
): MetricRow {
  const windows = {} as Record<MetricWindowId, MetricBlock>;
  for (const win of METRIC_WINDOWS) {
    windows[win.id] = calcMetricBlock(sliceSeriesForWindow(series, win.id));
  }
  return { id, label, windows };
}

const MIN_OVERVIEW_POINTS = 20;

export function metricBlockToSeriesBlock(
  mb: MetricBlock,
): SeriesMetricBlock | null {
  if (mb.points < MIN_OVERVIEW_POINTS) return null;
  if (
    mb.annualReturnPct == null ||
    mb.maxDrawdownPct == null ||
    mb.annualVolPct == null ||
    mb.totalReturnPct == null ||
    !mb.startDate ||
    !mb.endDate
  ) {
    return null;
  }
  const calmarLike =
    mb.calmar == null ? null : Math.round(mb.calmar * 100) / 100;
  const sharpeLike =
    mb.annualVolPct > 1e-6
      ? Math.round((mb.annualReturnPct / mb.annualVolPct) * 100) / 100
      : null;
  return {
    days: mb.points,
    from: mb.startDate,
    to: mb.endDate,
    totalReturnPct: mb.totalReturnPct,
    annualReturnPct: mb.annualReturnPct,
    maxDrawdownPct: mb.maxDrawdownPct,
    annualVolPct: mb.annualVolPct,
    calmarLike,
    sharpeLike,
  };
}

/** 指数研究列表：与详情页指标表同一套日历窗口 + calcMetricBlock。 */
export function buildIndexOverviewFromSeries(
  series: DateValuePoint[],
  code: string,
  name: string,
): SeriesOverviewRow | null {
  const clean = cleanDateValueSeries(series);
  if (clean.length < MIN_OVERVIEW_POINTS) return null;
  const block = (id: MetricWindowId) =>
    metricBlockToSeriesBlock(calcMetricBlock(sliceSeriesForWindow(clean, id)));
  return {
    code,
    name,
    all: block("all"),
    y1: block("y1"),
    y3: block("y3"),
    y5: block("y5"),
    y10: block("y10"),
  };
}

/** 指数详情 Recharts 兜底上限（分层后仍超限则等间隔压缩）。 */
export const INDEX_CHART_MAX_POINTS = 640;

/** 自定义区间 ≤ 该交易日数时图表用全日（约 5 年）。 */
export const CHART_CUSTOM_FULL_MAX_POINTS = 1300;

export type ChartDateSamplingMode = "full" | "layered";

const LAYERED_QUICK_RANGES = new Set(["all", "10y"]);
const FULL_QUICK_RANGES = new Set([
  "1m",
  "3m",
  "ytd",
  "1y",
  "3y",
  "5y",
]);

function sortedUniqueDates(dates: string[]): string[] {
  return [...new Set(dates)].sort((a, b) => a.localeCompare(b));
}

/** 同一桶保留最后一个交易日（dates 须升序）。 */
function bucketLastDates(
  dates: string[],
  bucketKey: (date: string) => string,
): string[] {
  const lastByBucket = new Map<string, string>();
  for (const d of dates) lastByBucket.set(bucketKey(d), d);
  return [...lastByBucket.values()].sort((a, b) => a.localeCompare(b));
}

function weekBucketKey(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  const day = d.getDay();
  const toMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + toMonday);
  return monday.toISOString().slice(0, 10);
}

function monthBucketKey(date: string): string {
  return date.slice(0, 7);
}

/**
 * 长历史图表：近 1 年日频、1～5 年周频、更早月频（相对最新交易日）。
 * dates 须为升序交易日列表。
 */
export function layeredChartDates(sortedDates: string[]): string[] {
  const sorted = sortedUniqueDates(sortedDates);
  if (!sorted.length) return sorted;

  const last = sorted.at(-1)!;
  const y1Start = windowStartDate("y1", last);
  const y5Start = windowStartDate("y5", last);

  const recent: string[] = [];
  const mid: string[] = [];
  const old: string[] = [];

  for (const d of sorted) {
    if (y1Start && d >= y1Start) recent.push(d);
    else if (y5Start && d >= y5Start) mid.push(d);
    else old.push(d);
  }

  const out = sortedUniqueDates([
    ...bucketLastDates(old, monthBucketKey),
    ...bucketLastDates(mid, weekBucketKey),
    ...recent,
  ]);

  if (out.length <= INDEX_CHART_MAX_POINTS) return out;
  return sampleChartDates(out, INDEX_CHART_MAX_POINTS);
}

export function sampleChartDates(
  dates: string[],
  maxPoints = INDEX_CHART_MAX_POINTS,
): string[] {
  const sorted = sortedUniqueDates(dates);
  if (sorted.length <= maxPoints) return sorted;
  const step = Math.ceil(sorted.length / maxPoints);
  const out = sorted.filter((_, i) => i % step === 0);
  const last = sorted.at(-1);
  if (last && out.at(-1) !== last) out.push(last);
  return out;
}

/** 按快捷区间 / 区间长度决定图表用全日还是时间分层。 */
export function chartDateSamplingMode(
  dates: string[],
  quickRangeId?: string,
): ChartDateSamplingMode {
  const sorted = sortedUniqueDates(dates);
  if (!sorted.length) return "full";
  const id = quickRangeId ?? "all";

  if (FULL_QUICK_RANGES.has(id)) return "full";
  if (LAYERED_QUICK_RANGES.has(id)) return "layered";

  if (sorted.length <= CHART_CUSTOM_FULL_MAX_POINTS) return "full";
  const start = sorted[0]!;
  const end = sorted.at(-1)!;
  const startMs = Date.parse(`${start}T00:00:00`);
  const endMs = Date.parse(`${end}T00:00:00`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "layered";
  const years = (endMs - startMs) / (365.25 * MS_PER_DAY);
  return years > 5 ? "layered" : "full";
}

/** 指数详情主图 / 利差图用的展示日期（指标表仍用全样本）。 */
export function chartDatesForDisplay(
  dates: string[],
  quickRangeId?: string,
): string[] {
  const sorted = sortedUniqueDates(dates);
  if (!sorted.length) return sorted;
  if (chartDateSamplingMode(sorted, quickRangeId) === "full") return sorted;
  return layeredChartDates(sorted);
}

export function finiteMax(values: Iterable<number>, fallback = 0): number {
  let m = fallback;
  for (const v of values) {
    if (Number.isFinite(v) && v > m) m = v;
  }
  return m;
}

export function finiteMin(values: Iterable<number>, fallback = 0): number {
  let m = fallback;
  for (const v of values) {
    if (Number.isFinite(v) && v < m) m = v;
  }
  return m;
}

export function cumulativeReturnSeries(
  seriesMap: Record<string, DateValuePoint[]>,
  dates: string[],
): Array<Record<string, number | string | null>> {
  const valueMaps = Object.fromEntries(
    Object.entries(seriesMap).map(([key, series]) => [
      key,
      new Map(cleanDateValueSeries(series).map((p) => [p.date, p.value])),
    ]),
  ) as Record<string, Map<string, number>>;
  const bases: Record<string, number | undefined> = {};

  return dates.map((date) => {
    const row: Record<string, number | string | null> = { date };
    for (const key of Object.keys(valueMaps)) {
      const v = valueMaps[key]!.get(date);
      if (v == null || !Number.isFinite(v) || v <= 0) {
        row[key] = null;
        continue;
      }
      if (bases[key] == null) bases[key] = v;
      row[key] = bases[key]! > 0 ? round2((v / bases[key]! - 1) * 100) : null;
    }
    return row;
  });
}

export type PercentileHistogram = {
  latest: number | null;
  percentile: number | null;
  bins: {
    min: number;
    max: number;
    mid: number;
    count: number;
    label: string;
  }[];
};

export function buildPercentileHistogram(
  values: number[],
  binCount = 12,
): PercentileHistogram {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const latest = xs.length
    ? values.filter((v) => Number.isFinite(v)).at(-1)!
    : null;
  if (xs.length === 0 || latest == null)
    return { latest: null, percentile: null, bins: [] };
  const belowOrEqual = xs.filter((v) => v <= latest).length;
  const percentile = round2((belowOrEqual / xs.length) * 100);
  const min = xs[0]!;
  const max = xs.at(-1)!;
  const width = max === min ? 1 : (max - min) / Math.max(1, binCount);
  const bins = Array.from({ length: Math.max(1, binCount) }, (_, i) => {
    const lo = min + width * i;
    const hi = i === binCount - 1 ? max : min + width * (i + 1);
    return {
      min: lo,
      max: hi,
      mid: (lo + hi) / 2,
      count: 0,
      label: `${round2(lo)}-${round2(hi)}`,
    };
  });
  for (const v of xs) {
    const raw = width > 0 ? Math.floor((v - min) / width) : 0;
    const idx = Math.min(bins.length - 1, Math.max(0, raw));
    bins[idx]!.count += 1;
  }
  return { latest: round2(latest), percentile, bins };
}
