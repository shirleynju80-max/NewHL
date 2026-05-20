import type { IndexBar } from "../types";
import type { IndexValueMode } from "../data/indexCsv";
import { indexSeriesForMode } from "../data/indexCsv";

const TRADING_DAYS = 252;

function validPoints(series: { value: number }[]): { value: number }[] {
  return series.filter((p) => typeof p.value === "number" && !Number.isNaN(p.value) && p.value > 0);
}

/** 全样本总收益（%），首末点比 - 1。 */
export function totalReturnPctFromSeries(series: { value: number }[]): number | null {
  const v = validPoints(series);
  if (v.length < 2) return null;
  const a = v[0]!.value;
  const b = v[v.length - 1]!.value;
  if (a <= 0) return null;
  return Math.round(((b / a - 1) * 100 + Number.EPSILON) * 100) / 100;
}

/** 最大回撤（%），基于净值曲线。 */
export function maxDrawdownPctFromSeries(series: { value: number }[]): number | null {
  const v = validPoints(series);
  if (v.length < 2) return null;
  let peak = v[0]!.value;
  let maxDd = 0;
  for (const p of v) {
    if (p.value > peak) peak = p.value;
    const dd = peak > 0 ? (peak - p.value) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }
  return Math.round((maxDd * 100 + Number.EPSILON) * 100) / 100;
}

/** 日对数收益年化波动（%，简易）。 */
export function annualizedVolFromSeries(series: { value: number }[]): number | null {
  const pts = validPoints(series);
  if (pts.length < 5) return null;
  const rets: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!.value;
    const b = pts[i]!.value;
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const varSample =
    rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  const vol = Math.sqrt(varSample * TRADING_DAYS);
  return Math.round(vol * 10000) / 100;
}

export function indexPerfFromBars(bars: IndexBar[], mode: IndexValueMode) {
  const series = indexSeriesForMode(bars, mode);
  return {
    totalReturnPct: totalReturnPctFromSeries(series),
    maxDrawdownPct: maxDrawdownPctFromSeries(series),
    annVolPct: annualizedVolFromSeries(series),
  };
}

export type DateValue = { date: string; value: number };

/** 按日期交集对齐后的首尾总收益（%）。 */
export function overlapTotalReturnPct(
  a: DateValue[],
  b: DateValue[]
): { indexPct: number | null; otherPct: number | null } {
  const mb = new Map(b.map((p) => [p.date, p.value]));
  const pairs: { va: number; vb: number }[] = [];
  for (const p of a) {
    const vb = mb.get(p.date);
    if (vb == null || Number.isNaN(vb) || vb <= 0) continue;
    if (Number.isNaN(p.value) || p.value <= 0) continue;
    pairs.push({ va: p.value, vb });
  }
  if (pairs.length < 2) return { indexPct: null, otherPct: null };
  const f = pairs[0]!;
  const l = pairs[pairs.length - 1]!;
  return {
    indexPct: Math.round(((l.va / f.va - 1) * 100 + Number.EPSILON) * 100) / 100,
    otherPct: Math.round(((l.vb / f.vb - 1) * 100 + Number.EPSILON) * 100) / 100,
  };
}

export function etfCloseSeriesFromBars(
  dates: string[],
  closeByDate: Map<string, number>
): DateValue[] {
  return dates
    .map((d) => {
      const v = closeByDate.get(d);
      if (v == null || v <= 0) return null;
      return { date: d, value: v };
    })
    .filter((x): x is DateValue => x != null);
}
