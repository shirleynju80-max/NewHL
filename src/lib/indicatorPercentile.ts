import { formatPctValue } from "./formatDisplay";
import type { EtfParams, OhlcBar } from "../types";
import { bollinger, closesFromBars, rsi, sma } from "./indicators";
import {
  getBollingerVariant,
  getMaPair,
  getRsiVariant,
  usesBollStrategy,
  usesMaCustomStrategy,
  usesRsiStrategy,
} from "./strategy";

const BUY_PCT = 20;
const SELL_PCT = 80;

/** MA 金叉：快慢线相对价差映射到 0–100 的线性标尺（±2% 价格） */
const MA_SPREAD_PCT_LOW = -2;
const MA_SPREAD_PCT_HIGH = 2;
/** MA 自定义：价相对 MA 偏离映射到 0–100（±2.5%） */
const MA_CUSTOM_DEV_LOW = -2.5;
const MA_CUSTOM_DEV_HIGH = 2.5;

export type PercentileZone = "buy_hint" | "sell_hint" | "neutral";

export type IndicatorPercentileContext = {
  metricName: string;
  metricValue: string;
  /** 当前值在策略买卖标尺上的位置 0–100（非历史经验分位） */
  percentile: number;
  zone: PercentileZone;
  hint: string;
};

/** 经验分位：≤ 当前值的样本占比 ×100（0–100）；保留供其他分析使用 */
export function empiricalPercentile(history: number[], x: number): number {
  if (!history.length) return 50;
  let le = 0;
  for (const v of history) {
    if (v <= x) le++;
  }
  return Math.round((le / history.length) * 10000) / 100;
}

function clamp01to100(x: number): number {
  return Math.round(Math.max(0, Math.min(100, x)) * 100) / 100;
}

function linearBandPosition(value: number, low: number, high: number): number {
  if (high <= low) return 50;
  return clamp01to100(((value - low) / (high - low)) * 100);
}

function zoneFromPosition(pct: number): PercentileZone {
  if (pct <= BUY_PCT) return "buy_hint";
  if (pct >= SELL_PCT) return "sell_hint";
  return "neutral";
}

function hintFor(zone: PercentileZone, pct: number): string {
  if (zone === "buy_hint")
    return `贴近买侧（标尺≤${formatPctValue(BUY_PCT)}%）`;
  if (zone === "sell_hint")
    return `贴近卖侧（标尺≥${formatPctValue(SELL_PCT)}%）`;
  return `中性（${formatPctValue(pct)}%）`;
}

/**
 * 今日（或合并后最后一根 K）相对策略阈值的**标尺位置** 0–100：
 * RSI：超卖–超买区间线性映射；布林带：下轨–上轨之间位置；MA：快慢线价差或价偏离 MA 的固定带宽映射。
 */
export function strategyPercentileContext(
  bars: OhlcBar[],
  params: EtfParams,
  strategyId: string,
  mergedBars?: OhlcBar[],
): IndicatorPercentileContext | null {
  if (bars.length < 3) return null;
  const source = mergedBars ?? bars;
  const last = source.length - 1;

  if (usesMaCustomStrategy(strategyId) && params.ma_custom_rule) {
    const rule = params.ma_custom_rule;
    const c2 = closesFromBars(source);
    const ma2 = sma(c2, rule.buyMaPeriod);
    const m = ma2[last];
    if (m == null || m === 0) return null;
    const devPct = ((c2[last] - m) / m) * 100;
    const pct = linearBandPosition(
      devPct,
      MA_CUSTOM_DEV_LOW,
      MA_CUSTOM_DEV_HIGH,
    );
    const zone = zoneFromPosition(pct);
    return {
      metricName: `价偏离MA${rule.buyMaPeriod}%`,
      metricValue: `${Math.round(devPct * 10000) / 10000}`,
      percentile: pct,
      zone,
      hint: hintFor(zone, pct),
    };
  }

  if (usesBollStrategy(strategyId)) {
    const bv = getBollingerVariant(params);
    if (!bv) return null;
    const c2 = closesFromBars(source);
    const { upper: u2, lower: l2 } = bollinger(c2, bv.period, bv.stdDev);
    const u = u2[last];
    const lo = l2[last];
    if (u == null || lo == null) return null;
    const span = u - lo;
    if (span <= 0) return null;
    const pb = clamp01to100(((c2[last] - lo) / span) * 100);
    const zone = zoneFromPosition(pb);
    return {
      metricName: "分位数",
      metricValue: `${Math.round(pb * 100) / 100}`,
      percentile: pb,
      zone,
      hint: hintFor(zone, pb),
    };
  }

  if (usesRsiStrategy(strategyId)) {
    const rv = getRsiVariant(params);
    if (!rv) return null;
    const closesCur = closesFromBars(source);
    const seriesCur = rsi(closesCur, rv.period);
    const cur = seriesCur[seriesCur.length - 1];
    if (cur == null) return null;
    const { overbought: ob, oversold: os } = rv;
    const pct = linearBandPosition(cur, os, ob);
    const zone = zoneFromPosition(pct);
    return {
      metricName: "RSI",
      metricValue: String(Math.round(cur * 100) / 100),
      percentile: pct,
      zone,
      hint: hintFor(zone, pct),
    };
  }

  const pair = getMaPair(params);
  if (!pair) return null;
  const c2 = closesFromBars(source);
  const f2 = sma(c2, pair.fastP);
  const s2 = sma(c2, pair.slowP);
  if (f2[last] == null || s2[last] == null || source[last].close === 0)
    return null;
  const g =
    (((f2[last] as number) - (s2[last] as number)) / source[last].close) * 100;
  const pct = linearBandPosition(g, MA_SPREAD_PCT_LOW, MA_SPREAD_PCT_HIGH);
  const zone = zoneFromPosition(pct);
  return {
    metricName: "MA价差%",
    metricValue: `${Math.round(g * 10000) / 10000}`,
    percentile: pct,
    zone,
    hint: hintFor(zone, pct),
  };
}

/** 台账：某日指标展示文案 */
export function indicatorValueLabelAtDate(
  bars: OhlcBar[],
  params: EtfParams,
  strategyId: string,
  date: string,
): string {
  const idx = bars.findIndex((b) => b.date === date);
  if (idx < 0) return "—";
  const closes = closesFromBars(bars);
  if (usesMaCustomStrategy(strategyId) && params.ma_custom_rule) {
    const rule = params.ma_custom_rule;
    const ma = sma(closes, rule.buyMaPeriod);
    const m = ma[idx];
    if (m == null) return "—";
    const g = (((closes[idx] - m) / bars[idx].close) * 100).toFixed(4);
    return `价-MA${rule.buyMaPeriod}%=${g}`;
  }
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
    return `分位≈${pb}`;
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
  const g =
    (((fast[idx] as number) - (slow[idx] as number)) / bars[idx].close) * 100;
  return `价差%=${Math.round(g * 10000) / 10000}`;
}
