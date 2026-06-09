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

/** 前端盘中重新拉取实时价的时点（仅用于刷新显示价；收盘价由盘后 Realtime crawler 落库） */
export const INTRADAY_BATCH_UPDATE_TIMES = ["11:00", "14:00"] as const;

/** 指数 T-1 盘后同步（Index T-1 sync），不用于 ETF 盘中价文案 */
export const INDEX_T1_SYNC_UPDATE_TIMES = ["18:30", "20:30"] as const;

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
    detail: last.date >= shanghaiTodayYmd() ? "增量价格" : "最新价格",
  };
}

async function fetchQuoteFromApiUrl(
  url: string,
  timeoutMs = 8000,
): Promise<LiveQuote | null> {
  // 实时价网关在境内手机网络可能很慢/被卡；必须超时，否则会一直挂着导致页面「加载中…」。
  // 超时返回 null，由 fetchLiveQuote 回退到本地 bars（昨收）。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "";
    // Pages 静态站无 /api 时 SPA 回退会返回 text/html，勿当作行情 JSON 解析。
    if (!ct.includes("application/json")) return null;
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
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSiteQuoteApi(code: string): Promise<LiveQuote | null> {
  // 同域优先（多数部署 Pages 无 /api/quote，会快速失败）；再走 Worker，限 8s 超时。
  const sameOrigin = await fetchQuoteFromApiUrl(
    `/api/quote?code=${encodeURIComponent(code)}`,
    4000,
  );
  if (sameOrigin) return sameOrigin;
  const base = configuredDataApiBaseUrl();
  if (!base) return null;
  return fetchQuoteFromApiUrl(
    `${base}/api/quote?code=${encodeURIComponent(code)}`,
    8000,
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
  if (site) return finalizeQuote(site, localBars);

  const remote = await fetchQuoteFromRemoteBars(code, localBars);
  if (remote) return finalizeQuote(remote, localBars);

  const local = quoteFromLocalBars(localBars);
  if (local) return finalizeQuote(local, localBars);

  const fallbackClose = localBars.at(-1)?.close;
  const now = new Date().toISOString();
  return finalizeQuote(
    {
      price:
        Number.isFinite(fallbackClose) && fallbackClose! > 0
          ? fallbackClose!
          : 1,
      tradeDate: localBars.at(-1)?.date ?? shanghaiTodayYmd(),
      quoteTime: now,
      fetchedAt: now,
      source: "local",
      detail: "暂无实时行情",
    },
    localBars,
  );
}

function finalizeQuote(quote: LiveQuote, bars: OhlcBar[]): LiveQuote {
  const tradeDate = resolveQuoteTradeDate(quote, bars);
  const prevClose = resolvePreviousClose(bars, quote);
  return {
    ...quote,
    tradeDate,
    prevClose: prevClose > 0 ? prevClose : quote.prevClose,
  };
}

export function formatQuoteSourceLabel(source: LiveQuoteSource): string {
  if (source === "eastmoney") return "东方财富实时";
  if (source === "sina") return "新浪实时";
  if (source === "tencent") return "腾讯实时";
  if (source === "web") return "行情 Web";
  if (source === "api") return "行情 API";
  return "最新价格";
}

export function formatQuoteDataUpdateLine(tradeDate: string): string {
  return `数据更新：盘中显示实时价，收盘价盘后回填，交易日 ${tradeDate}`;
}

/** 表格底部统一注释：交易日取当前北京时间会话日 */
export function formatQuoteDataUpdateFootnote(): string {
  return formatQuoteDataUpdateLine(shanghaiTodayYmd());
}

export function msUntilNextShanghaiBatchUpdate(): number {
  return Math.min(
    ...INTRADAY_BATCH_UPDATE_TIMES.map((hm) => msUntilNextShanghaiTime(hm)),
  );
}

export function msUntilNextShanghaiTime(hm: string): number {
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

export function isRealtimeQuoteSource(
  source: LiveQuoteSource | null | undefined,
): boolean {
  return source === "eastmoney" || source === "sina" || source === "tencent";
}

export function formatQuotePriceLabel(
  source: LiveQuoteSource | null | undefined,
): string {
  if (isRealtimeQuoteSource(source)) return "实时价";
  if (source === "web" || source === "api") return "最新价格";
  return "最新价格";
}

export function resolveQuoteTradeDate(
  quote: LiveQuote | null | undefined,
  bars: OhlcBar[],
): string {
  const today = shanghaiTodayYmd();
  const lastBarDate = sortedBarDates(bars).at(-1);

  if (quote?.tradeDate && quote.tradeDate >= today) {
    return quote.tradeDate;
  }
  // 日历已进入新交易日，但 CSV 仍停在 T-1：交易日展示为「当前会话日」
  if (lastBarDate && lastBarDate < today) {
    return today;
  }
  if (quote?.tradeDate) return quote.tradeDate;
  return lastBarDate ?? today;
}

function sortedBarDates(bars: OhlcBar[]): string[] {
  return [...bars]
    .filter((b) => Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((b) => b.date);
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

/** 上一交易日收盘价：优先行情源昨收；否则取 CSV 中 today 之前最后一根 K 的 close。 */
export function resolvePreviousClose(
  bars: OhlcBar[],
  quote?: LiveQuote | null,
): number {
  const today = shanghaiTodayYmd();
  const ydayClose = previousSessionCloseFromBars(bars, today);

  if (
    isRealtimeQuoteSource(quote?.source) &&
    quote?.tradeDate &&
    quote.tradeDate >= today &&
    typeof quote.prevClose === "number" &&
    Number.isFinite(quote.prevClose) &&
    quote.prevClose > 0
  ) {
    return quote.prevClose;
  }

  if (ydayClose != null) return ydayClose;

  if (quote?.tradeDate) {
    const beforeQuote = previousCloseFromBars(bars, quote.tradeDate);
    if (beforeQuote != null) return beforeQuote;
  }

  const sorted = [...bars]
    .filter((b) => Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length >= 2) return sorted[sorted.length - 2]!.close;
  if (sorted.length === 1) return sorted[0]!.close;
  return 1;
}

function previousSessionCloseFromBars(
  bars: OhlcBar[],
  today: string,
): number | undefined {
  const priorToday = [...bars]
    .filter((b) => Number.isFinite(b.close) && b.close > 0 && b.date < today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const ydayBar = priorToday.at(-1);
  return ydayBar?.close;
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
