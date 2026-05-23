import { configuredDataApiBaseUrl } from "../api/dataBundle";
import { tryWebThenApiBars } from "./marketDataSync";
import type { OhlcBar } from "../types";

export type LiveQuoteSource = "eastmoney" | "web" | "api" | "local";

export type LiveQuote = {
  price: number;
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
  return {
    price: last.close,
    tradeDate: last.date,
    quoteTime: now,
    fetchedAt: now,
    source: "local",
    detail: last.date >= shanghaiTodayYmd() ? "本地 barsmore 当日定点" : "本地最新收盘",
  };
}

async function fetchQuoteFromApiUrl(url: string): Promise<LiveQuote | null> {
  try {
    const r = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const j = (await r.json()) as QuoteApiPayload;
    if (!j.ok || typeof j.price !== "number" || !Number.isFinite(j.price) || j.price <= 0) return null;
    const fetchedAt = new Date().toISOString();
    return {
      price: j.price,
      tradeDate: j.tradeDate ?? shanghaiTodayYmd(),
      quoteTime: j.quoteTime ?? fetchedAt,
      fetchedAt,
      source: j.source === "eastmoney" ? "eastmoney" : j.source === "api" ? "api" : "web",
      detail: j.detail,
    };
  } catch {
    return null;
  }
}

async function fetchSiteQuoteApi(code: string): Promise<LiveQuote | null> {
  const sameOrigin = await fetchQuoteFromApiUrl(`/api/quote?code=${encodeURIComponent(code)}`);
  if (sameOrigin) return sameOrigin;
  const base = configuredDataApiBaseUrl();
  if (!base) return null;
  return fetchQuoteFromApiUrl(`${base}/api/quote?code=${encodeURIComponent(code)}`);
}

async function fetchQuoteFromRemoteBars(code: string, localBars: OhlcBar[]): Promise<LiveQuote | null> {
  const remote = await tryWebThenApiBars(code, localBars);
  if (!remote.ok || !remote.bars?.length) return null;
  const sorted = [...remote.bars].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1]!;
  if (!Number.isFinite(last.close) || last.close <= 0) return null;
  const fetchedAt = new Date().toISOString();
  return {
    price: last.close,
    tradeDate: last.date,
    quoteTime: fetchedAt,
    fetchedAt,
    source: remote.source === "api" ? "api" : "web",
    detail: remote.detail,
  };
}

/** 解析最新价：东财/网关实时 → 行情 API 日 K → 本地合并 K 线。 */
export async function fetchLiveQuote(code: string, localBars: OhlcBar[]): Promise<LiveQuote> {
  const site = await fetchSiteQuoteApi(code);
  if (site) return site;

  const remote = await fetchQuoteFromRemoteBars(code, localBars);
  if (remote) return remote;

  const local = quoteFromLocalBars(localBars);
  if (local) return local;

  const fallbackClose = localBars.at(-1)?.close;
  const now = new Date().toISOString();
  return {
    price: Number.isFinite(fallbackClose) && fallbackClose! > 0 ? fallbackClose! : 1,
    tradeDate: localBars.at(-1)?.date ?? shanghaiTodayYmd(),
    quoteTime: now,
    fetchedAt: now,
    source: "local",
    detail: "无可用实时源，价格无效",
  };
}

export function formatQuoteSourceLabel(source: LiveQuoteSource): string {
  if (source === "eastmoney") return "东方财富实时";
  if (source === "web") return "行情 Web";
  if (source === "api") return "行情 API";
  return "本地收盘";
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
