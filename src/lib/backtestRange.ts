import type { EtfParams, OhlcBar, TradePoint } from "../types";
import { buildTrades } from "./backtest";
import type { Signal } from "./strategy";
import { computeSignals, indicatorWarmupBars } from "./strategy";

export type WindowedBacktest = {
  barsWin: OhlcBar[];
  signalsWin: Signal[];
  tradesWin: TradePoint[];
  i0: number;
  i1: number;
};

/**
 * 在 [i0, i1] 可见区间内重放：向前取 warmup 根 K 仅用于指标，信号与成交与 barsWin 对齐。
 */
export function computeWindowedBacktest(
  bars: OhlcBar[],
  params: EtfParams,
  strategyId: string,
  paramVersion: string,
  i0: number,
  i1: number
): WindowedBacktest {
  const n = bars.length;
  if (n === 0) {
    return { barsWin: [], signalsWin: [], tradesWin: [], i0: 0, i1: 0 };
  }
  const a = Math.max(0, Math.min(i0, n - 1));
  const b = Math.max(a, Math.min(i1, n - 1));
  const warm = indicatorWarmupBars(params, strategyId);
  const iFrom = Math.max(0, a - warm);
  const chunk = bars.slice(iFrom, b + 1);
  const sigChunk = computeSignals(chunk, params, strategyId);
  const off = a - iFrom;
  const winLen = b - a + 1;
  const sigWin = sigChunk.slice(off, off + winLen);
  const barsWin = bars.slice(a, b + 1);
  const tradesWin = buildTrades(barsWin, sigWin, paramVersion, strategyId);
  return { barsWin, signalsWin: sigWin, tradesWin, i0: a, i1: b };
}
