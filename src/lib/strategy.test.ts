import { describe, expect, it } from "vitest";
import {
  computeSignals,
  computeSignalsMa,
  computeSignalsMaCustom,
  latestSignal,
  mergeIntraday1345,
  usesBollStrategy,
  usesMaCustomStrategy,
  usesRsiStrategy,
} from "./strategy";
import type { EtfParams, OhlcBar } from "../types";

const bar = (date: string, close: number): OhlcBar => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
});
const barsFromCloses = (closes: number[]): OhlcBar[] =>
  closes.map((c, i) => bar(`2024-01-${String(i + 1).padStart(2, "0")}`, c));

function makeParams(over: Partial<EtfParams> = {}): EtfParams {
  return {
    ma_variants: [{ variant_id: "ma", fast: 2, slow: 3 }],
    rsi_variants: [
      { variant_id: "rsi", period: 3, overbought: 70, oversold: 30 },
    ],
    bollinger_variants: [{ variant_id: "boll", period: 2, stdDev: 2 }],
    strategy_ma_ids: ["ma", "ma"],
    strategy_rsi_id: "rsi",
    ...over,
  };
}

describe("strategy id classification", () => {
  it("recognises ma_custom / boll / rsi and excludes rsi from boll ids", () => {
    expect(usesMaCustomStrategy("ma_custom_v1")).toBe(true);
    expect(usesBollStrategy("boll_1d")).toBe(true);
    expect(usesRsiStrategy("rsi_csv")).toBe(true);
    // "boll" must not be misread as an RSI strategy
    expect(usesRsiStrategy("boll_1d")).toBe(false);
  });
});

describe("computeSignalsMa", () => {
  it("returns all HOLD when there are too few bars", () => {
    const sig = computeSignalsMa(
      barsFromCloses([10, 10, 10, 10]),
      makeParams(),
    );
    expect(sig).toEqual(["HOLD", "HOLD", "HOLD", "HOLD"]);
  });

  it("emits BUY on a golden cross of fast over slow", () => {
    const sig = computeSignalsMa(
      barsFromCloses([10, 9, 8, 9, 11, 13]),
      makeParams(),
    );
    expect(sig[4]).toBe("BUY");
  });
});

describe("computeSignalsMaCustom (buy on MA cross, sell on take-profit OR trailing drawdown)", () => {
  const rule = { buyMaPeriod: 2, profitTakePct: 10, trailDrawdownPct: 5 };
  const params = makeParams({ ma_custom_rule: rule });

  it("buys when close crosses above the MA", () => {
    const sig = computeSignalsMaCustom(
      barsFromCloses([10, 10, 10, 12, 13]),
      params,
    );
    expect(sig[3]).toBe("BUY");
    expect(sig[4]).toBe("HOLD"); // +8.3% gain, no exit yet
  });

  it("sells when the take-profit threshold is reached", () => {
    const sig = computeSignalsMaCustom(
      barsFromCloses([10, 10, 10, 12, 14]),
      params,
    );
    expect(sig[4]).toBe("SELL"); // +16.7% >= 10%
  });

  it("sells when the trailing drawdown from peak is reached", () => {
    const sig = computeSignalsMaCustom(
      barsFromCloses([10, 10, 10, 12, 12, 11]),
      params,
    );
    expect(sig[5]).toBe("SELL"); // peak 12 → 11 = 8.3% drawdown >= 5%
  });
});

describe("computeSignals dispatch", () => {
  it("routes ma_custom ids to the custom engine", () => {
    const rule = { buyMaPeriod: 2, profitTakePct: 10, trailDrawdownPct: 5 };
    const params = makeParams({ ma_custom_rule: rule });
    const bars = barsFromCloses([10, 10, 10, 12, 14]);
    expect(computeSignals(bars, params, "ma_custom_v1")).toEqual(
      computeSignalsMaCustom(bars, params),
    );
  });
});

describe("mergeIntraday1345", () => {
  it("rewrites the last bar's close and stretches high/low to include it", () => {
    const bars: OhlcBar[] = [
      { date: "2024-01-01", open: 10, high: 11, low: 9, close: 10.5 },
    ];
    const merged = mergeIntraday1345(bars, 12);
    expect(merged[0].close).toBe(12);
    expect(merged[0].high).toBe(12); // max(open 10, high 11, last 12)
    expect(merged[0].low).toBe(9); // min(open 10, low 9, last 12)
    // original is not mutated
    expect(bars[0].close).toBe(10.5);
  });

  it("returns the input unchanged for an empty series", () => {
    expect(mergeIntraday1345([], 12)).toEqual([]);
  });
});

describe("latestSignal", () => {
  it("returns the most recent non-HOLD signal", () => {
    expect(latestSignal(["HOLD", "BUY", "HOLD", "SELL", "HOLD"])).toBe("SELL");
  });

  it("returns HOLD when there is no actionable signal", () => {
    expect(latestSignal(["HOLD", "HOLD"])).toBe("HOLD");
  });
});
