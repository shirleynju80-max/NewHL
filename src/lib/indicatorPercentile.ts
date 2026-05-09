import type { EtfParams, OhlcBar } from "../types";
import { bollinger, closesFromBars, rsi, sma } from "./indicators";
import { getBollingerVariant, getMaPair, getRsiVariant, usesBollStrategy, usesRsiStrategy } from "./strategy";

const BUY_PCT = 20;
const SELL_PCT = 80;

export type PercentileZone = "buy_hint" | "sell_hint" | "neutral";

export type IndicatorPercentileContext = {
  metricName: string;
  metricValue: string;
  percentile: number;
  zone: PercentileZone;
  hint: string;
};

/** 经验分位：≤ 当前值的样本占比 ×100（0–100） */
export function empiricalPercentile(history: number[], x: number): number {
  if (!history.length) return 50;
  let le = 0;
  for (const v of history) {
    if (v <= x) le++;
  }
  return Math.round((le / history.length) * 10000) / 100;
}

/**
 * @param bars 全日历史 K（用于构造历史分布）
 * @param mergedBars 若传入，则用其最后一根 bar 计算「当前」指标（如今日模拟收盘）
 */
export function strategyPercentileContext(
  bars: OhlcBar[],
  params: EtfParams,
  strategyId: string,
  mergedBars?: OhlcBar[]
): IndicatorPercentileContext | null {
  if (bars.length < 3) return null;
  const closes = closesFromBars(bars);
  const n = bars.length;

  if (usesBollStrategy(strategyId)) {
    const bv = getBollingerVariant(params);
    if (!bv) return null;
    const { upper, lower } = bollinger(closes, bv.period, bv.stdDev);
    const history: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const u = upper[i];
      const lo = lower[i];
      if (u == null || lo == null) continue;
      const span = u - lo;
      if (span <= 0) continue;
      const p = ((closes[i] - lo) / span) * 100;
      history.push(Math.max(0, Math.min(100, p)));
    }
    const source = mergedBars ?? bars;
    const c2 = closesFromBars(source);
    const { upper: u2, lower: l2 } = bollinger(c2, bv.period, bv.stdDev);
    const last = source.length - 1;
    const u = u2[last];
    const lo = l2[last];
    if (u == null || lo == null || history.length === 0) return null;
    const span = u - lo;
    if (span <= 0) return null;
    const cur = Math.max(0, Math.min(100, ((c2[last] - lo) / span) * 100));
    const pct = empiricalPercentile(history, cur);
    const zone: PercentileZone =
      pct <= BUY_PCT ? "buy_hint" : pct >= SELL_PCT ? "sell_hint" : "neutral";
    const hint =
      zone === "buy_hint"
        ? `临近买入区间（价格在布林带内位置分位 ≤${BUY_PCT}%）`
        : zone === "sell_hint"
          ? `临近卖出区间（位置分位 ≥${SELL_PCT}%）`
          : `中性区间（分位 ${pct}%）`;
    return {
      metricName: "%B(近似)",
      metricValue: `${Math.round(cur * 100) / 100}`,
      percentile: pct,
      zone,
      hint,
    };
  }

  if (usesRsiStrategy(strategyId)) {
    const rv = getRsiVariant(params);
    if (!rv) return null;
    const seriesFull = rsi(closes, rv.period);
    const history: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const v = seriesFull[i];
      if (v != null) history.push(v);
    }
    const source = mergedBars ?? bars;
    const closesCur = closesFromBars(source);
    const seriesCur = rsi(closesCur, rv.period);
    const cur = seriesCur[seriesCur.length - 1];
    if (cur == null || history.length === 0) return null;
    const pct = empiricalPercentile(history, cur);
    const zone: PercentileZone =
      pct <= BUY_PCT ? "buy_hint" : pct >= SELL_PCT ? "sell_hint" : "neutral";
    const hint =
      zone === "buy_hint"
        ? `临近买入区间（历史分位 ≤${BUY_PCT}%）`
        : zone === "sell_hint"
          ? `临近卖出区间（历史分位 ≥${SELL_PCT}%）`
          : `中性区间（分位 ${pct}%）`;
    return {
      metricName: "RSI",
      metricValue: String(Math.round(cur * 100) / 100),
      percentile: pct,
      zone,
      hint,
    };
  }

  const pair = getMaPair(params);
  if (!pair) return null;
  const fast = sma(closes, pair.fastP);
  const slow = sma(closes, pair.slowP);
  const history: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    if (fast[i] == null || slow[i] == null) continue;
    const g = ((fast[i] as number) - (slow[i] as number)) / bars[i].close;
    history.push(g * 100);
  }
  const source = mergedBars ?? bars;
  const c2 = closesFromBars(source);
  const f2 = sma(c2, pair.fastP);
  const s2 = sma(c2, pair.slowP);
  const last = source.length - 1;
  if (f2[last] == null || s2[last] == null || history.length === 0) return null;
  const cur = (((f2[last] as number) - (s2[last] as number)) / source[last].close) * 100;
  const pct = empiricalPercentile(history, cur);
  const zone: PercentileZone =
    pct <= BUY_PCT ? "buy_hint" : pct >= SELL_PCT ? "sell_hint" : "neutral";
  const hint =
    zone === "buy_hint"
      ? `临近买入区间（快慢线价差分位 ≤${BUY_PCT}%）`
      : zone === "sell_hint"
        ? `临近卖出区间（价差分位 ≥${SELL_PCT}%）`
        : `中性区间（分位 ${pct}%）`;
  return {
    metricName: "MA价差%",
    metricValue: `${Math.round(cur * 10000) / 10000}`,
    percentile: pct,
    zone,
    hint,
  };
}

/** 台账：某日指标展示文案 */
export function indicatorValueLabelAtDate(
  bars: OhlcBar[],
  params: EtfParams,
  strategyId: string,
  date: string
): string {
  const idx = bars.findIndex((b) => b.date === date);
  if (idx < 0) return "—";
  const closes = closesFromBars(bars);
  if (usesBollStrategy(strategyId)) {
    const bv = getBollingerVariant(params);
    if (!bv) return "—";
    const { upper, lower } = bollinger(closes, bv.period, bv.stdDev);
    const u = upper[idx];
    const lo = lower[idx];
    if (u == null || lo == null) return "—";
    const span = u - lo;
    if (span <= 0) return "—";
    const pb = Math.round(((closes[idx] - lo) / span) * 10000) / 100;
    return `%B≈${pb}`;
  }
  if (usesRsiStrategy(strategyId)) {
    const rv = getRsiVariant(params);
    if (!rv) return "—";
    const s = rsi(closes, rv.period);
    const v = s[idx];
    return v == null ? "—" : `RSI=${Math.round(v * 100) / 100}`;
  }
  const pair = getMaPair(params);
  if (!pair) return "—";
  const fast = sma(closes, pair.fastP);
  const slow = sma(closes, pair.slowP);
  if (fast[idx] == null || slow[idx] == null) return "—";
  const g = (((fast[idx] as number) - (slow[idx] as number)) / bars[idx].close) * 100;
  return `价差%=${Math.round(g * 10000) / 10000}`;
}
