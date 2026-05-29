import { useCallback, useEffect, useState } from "react";
import {
  fetchLiveQuote,
  formatQuoteDataUpdateLine,
  msUntilNextShanghaiBatchUpdate,
  resolveQuoteTradeDate,
  type LiveQuote,
} from "../lib/liveQuote";
import type { OhlcBar } from "../types";

export function useLiveQuote(
  code: string | undefined,
  bars: OhlcBar[],
  enabled = true,
) {
  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const barCount = bars.length;
  const lastBarDate = barCount ? bars[barCount - 1]!.date : "";

  const refresh = useCallback(async () => {
    if (!code || !barCount) {
      setQuote(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const q = await fetchLiveQuote(code, bars);
      setQuote(q);
      if (q.detail?.includes("无效")) setError(q.detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [code, barCount, lastBarDate, bars]);

  useEffect(() => {
    if (!enabled || !code) return;
    void refresh();
    let handle: number | null = null;
    const schedule = () => {
      handle = window.setTimeout(() => {
        void refresh().finally(schedule);
      }, msUntilNextShanghaiBatchUpdate());
    };
    schedule();
    return () => {
      if (handle != null) window.clearTimeout(handle);
    };
  }, [enabled, code, refresh]);

  const tradeDate = resolveQuoteTradeDate(quote, bars);
  const footerLine = formatQuoteDataUpdateLine(tradeDate);

  return {
    quote,
    loading,
    error,
    footerLine,
    tradeDate,
    price: quote?.price ?? null,
  };
}
