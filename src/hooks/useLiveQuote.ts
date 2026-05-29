import { useCallback, useEffect, useState } from "react";
import {
  fetchLiveQuote,
  formatQuoteFetchedAt,
  formatQuoteSourceLabel,
  type LiveQuote,
} from "../lib/liveQuote";
import type { OhlcBar } from "../types";

function msUntilNextShanghaiTime(hm: string): number {
  const [hh, mm] = hm.split(":").map((x) => Number(x));
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const current =
    ((part("hour") * 60 + part("minute")) * 60 + part("second")) * 1000;
  const target = (hh * 60 + mm) * 60 * 1000;
  const day = 24 * 60 * 60 * 1000;
  const delta = target - current;
  return delta > 0 ? delta : delta + day;
}

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
    let interval: number | null = null;
    const timeout = window.setTimeout(() => {
      void refresh();
      interval = window.setInterval(() => void refresh(), 24 * 60 * 60 * 1000);
    }, msUntilNextShanghaiTime("14:00"));
    return () => {
      window.clearTimeout(timeout);
      if (interval != null) window.clearInterval(interval);
    };
  }, [enabled, code, refresh]);

  const footerLine = quote
    ? `数据更新：${formatQuoteFetchedAt(quote.fetchedAt)} · ${formatQuoteSourceLabel(quote.source)} · 交易日 ${quote.tradeDate}`
    : null;

  return {
    quote,
    loading,
    error,
    refresh,
    footerLine,
    price: quote?.price ?? null,
  };
}
