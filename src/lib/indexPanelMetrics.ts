import type { SeriesMetricBlock, SeriesOverviewRow } from "./compareEtfs";

export type DateValuePoint = { date: string; value: number };

export type MetricWindowId = "mtd" | "m1" | "m3" | "ytd" | "y1" | "y3" | "y5" | "all";

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
  { id: "all", label: "成立/可得以来" },
];

const TRADING_DAYS = 252;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isValidPoint(p: DateValuePoint): boolean {
  return Boolean(p.date) && Number.isFinite(p.value) && p.value > 0;
}

export function cleanDateValueSeries(series: DateValuePoint[]): DateValuePoint[] {
  return series.filter(isValidPoint).sort((a, b) => a.date.localeCompare(b.date));
}

function shiftYears(date: Date, years: number): Date {
  const d = new Date(date.getTime());
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function windowStartDate(id: MetricWindowId, latest: string): string | null {
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
  return shiftYears(d, -5).toISOString().slice(0, 10);
}

export function sliceSeriesForWindow(series: DateValuePoint[], id: MetricWindowId): DateValuePoint[] {
  const clean = cleanDateValueSeries(series);
  const latest = clean.at(-1)?.date;
  if (!latest || id === "all") return clean;
  const start = windowStartDate(id, latest);
  return start ? clean.filter((p) => p.date >= start) : clean;
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
  const elapsedDays = Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(1, (endMs - startMs) / MS_PER_DAY) : pts.length;
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
    const variance = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, rets.length - 1);
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
  return id === "y1" || id === "y3" || id === "y5" || id === "all";
}

export function buildMetricRow(id: string, label: string, series: DateValuePoint[]): MetricRow {
  return {
    id,
    label,
    windows: Object.fromEntries(
      METRIC_WINDOWS.map((win) => [win.id, calcMetricBlock(sliceSeriesForWindow(series, win.id))])
    ) as Record<MetricWindowId, MetricBlock>,
  };
}

const MIN_OVERVIEW_POINTS = 20;

function metricBlockToSeriesBlock(mb: MetricBlock): SeriesMetricBlock | null {
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
  const calmarLike = mb.calmar == null ? null : Math.round(mb.calmar * 100) / 100;
  const sharpeLike =
    mb.annualVolPct > 1e-6 ? Math.round((mb.annualReturnPct / mb.annualVolPct) * 100) / 100 : null;
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
  name: string
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
  };
}

export function cumulativeReturnSeries(
  seriesMap: Record<string, DateValuePoint[]>,
  dates: string[]
): Array<Record<string, number | string | null>> {
  const valueMaps = Object.fromEntries(
    Object.entries(seriesMap).map(([key, series]) => [key, new Map(cleanDateValueSeries(series).map((p) => [p.date, p.value]))])
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
  bins: { min: number; max: number; mid: number; count: number; label: string }[];
};

export function buildPercentileHistogram(values: number[], binCount = 12): PercentileHistogram {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const latest = xs.length ? values.filter((v) => Number.isFinite(v)).at(-1)! : null;
  if (xs.length === 0 || latest == null) return { latest: null, percentile: null, bins: [] };
  const belowOrEqual = xs.filter((v) => v <= latest).length;
  const percentile = round2((belowOrEqual / xs.length) * 100);
  const min = xs[0]!;
  const max = xs.at(-1)!;
  const width = max === min ? 1 : (max - min) / Math.max(1, binCount);
  const bins = Array.from({ length: Math.max(1, binCount) }, (_, i) => {
    const lo = min + width * i;
    const hi = i === binCount - 1 ? max : min + width * (i + 1);
    return { min: lo, max: hi, mid: (lo + hi) / 2, count: 0, label: `${round2(lo)}-${round2(hi)}` };
  });
  for (const v of xs) {
    const raw = width > 0 ? Math.floor((v - min) / width) : 0;
    const idx = Math.min(bins.length - 1, Math.max(0, raw));
    bins[idx]!.count += 1;
  }
  return { latest: round2(latest), percentile, bins };
}
