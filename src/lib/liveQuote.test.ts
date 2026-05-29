import { describe, expect, it, vi } from "vitest";
import {
  resolvePreviousClose,
  resolveQuoteTradeDate,
} from "./liveQuote";
import type { OhlcBar } from "../types";

function bar(date: string, close: number): OhlcBar {
  return { date, open: close, high: close, low: close, close };
}

describe("resolvePreviousClose", () => {
  it("uses last bar close before calendar today as official previous close", () => {
    const bars = [
      bar("2026-05-27", 1.415),
      bar("2026-05-28", 1.404),
    ];
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T13:50:00+08:00"));

    expect(resolvePreviousClose(bars, null)).toBe(1.404);

    vi.useRealTimers();
  });

  it("uses calendar yesterday when bars stop at T-1 on a new session day", () => {
    const bars = [bar("2026-05-27", 1.0), bar("2026-05-28", 1.1)];
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T05:50:00+08:00"));

    expect(resolvePreviousClose(bars, null)).toBe(1.1);
    expect(resolveQuoteTradeDate(null, bars)).toBe("2026-05-29");

    vi.useRealTimers();
  });

  it("trusts realtime prevClose on the current session day", () => {
    const bars = [bar("2026-05-27", 1.0), bar("2026-05-28", 1.1)];
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T13:50:00+08:00"));

    expect(
      resolvePreviousClose(bars, {
        price: 1.15,
        prevClose: 1.1,
        tradeDate: "2026-05-29",
        quoteTime: "2026-05-29T05:50:00.000Z",
        fetchedAt: "2026-05-29T05:50:00.000Z",
        source: "eastmoney",
      }),
    ).toBe(1.1);

    vi.useRealTimers();
  });
});
