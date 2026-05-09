import type { EtfParams, OhlcBar } from "../types";
import { bollinger, closesFromBars, rsi, sma } from "./indicators";

export type Signal = "BUY" | "SELL" | "HOLD";

/** 与计划一致：用 T-1 全日 K + 当日 13:45 快照价合并为当日「部分 K 线」（实现规范单选：开高低收由当日已有 OHLC 与 last 合成） */
export function mergeIntraday1345(bars: OhlcBar[], snapshotClose: number): OhlcBar[] {
  if (bars.length === 0) return bars;
  const copy = bars.map((b) => ({ ...b }));
  const last = copy[copy.length - 1];
  const c = snapshotClose;
  last.close = c;
  last.high = Math.max(last.open, last.high, c);
  last.low = Math.min(last.open, last.low, c);
  return copy;
}

export function getMaPair(params: EtfParams): { fastP: number; slowP: number } | null {
  const id = params.strategy_ma_ids[0];
  const v = params.ma_variants.find((m) => m.variant_id === id);
  if (!v) return null;
  return { fastP: v.fast, slowP: v.slow };
}

export function getRsiVariant(params: EtfParams) {
  const id = params.strategy_rsi_id ?? "rsi_csv";
  return params.rsi_variants.find((r) => r.variant_id === id) ?? params.rsi_variants[0];
}

export function getBollingerVariant(params: EtfParams) {
  return params.bollinger_variants[0];
}

export function usesBollStrategy(strategyId: string): boolean {
  return strategyId.toLowerCase().includes("boll");
}

/** MA 金叉 / 死叉 */
export function computeSignalsMa(bars: OhlcBar[], params: EtfParams): Signal[] {
  const pair = getMaPair(params);
  if (!pair || bars.length < pair.slowP + 2) return bars.map(() => "HOLD");
  const closes = closesFromBars(bars);
  const fast = sma(closes, pair.fastP);
  const slow = sma(closes, pair.slowP);
  const sig: Signal[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i === 0 || fast[i] == null || slow[i] == null || fast[i - 1] == null || slow[i - 1] == null) {
      sig.push("HOLD");
      continue;
    }
    const f = fast[i] as number;
    const s = slow[i] as number;
    const pf = fast[i - 1] as number;
    const ps = slow[i - 1] as number;
    if (pf <= ps && f > s) sig.push("BUY");
    else if (pf >= ps && f < s) sig.push("SELL");
    else sig.push("HOLD");
  }
  return sig;
}

/**
 * RSI 均值回归（与常见 CSV 描述一致）：
 * - 买入：RSI 自上向下穿越超卖线（前一日 >= oversold 且当日 < oversold）
 * - 卖出：RSI 自下向上穿越超买线（前一日 <= overbought 且当日 > overbought）
 */
/**
 * 布林带均值回归：自下轨外回到轨内 → BUY；自上轨外回到轨内 → SELL。
 */
export function computeSignalsBollingerMeanReversion(bars: OhlcBar[], params: EtfParams): Signal[] {
  const bv = getBollingerVariant(params);
  if (!bv || bars.length < bv.period + 2) return bars.map(() => "HOLD");
  const closes = closesFromBars(bars);
  const { upper, lower } = bollinger(closes, bv.period, bv.stdDev);
  const sig: Signal[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      sig.push("HOLD");
      continue;
    }
    const up = upper[i];
    const lo = lower[i];
    const pup = upper[i - 1];
    const plo = lower[i - 1];
    if (up == null || lo == null || pup == null || plo == null) {
      sig.push("HOLD");
      continue;
    }
    const c = bars[i].close;
    const pc = bars[i - 1].close;
    if (pc < plo && c >= lo) sig.push("BUY");
    else if (pc > pup && c <= up) sig.push("SELL");
    else sig.push("HOLD");
  }
  return sig;
}

export function computeSignalsRsiMeanReversion(bars: OhlcBar[], params: EtfParams): Signal[] {
  const rv = getRsiVariant(params);
  if (!rv || bars.length < rv.period + 2) return bars.map(() => "HOLD");
  const closes = closesFromBars(bars);
  const series = rsi(closes, rv.period);
  const sig: Signal[] = [];
  const { overbought: ob, oversold: os } = rv;
  for (let i = 0; i < bars.length; i++) {
    if (i === 0 || series[i] == null || series[i - 1] == null) {
      sig.push("HOLD");
      continue;
    }
    const r = series[i] as number;
    const pr = series[i - 1] as number;
    if (pr >= os && r < os) sig.push("BUY");
    else if (pr <= ob && r > ob) sig.push("SELL");
    else sig.push("HOLD");
  }
  return sig;
}

/** 左侧截取回测窗口时，向前多取若干根 K 做 MA/RSI 预热 */
export function indicatorWarmupBars(params: EtfParams, strategyId: string): number {
  if (usesBollStrategy(strategyId)) {
    const bv = getBollingerVariant(params);
    return Math.min(500, Math.max(40, (bv?.period ?? 20) * 3 + 20));
  }
  if (usesRsiStrategy(strategyId)) {
    const rv = getRsiVariant(params);
    return Math.min(500, Math.max(40, (rv?.period ?? 14) * 3 + 20));
  }
  const pair = getMaPair(params);
  return Math.min(500, Math.max(40, (pair?.slowP ?? 20) * 3 + 20));
}

export function usesRsiStrategy(strategyId: string): boolean {
  const s = strategyId.toLowerCase();
  if (s.includes("boll")) return false;
  return s.includes("rsi");
}

/** 全日 K 重放与盘中合并序列共用：按 strategy_id 自动选 MA / RSI / 布林带 */
export function computeSignals(bars: OhlcBar[], params: EtfParams, strategyId: string): Signal[] {
  if (usesBollStrategy(strategyId)) return computeSignalsBollingerMeanReversion(bars, params);
  if (usesRsiStrategy(strategyId)) return computeSignalsRsiMeanReversion(bars, params);
  return computeSignalsMa(bars, params);
}

export function latestSignal(signals: Signal[]): Signal {
  for (let i = signals.length - 1; i >= 0; i--) {
    if (signals[i] !== "HOLD") return signals[i];
  }
  return "HOLD";
}
