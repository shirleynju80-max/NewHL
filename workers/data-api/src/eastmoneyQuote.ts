/** 场内 ETF 东财实时 quote（与 scripts/realtime_crawler 口径一致） */
export function inferEastmoneySecid(code: string): string | null {
  const c = code.trim();
  if (/^(50|51|52|53|56|58)/.test(c)) return `1.${c}`;
  if (/^(15|16|18)/.test(c)) return `0.${c}`;
  return null;
}

export type EastmoneyQuote = {
  ok: boolean;
  price?: number;
  prevClose?: number;
  tradeDate?: string;
  quoteTime?: string;
  source?: "eastmoney" | "sina" | "tencent";
  detail?: string;
};

export async function fetchEastmoneyQuote(code: string): Promise<EastmoneyQuote> {
  const secid = inferEastmoneySecid(code);
  if (!secid) return { ok: false, detail: "非场内 ETF 代码" };

  const url = `https://push2.eastmoney.com/api/qt/stock/get?${new URLSearchParams({
    secid,
    fields: "f43,f44,f45,f46,f60,f86",
  })}`;

  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json, text/plain, */*",
        Referer: "https://quote.eastmoney.com/",
      },
    });
    if (!r.ok) return { ok: false, detail: `东财 HTTP ${r.status}` };
    const payload = (await r.json()) as { data?: { f43?: number; f60?: number; f86?: number } };
    const data = payload?.data;
    const raw = data?.f43;
    if (raw == null || raw === 0 || Number.isNaN(Number(raw))) {
      return { ok: false, detail: "东财无有效现价" };
    }
    const price = Number(raw) / 1000;
    const rawPrevClose = Number(data?.f60);
    const prevClose =
      Number.isFinite(rawPrevClose) && rawPrevClose > 0
        ? rawPrevClose / 1000
        : undefined;
    const ts = data?.f86 ? Number(data.f86) : Math.floor(Date.now() / 1000);
    const quoteTime = new Date(ts * 1000).toISOString();
    const tradeDate = new Date(ts * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
    return { ok: true, price, prevClose, tradeDate, quoteTime, source: "eastmoney" };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

function marketPrefix(code: string): "sh" | "sz" | null {
  const c = code.trim();
  if (/^(50|51|52|53|56|58)/.test(c)) return "sh";
  if (/^(15|16|18)/.test(c)) return "sz";
  return null;
}

function parseSinaQuote(text: string): EastmoneyQuote {
  const m = text.match(/="([^"]*)"/);
  const cols = m?.[1]?.split(",") ?? [];
  const rawPrice = Number(cols[3]);
  const rawPrevClose = Number(cols[2]);
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
    return { ok: false, detail: "新浪无有效现价" };
  }
  const date = cols[30];
  const time = cols[31];
  const quoteTime =
    date && time ? new Date(`${date}T${time}+08:00`).toISOString() : new Date().toISOString();
  return {
    ok: true,
    price: rawPrice,
    prevClose:
      Number.isFinite(rawPrevClose) && rawPrevClose > 0
        ? rawPrevClose
        : undefined,
    tradeDate: date || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }),
    quoteTime,
    source: "sina",
  };
}

async function fetchSinaQuote(code: string): Promise<EastmoneyQuote> {
  const prefix = marketPrefix(code);
  if (!prefix) return { ok: false, detail: "新浪不支持该代码" };
  const url = `https://hq.sinajs.cn/list=${prefix}${code.trim()}`;
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://finance.sina.com.cn/",
      },
    });
    if (!r.ok) return { ok: false, detail: `新浪 HTTP ${r.status}` };
    return parseSinaQuote(await r.text());
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

function parseTencentQuote(text: string): EastmoneyQuote {
  const m = text.match(/="([^"]*)"/);
  const cols = m?.[1]?.split("~") ?? [];
  const rawPrice = Number(cols[3]);
  const rawPrevClose = Number(cols[4]);
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
    return { ok: false, detail: "腾讯无有效现价" };
  }
  const rawTime = cols[30] ?? "";
  const date =
    rawTime.length >= 8
      ? `${rawTime.slice(0, 4)}-${rawTime.slice(4, 6)}-${rawTime.slice(6, 8)}`
      : new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const quoteTime =
    rawTime.length >= 14
      ? new Date(
          `${date}T${rawTime.slice(8, 10)}:${rawTime.slice(10, 12)}:${rawTime.slice(12, 14)}+08:00`,
        ).toISOString()
      : new Date().toISOString();
  return {
    ok: true,
    price: rawPrice,
    prevClose:
      Number.isFinite(rawPrevClose) && rawPrevClose > 0
        ? rawPrevClose
        : undefined,
    tradeDate: date,
    quoteTime,
    source: "tencent",
  };
}

async function fetchTencentQuote(code: string): Promise<EastmoneyQuote> {
  const prefix = marketPrefix(code);
  if (!prefix) return { ok: false, detail: "腾讯不支持该代码" };
  const url = `https://qt.gtimg.cn/q=${prefix}${code.trim()}`;
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://gu.qq.com/",
      },
    });
    if (!r.ok) return { ok: false, detail: `腾讯 HTTP ${r.status}` };
    return parseTencentQuote(await r.text());
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchRealtimeQuote(code: string): Promise<EastmoneyQuote> {
  const eastmoney = await fetchEastmoneyQuote(code);
  if (eastmoney.ok) return eastmoney;
  const sina = await fetchSinaQuote(code);
  if (sina.ok) return sina;
  const tencent = await fetchTencentQuote(code);
  if (tencent.ok) return tencent;
  return {
    ok: false,
    detail: [eastmoney.detail, sina.detail, tencent.detail]
      .filter(Boolean)
      .join("；"),
  };
}
