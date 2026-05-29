import { describe, expect, it } from "vitest";
import {
  buildEquitySeries,
  buildTrades,
  performanceFromTrades,
} from "./backtest";
import { buildRoundTrips } from "./backtestSummary";
import type { OhlcBar } from "../types";
import type { Signal } from "./strategy";

const bar = (date: string, close: number): OhlcBar => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
});

describe("buildTrades", () => {
  it("ignores duplicate BUY: round PnL and holdDays use first entry only", () => {
    const bars = Array.from({ length: 24 }, (_, i) => {
      const d = new Date(Date.UTC(2020, 0, 2 + i));
      return bar(d.toISOString().slice(0, 10), 1 + i * 0.01);
    });
    const signals = Array<Signal>(bars.length).fill("HOLD");
    signals[0] = "BUY";
    signals[10] = "BUY";
    signals[23] = "SELL";

    const trades = buildTrades(bars, signals, "v1", "rsi_1d");
    const rounds = buildRoundTrips(trades);
    const perf = performanceFromTrades(trades);

    expect(trades.filter((t) => t.side === "BUY")).toHaveLength(1);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({
      buyDate: bars[0]!.date,
      buyPrice: bars[0]!.close,
      sellDate: bars[23]!.date,
      sellPrice: bars[23]!.close,
      holdDays: 23,
      pnlPct: Math.round(((bars[23]!.close - bars[0]!.close) / bars[0]!.close) * 10000) / 100,
    });

    const eq = buildEquitySeries(bars, trades);
    expect(perf.cumReturnPct).toBeCloseTo((eq[eq.length - 1]! - 1) * 100, 2);
  });
});
