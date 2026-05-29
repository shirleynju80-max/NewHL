import { describe, expect, it } from "vitest";
import {
  empiricalPercentile,
  strategyPercentileContext,
} from "./indicatorPercentile";
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

describe("empiricalPercentile", () => {
  it("counts the share of samples <= x", () => {
    expect(empiricalPercentile([1, 2, 3, 4], 2)).toBe(50);
  });

  it("defaults to 50 on an empty history", () => {
    expect(empiricalPercentile([], 3)).toBe(50);
  });
});

describe("strategyPercentileContext", () => {
  it("returns null with fewer than 3 bars", () => {
    expect(
      strategyPercentileContext(barsFromCloses([10, 10]), makeParams(), "ma"),
    ).toBeNull();
  });

  it("maps a flat MA spread to the neutral midpoint of the scale", () => {
    const ctx = strategyPercentileContext(
      barsFromCloses([10, 10, 10, 10, 10]),
      makeParams(),
      "ma",
    );
    expect(ctx?.metricName).toBe("MA价差%");
    expect(ctx?.percentile).toBe(50);
    expect(ctx?.zone).toBe("neutral");
  });

  it("flags the buy side when fast falls well below slow", () => {
    const ctx = strategyPercentileContext(
      barsFromCloses([10, 10, 10, 9, 8]),
      makeParams(),
      "ma",
    );
    expect(ctx?.zone).toBe("buy_hint");
    expect(ctx?.percentile).toBe(0);
  });

  it("returns null for a zero-width bollinger band (flat series)", () => {
    const ctx = strategyPercentileContext(
      barsFromCloses([5, 5, 5, 5, 5]),
      makeParams(),
      "boll_1d",
    );
    expect(ctx).toBeNull();
  });
});
