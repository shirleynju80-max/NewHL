import type { EtfParams, OhlcBar } from "../types";
import { bollinger, closesFromBars, rsi, sma } from "./indicators";
import { mondayKey, weeklyLastCloses } from "./weeklyAlign";

export type Signal = "BUY" | "SELL" | "HOLD";

/** 与计划一致：用 T-1 全日 K + 当日 13:45 快照价合并为当日「部分 K 线」（实现规范单选：开高低收由当日已有 OHLC 与 last 合成） */
export function mergeIntraday1345(
  bars: OhlcBar[],
  snapshotClose: number,
): OhlcBar[] {
  if (bars.length === 0) return bars;
  const copy = bars.map((b) => ({ ...b }));
  const last = copy[copy.length - 1];
  const c = snapshotClose;
  last.close = c;
  last.high = Math.max(last.open, last.high, c);
  last.low = Math.min(last.open, last.low, c);
  return copy;
}

export function getMaPair(
  params: EtfParams,
): { fastP: number; slowP: number } | null {
  const id = params.strategy_ma_ids[0];
  const v = params.ma_variants.find((m) => m.variant_id === id);
  if (!v) return null;
  return { fastP: v.fast, slowP: v.slow };
}

export function getRsiVariant(params: EtfParams) {
  const id = params.strategy_rsi_id ?? "rsi_csv";
  return (
    params.rsi_variants.find((r) => r.variant_id === id) ??
    params.rsi_variants[0]
  );
}

export function getBollingerVariant(params: EtfParams) {
  return params.bollinger_variants[0];
}

export function usesBollStrategy(strategyId: string): boolean {
  return strategyId.toLowerCase().includes("boll");
}

export function usesMaCustomStrategy(strategyId: string): boolean {
  return strategyId.toLowerCase().includes("ma_custom");
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
    if (
      i === 0 ||
      fast[i] == null ||
      slow[i] == null ||
      fast[i - 1] == null ||
      slow[i - 1] == null
    ) {
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
 * MA 自定义：收盘价上穿 MA(buyMaPeriod) 买入；持仓中逐日检查：浮盈 ≥ 止盈% **或** 自持仓以来收盘最高价回撤 ≥ 阈值% **先到先卖**（`pnl >= 止盈 || 回撤 >= 阈值`）。
 * 同一收盘日若两者同时满足，明细表记为「止盈+回撤（同日）」（与 buildTrades / maCustomSellTriggerLabel 一致）。
 */
export function computeSignalsMaCustom(
  bars: OhlcBar[],
  params: EtfParams,
): Signal[] {
  const rule = params.ma_custom_rule;
  if (!rule || bars.length < rule.buyMaPeriod + 2)
    return bars.map(() => "HOLD");
  const closes = closesFromBars(bars);
  const ma = sma(closes, rule.buyMaPeriod);
  const sig: Signal[] = bars.map(() => "HOLD");
  let pos = false;
  let entry = 0;
  let peak = 0;
  for (let i = 1; i < bars.length; i++) {
    const m = ma[i];
    const pm = ma[i - 1];
    if (m == null || pm == null) continue;
    if (!pos) {
      if (closes[i - 1] <= pm && closes[i] > m) {
        sig[i] = "BUY";
        pos = true;
        entry = closes[i];
        peak = closes[i];
      }
    } else {
      peak = Math.max(peak, closes[i]);
      const pnl = ((closes[i] - entry) / entry) * 100;
      const dd = peak > 0 ? ((peak - closes[i]) / peak) * 100 : 0;
      if (pnl >= rule.profitTakePct || dd >= rule.trailDrawdownPct) {
        sig[i] = "SELL";
        pos = false;
      }
    }
  }
  return sig;
}

function bollBandsOnBars(
  bars: OhlcBar[],
  period: number,
  stdDev: number,
  cadence: "1d" | "1w",
): { upper: (number | null)[]; lower: (number | null)[] } {
  if (cadence === "1d") return bollinger(closesFromBars(bars), period, stdDev);
  const w = weeklyLastCloses(bars);
  if (w.length < period + 2) {
    const empty = bars.map(() => null as number | null);
    return { upper: empty, lower: empty };
  }
  const wc = w.map((x) => x.close);
  const { upper: uw, lower: lw } = bollinger(wc, period, stdDev);
  const map = new Map<string, { u: number; l: number }>();
  for (let j = 0; j < w.length; j++) {
    const u = uw[j];
    const l = lw[j];
    if (u != null && l != null) map.set(w[j].weekMonday, { u, l });
  }
  return {
    upper: bars.map((b) => map.get(mondayKey(b.date))?.u ?? null),
    lower: bars.map((b) => map.get(mondayKey(b.date))?.l ?? null),
  };
}

/**
 * 布林带均值回归：自下轨外回到轨内 → BUY；自上轨外回到轨内 → SELL。
 */
export function computeSignalsBollingerMeanReversion(
  bars: OhlcBar[],
  params: EtfParams,
): Signal[] {
  const bv = getBollingerVariant(params);
  if (!bv || bars.length < bv.period + 2) return bars.map(() => "HOLD");
  const { upper, lower } = bollBandsOnBars(
    bars,
    bv.period,
    bv.stdDev,
    bv.cadence ?? "1d",
  );
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

function rsiSeriesOnBars(
  bars: OhlcBar[],
  period: number,
  cadence: "1d" | "1w",
): (number | null)[] {
  if (cadence === "1d") return rsi(closesFromBars(bars), period);
  const w = weeklyLastCloses(bars);
  if (w.length < period + 2) return bars.map(() => null);
  const wc = w.map((x) => x.close);
  const rw = rsi(wc, period);
  const map = new Map<string, number>();
  for (let j = 0; j < w.length; j++) {
    const v = rw[j];
    if (v != null) map.set(w[j].weekMonday, v);
  }
  return bars.map((b) => map.get(mondayKey(b.date)) ?? null);
}

export function computeSignalsRsiMeanReversion(
  bars: OhlcBar[],
  params: EtfParams,
): Signal[] {
  const rv = getRsiVariant(params);
  if (!rv || bars.length < rv.period + 2) return bars.map(() => "HOLD");
  const series = rsiSeriesOnBars(bars, rv.period, rv.cadence ?? "1d");
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
export function indicatorWarmupBars(
  params: EtfParams,
  strategyId: string,
): number {
  if (usesMaCustomStrategy(strategyId) && params.ma_custom_rule) {
    return Math.min(
      500,
      Math.max(40, params.ma_custom_rule.buyMaPeriod * 3 + 20),
    );
  }
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

/** 全日 K 重放与盘中合并序列共用：按 strategy_id 自动选 MA / MA自定义 / RSI / 布林带 */
export function computeSignals(
  bars: OhlcBar[],
  params: EtfParams,
  strategyId: string,
): Signal[] {
  if (usesMaCustomStrategy(strategyId))
    return computeSignalsMaCustom(bars, params);
  if (usesBollStrategy(strategyId))
    return computeSignalsBollingerMeanReversion(bars, params);
  if (usesRsiStrategy(strategyId))
    return computeSignalsRsiMeanReversion(bars, params);
  return computeSignalsMa(bars, params);
}

export function latestSignal(signals: Signal[]): Signal {
  for (let i = signals.length - 1; i >= 0; i--) {
    if (signals[i] !== "HOLD") return signals[i];
  }
  return "HOLD";
}
