import { configuredDataApiBaseUrl } from "../api/dataBundle";
import { tryWebThenApiBars } from "./marketDataSync";
import type { OhlcBar } from "../types";

export type LiveQuoteSource =
  | "eastmoney"
  | "sina"
  | "tencent"
  | "web"
  | "api"
  | "local";

export type LiveQuote = {
  price: number;
  prevClose?: number;
  tradeDate: string;
  /** 行情源侧时间戳（ISO），无则同 fetchedAt */
  quoteTime: string;
  fetchedAt: string;
  source: LiveQuoteSource;
  detail?: string;
};

type QuoteApiPayload = {
  ok?: boolean;
  price?: number;
  prevClose?: number;
  tradeDate?: string;
  quoteTime?: string;
  source?: LiveQuoteSource;
  detail?: string;
};

function shanghaiTodayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

export function quoteFromLocalBars(bars: OhlcBar[]): LiveQuote | null {
  if (!bars.length) return null;
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1]!;
  if (!Number.isFinite(last.close) || last.close <= 0) return null;
  const now = new Date().toISOString();
  const prev = sorted[sorted.length - 2]?.close;
  return {
    price: last.close,
    prevClose: Number.isFinite(prev) && prev! > 0 ? prev : undefined,
    tradeDate: last.date,
    quoteTime: now,
    fetchedAt: now,
    source: "local",
    detail:
      last.date >= shanghaiTodayYmd()
        ? "本地 barsmore 当日定点"
        : "本地最新收盘",
  };
}

async function fetchQuoteFromApiUrl(url: string): Promise<LiveQuote | null> {
  try {
    const r = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as QuoteApiPayload;
    if (
      !j.ok ||
      typeof j.price !== "number" ||
      !Number.isFinite(j.price) ||
      j.price <= 0
    )
      return null;
    const fetchedAt = new Date().toISOString();
    return {
      price: j.price,
      prevClose:
        typeof j.prevClose === "number" &&
        Number.isFinite(j.prevClose) &&
        j.prevClose > 0
          ? j.prevClose
          : undefined,
      tradeDate: j.tradeDate ?? shanghaiTodayYmd(),
      quoteTime: j.quoteTime ?? fetchedAt,
      fetchedAt,
      source:
        j.source === "eastmoney"
          ? "eastmoney"
          : j.source === "sina"
            ? "sina"
            : j.source === "tencent"
              ? "tencent"
          : j.source === "api"
            ? "api"
            : "web",
      detail: j.detail,
    };
  } catch {
    return null;
  }
}

async function fetchSiteQuoteApi(code: string): Promise<LiveQuote | null> {
  const sameOrigin = await fetchQuoteFromApiUrl(
    `/api/quote?code=${encodeURIComponent(code)}`,
  );
  if (sameOrigin) return sameOrigin;
  const base = configuredDataApiBaseUrl();
  if (!base) return null;
  return fetchQuoteFromApiUrl(
    `${base}/api/quote?code=${encodeURIComponent(code)}`,
  );
}

async function fetchQuoteFromRemoteBars(
  code: string,
  localBars: OhlcBar[],
): Promise<LiveQuote | null> {
  const remote = await tryWebThenApiBars(code, localBars);
  if (!remote.ok || !remote.bars?.length) return null;
  const sorted = [...remote.bars].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1]!;
  if (!Number.isFinite(last.close) || last.close <= 0) return null;
  const fetchedAt = new Date().toISOString();
  const prev = sorted[sorted.length - 2]?.close;
  return {
    price: last.close,
    prevClose: Number.isFinite(prev) && prev! > 0 ? prev : undefined,
    tradeDate: last.date,
    quoteTime: fetchedAt,
    fetchedAt,
    source: remote.source === "api" ? "api" : "web",
    detail: remote.detail,
  };
}

/** 解析最新价：实时源/网关 → 行情 API 日 K → 本地合并 K 线。 */
export async function fetchLiveQuote(
  code: string,
  localBars: OhlcBar[],
): Promise<LiveQuote> {
  const site = await fetchSiteQuoteApi(code);
  if (site) return site;

  const remote = await fetchQuoteFromRemoteBars(code, localBars);
  if (remote) return remote;

  const local = quoteFromLocalBars(localBars);
  if (local) return local;

  const fallbackClose = localBars.at(-1)?.close;
  const now = new Date().toISOString();
  return {
    price:
      Number.isFinite(fallbackClose) && fallbackClose! > 0 ? fallbackClose! : 1,
    prevClose: previousCloseFromBars(localBars),
    tradeDate: localBars.at(-1)?.date ?? shanghaiTodayYmd(),
    quoteTime: now,
    fetchedAt: now,
    source: "local",
    detail: "无可用实时源，价格无效",
  };
}

export function formatQuoteSourceLabel(source: LiveQuoteSource): string {
  if (source === "eastmoney") return "东方财富实时";
  if (source === "sina") return "新浪实时";
  if (source === "tencent") return "腾讯实时";
  if (source === "web") return "行情 Web";
  if (source === "api") return "行情 API";
  return "本地收盘";
}

export function isRealtimeQuoteSource(
  source: LiveQuoteSource | null | undefined,
): boolean {
  return source === "eastmoney" || source === "sina" || source === "tencent";
}

export function formatQuotePriceLabel(
  source: LiveQuoteSource | null | undefined,
): string {
  if (isRealtimeQuoteSource(source)) return "实时价";
  if (source === "web" || source === "api") return "最新日 K";
  return "本地收盘";
}

function previousCloseFromBars(
  bars: OhlcBar[],
  beforeDate?: string,
): number | undefined {
  const sorted = [...bars]
    .filter((b) => Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return undefined;
  const candidates = beforeDate
    ? sorted.filter((b) => b.date < beforeDate)
    : sorted;
  const prev = candidates[candidates.length - 1]?.close;
  return Number.isFinite(prev) && prev! > 0 ? prev : undefined;
}

export function resolvePreviousClose(
  bars: OhlcBar[],
  quote?: LiveQuote | null,
): number {
  if (
    typeof quote?.prevClose === "number" &&
    Number.isFinite(quote.prevClose) &&
    quote.prevClose > 0
  ) {
    return quote.prevClose;
  }
  const beforeQuoteDate = quote?.tradeDate
    ? previousCloseFromBars(bars, quote.tradeDate)
    : undefined;
  if (beforeQuoteDate != null) return beforeQuoteDate;

  const sorted = [...bars]
    .filter((b) => Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return 1;
  const last = sorted[sorted.length - 1]!;
  if (last.date >= shanghaiTodayYmd() && sorted.length >= 2) {
    return sorted[sorted.length - 2]!.close;
  }
  return last.close;
}

export function formatQuoteFetchedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour12: false,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}
