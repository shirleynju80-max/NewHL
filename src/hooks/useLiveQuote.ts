import { useCallback, useEffect, useState } from "react";
import {
  fetchLiveQuote,
  formatQuoteFetchedAt,
  formatQuoteSourceLabel,
  type LiveQuote,
} from "../lib/liveQuote";
import type { OhlcBar } from "../types";

export function useLiveQuote(code: string | undefined, bars: OhlcBar[], enabled = true) {
  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!code || !bars.length) {
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
  }, [code, bars]);

  useEffect(() => {
    if (!enabled || !code) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [enabled, code, refresh]);

  const footerLine = quote
    ? `数据更新：${formatQuoteFetchedAt(quote.fetchedAt)} · ${formatQuoteSourceLabel(quote.source)} · 交易日 ${quote.tradeDate}`
    : null;

  return { quote, loading, error, refresh, footerLine, price: quote?.price ?? null };
}
