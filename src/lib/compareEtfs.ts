import type { EtfDefinition, OhlcBar } from "../types";

function barCloseByDate(bars: OhlcBar[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of bars) m.set(b.date, b.close);
  return m;
}

/** 多标的日期交集，升序 */
export function overlappingSortedDates(defs: EtfDefinition[]): string[] {
  if (!defs.length) return [];
  const sets = defs.map((d) => new Set(d.bars.map((b) => b.date)));
  let inter = sets[0];
  for (let i = 1; i < sets.length; i++) {
    const next = sets[i];
    inter = new Set([...inter].filter((x) => next.has(x)));
  }
  return [...inter].sort((a, b) => a.localeCompare(b));
}

function sampleStdDailyReturns(closes: number[]): number {
  if (closes.length < 3) return 0;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const p = closes[i - 1];
    if (p !== 0) rets.push(closes[i] / p - 1);
  }
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(Math.max(0, v));
}

function maxDrawdownFromCloses(closes: number[]): number {
  if (closes.length < 2) return 0;
  let peak = closes[0];
  let maxDd = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    maxDd = Math.max(maxDd, (peak - c) / peak);
  }
  return maxDd;
}

/** 交易日年化：按 (末/首)^(252/(n-1))-1 */
function annualizedReturnPct(closes: number[]): number {
  if (closes.length < 2) return 0;
  const n = closes.length;
  const ratio = closes[n - 1] / closes[0];
  if (ratio <= 0) return 0;
  const periods = n - 1;
  return (Math.pow(ratio, 252 / periods) - 1) * 100;
}

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return 0;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const vx = x[i] - mx;
    const vy = y[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

const MIN_WINDOW_DAYS = 20;
const TRADING_1Y = 252;
const TRADING_3Y = 756;
const TRADING_5Y = 1260;
const MIN_OVERLAP = 30;

/** 一段连续收盘序列上的买入持有与风险指标 */
export type SeriesMetricBlock = {
  days: number;
  from: string;
  to: string;
  /** 区间首尾收盘总收益 % */
  totalReturnPct: number;
  annualReturnPct: number;
  maxDrawdownPct: number;
  annualVolPct: number;
  calmarLike: number | null;
  /** 年化收益 ÷ 年化波动（简化夏普），波动极小时为 null */
  sharpeLike: number | null;
} | null;

function totalReturnPctFromCloses(closes: number[]): number {
  if (closes.length < 2) return 0;
  return Math.round((closes[closes.length - 1]! / closes[0]! - 1) * 10000) / 100;
}

export function seriesMetricBlock(closes: number[], dates: string[]): SeriesMetricBlock {
  if (closes.length < MIN_WINDOW_DAYS || dates.length < MIN_WINDOW_DAYS) return null;
  const ann = Math.round(annualizedReturnPct(closes) * 100) / 100;
  const mdd = maxDrawdownFromCloses(closes);
  const mddPct = Math.round(mdd * 10000) / 100;
  const sd = sampleStdDailyReturns(closes);
  const volPct = Math.round(sd * Math.sqrt(252) * 10000) / 100;
  const calmar = mdd > 1e-8 ? Math.round((ann / (mdd * 100)) * 100) / 100 : null;
  const tot = totalReturnPctFromCloses(closes);
  const sharpeLike =
    volPct > 1e-6 ? Math.round((ann / volPct) * 100) / 100 : null;
  return {
    days: closes.length,
    from: dates[0],
    to: dates[dates.length - 1],
    totalReturnPct: tot,
    annualReturnPct: ann,
    maxDrawdownPct: mddPct,
    annualVolPct: volPct,
    calmarLike: calmar,
    sharpeLike,
  };
}

function sortedBarsSeries(d: EtfDefinition): { closes: number[]; dates: string[] } {
  const sorted = [...d.bars].sort((a, b) => a.date.localeCompare(b.date));
  return {
    closes: sorted.map((b) => b.close),
    dates: sorted.map((b) => b.date),
  };
}

export type SeriesOverviewRow = {
  code: string;
  name: string;
  all: SeriesMetricBlock;
  y1: SeriesMetricBlock;
  y3: SeriesMetricBlock;
  y5: SeriesMetricBlock;
};

/** 任意净值/收盘序列：全样本 + 近 1/3/5 年（与 ETF 总览同一套指标）。 */
export function buildSeriesOverviewRowFromNav(
  closes: number[],
  dates: string[],
  code: string,
  name: string
): SeriesOverviewRow | null {
  if (closes.length !== dates.length || closes.length < MIN_WINDOW_DAYS) return null;
  const n = closes.length;
  const tail = (len: number) =>
    n >= len ? seriesMetricBlock(closes.slice(-len), dates.slice(-len)) : null;
  return {
    code,
    name,
    all: seriesMetricBlock(closes, dates),
    y1: tail(TRADING_1Y),
    y3: tail(TRADING_3Y),
    y5: tail(TRADING_5Y),
  };
}

/** 单标的：全样本 + 近 1/3/5 年（按约 252 交易日/年切片），均基于该标的全部有行情日期 */
export function buildSeriesOverviewRow(d: EtfDefinition): SeriesOverviewRow {
  const { closes, dates } = sortedBarsSeries(d);
  const row = buildSeriesOverviewRowFromNav(closes, dates, d.meta.code, d.meta.name);
  if (!row) {
    return {
      code: d.meta.code,
      name: d.meta.name,
      all: null,
      y1: null,
      y3: null,
      y5: null,
    };
  }
  return row;
}

export type CompareResult = {
  overview: SeriesOverviewRow[];
  /** Pearson 日收益相关：仅在多标的且重合日 ≥30 时有值 */
  correlation: number[][] | null;
  corrLabels: string[];
  overlapDates: string[];
  overlapOk: boolean;
};

/**
 * 概览：各标的在**自身全部 bar 日期**上算收益/回撤/波动（及滚动窗口）。
 * 相关性矩阵：仅在**多标的日期交集**上算日收益 Pearson。
 */
export function compareDefinitions(defs: EtfDefinition[]): CompareResult | null {
  if (defs.length < 1) return null;
  const overview = defs.map(buildSeriesOverviewRow);
  if (defs.length < 2) {
    return { overview, correlation: null, corrLabels: [], overlapDates: [], overlapOk: false };
  }

  const dates = overlappingSortedDates(defs);
  if (dates.length < MIN_OVERLAP) {
    return {
      overview,
      correlation: null,
      corrLabels: defs.map((d) => d.meta.code),
      overlapDates: dates,
      overlapOk: false,
    };
  }

  const maps = defs.map((d) => barCloseByDate(d.bars));
  const closesMatrix: number[][] = defs.map((_, i) =>
    dates.map((dt) => {
      const v = maps[i].get(dt);
      if (v == null || Number.isNaN(v)) return NaN;
      return v;
    })
  );
  for (const row of closesMatrix) {
    if (row.some((x) => Number.isNaN(x))) {
      return {
        overview,
        correlation: null,
        corrLabels: defs.map((d) => d.meta.code),
        overlapDates: dates,
        overlapOk: false,
      };
    }
  }

  const rets: number[][] = closesMatrix.map((closes) => {
    const r: number[] = [];
    for (let t = 1; t < closes.length; t++) {
      const p = closes[t - 1];
      r.push(p !== 0 ? closes[t] / p - 1 : 0);
    }
    return r;
  });

  const n = defs.length;
  const correlation: number[][] = Array.from({ length: n }, () => Array(n).fill(1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      const c = pearson(rets[i], rets[j]);
      correlation[i][j] = c;
      correlation[j][i] = c;
    }
  }

  return {
    overview,
    correlation,
    corrLabels: defs.map((d) => d.meta.code),
    overlapDates: dates,
    overlapOk: true,
  };
}
