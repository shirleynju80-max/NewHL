import { describe, expect, it } from "vitest";
import { bollinger, closesFromBars, rsi, sma } from "./indicators";
import type { OhlcBar } from "../types";

describe("sma", () => {
  it("returns null until the window is full, then the rolling mean", () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
  });

  it("is all-null when the series is shorter than the period", () => {
    expect(sma([1, 2], 3)).toEqual([null, null]);
  });

  it("handles an empty series", () => {
    expect(sma([], 5)).toEqual([]);
  });
});

describe("rsi", () => {
  it("is all-null when there are fewer than period+1 closes", () => {
    expect(rsi([1, 2, 3], 14)).toEqual([1, 2, 3].map(() => null));
  });

  it("nulls the warm-up window and starts at index = period", () => {
    const out = rsi([1, 2, 3, 4, 5], 3);
    expect(out.slice(0, 3)).toEqual([null, null, null]);
    expect(out[3]).not.toBeNull();
  });

  it("returns 100 for a monotonically rising series (no losses)", () => {
    const out = rsi([1, 2, 3, 4, 5], 3);
    expect(out[3]).toBe(100);
    expect(out[4]).toBe(100);
  });
});

describe("bollinger", () => {
  it("collapses upper/lower onto the mid when volatility is zero", () => {
    const { mid, upper, lower } = bollinger([5, 5, 5, 5], 2, 2);
    expect(mid).toEqual([null, 5, 5, 5]);
    expect(upper).toEqual([null, 5, 5, 5]);
    expect(lower).toEqual([null, 5, 5, 5]);
  });

  it("places bands symmetrically around the mid by stdMult * sd", () => {
    // window [2,4]: mean 3, population sd = 1 → ±2*1
    const { mid, upper, lower } = bollinger([2, 4], 2, 2);
    expect(mid[1]).toBe(3);
    expect(upper[1]).toBe(5);
    expect(lower[1]).toBe(1);
  });
});

describe("closesFromBars", () => {
  it("extracts the close field in order", () => {
    const bars: OhlcBar[] = [
      { date: "2024-01-01", open: 1, high: 2, low: 0.5, close: 1.5 },
      { date: "2024-01-02", open: 1.5, high: 2.5, low: 1, close: 2 },
    ];
    expect(closesFromBars(bars)).toEqual([1.5, 2]);
  });
});
