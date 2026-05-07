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

export type CompareRow = {
  code: string;
  name: string;
  overlapDays: number;
  from: string;
  to: string;
  /** 买入持有年化（重合区间，按交易日缩放） */
  annualReturnPct: number;
  maxDrawdownPct: number;
  annualVolPct: number;
  /** 年化收益 / 最大回撤（回撤为 0 时记为 —） */
  calmarLike: number | null;
};

export type CompareResult = {
  rows: CompareRow[];
  labels: string[];
  /** 日收益 Pearson，与 labels 同序 */
  correlation: number[][];
  dates: string[];
};

const MIN_OVERLAP = 30;

/**
 * 在全体 K 线日期交集上，对各标的按收盘做买入持有统计与收益相关性。
 */
export function compareDefinitions(defs: EtfDefinition[]): CompareResult | null {
  if (defs.length < 2) return null;
  const dates = overlappingSortedDates(defs);
  if (dates.length < MIN_OVERLAP) return null;

  const maps = defs.map((d) => barCloseByDate(d.bars));
  const closesMatrix: number[][] = defs.map((_, i) =>
    dates.map((dt) => {
      const v = maps[i].get(dt);
      if (v == null || Number.isNaN(v)) return NaN;
      return v;
    })
  );
  for (const row of closesMatrix) {
    if (row.some((x) => Number.isNaN(x))) return null;
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

  const rows: CompareRow[] = defs.map((d, i) => {
    const c = closesMatrix[i];
    const ann = Math.round(annualizedReturnPct(c) * 100) / 100;
    const mdd = maxDrawdownFromCloses(c);
    const mddPct = Math.round(mdd * 10000) / 100;
    const sd = sampleStdDailyReturns(c);
    const volPct = Math.round(sd * Math.sqrt(252) * 10000) / 100;
    const calmar = mdd > 1e-8 ? Math.round((ann / (mdd * 100)) * 100) / 100 : null;
    return {
      code: d.meta.code,
      name: d.meta.name,
      overlapDays: dates.length,
      from: dates[0],
      to: dates[dates.length - 1],
      annualReturnPct: ann,
      maxDrawdownPct: mddPct,
      annualVolPct: volPct,
      calmarLike: calmar,
    };
  });

  return {
    rows,
    labels: defs.map((d) => d.meta.code),
    correlation,
    dates,
  };
}
