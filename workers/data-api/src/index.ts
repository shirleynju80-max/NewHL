import { fetchRealtimeQuote } from "./eastmoneyQuote";

export interface Env {
  DATA_BUCKET: R2Bucket;
  ALLOWED_ORIGIN?: string;
}

const FILES = {
  etfs: "etfs.csv",
  bars: "bars.csv",
  bonds: "bonds.csv",
  etfParams: "etf_params.csv",
  etfsMore: "etfsmore.csv",
  barsMore: "barsmore.csv",
  bondsMore: "bondsmore.csv",
  fundBars: "fund_bars.csv",
  etfProducts: "etf_products.csv",
  indices: "indices.csv",
  indexBars: "index_bars.csv",
  indexTrackingEtfs: "index_tracking_etfs.csv",
  etfDividends: "etf_dividends.csv",
  etfAdjustedBarsMeta: "etf_adjusted_bars_meta.json",
} as const;

type FileKey = keyof typeof FILES;

function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    },
  });
}

async function readText(bucket: R2Bucket, key: string): Promise<string> {
  const obj = await bucket.get(key);
  if (!obj) return "";
  return await obj.text();
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const configuredOrigin = env.ALLOWED_ORIGIN || "*";
    const origin = configuredOrigin === "*" ? "*" : request.headers.get("Origin") || configuredOrigin;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/quote") {
      const code = url.searchParams.get("code")?.trim() ?? "";
      if (!code) return json({ ok: false, detail: "missing code" }, 400, origin);

      // 同一 code 在边缘缓存 30s，所有用户共享一份，避免上游 quote 接口被聚合 QPS 限速。
      // 缓存键只按 code（与请求 Origin/CORS 解耦），命中后用当前 Origin 重新封装。
      const cache = caches.default;
      const cacheKey = new Request(new URL(`/__quote/${encodeURIComponent(code)}`, url.origin).toString());
      const cached = await cache.match(cacheKey);
      if (cached) {
        return json(await cached.json(), 200, origin);
      }

      const q = await fetchRealtimeQuote(code);
      if (!q.ok) return json({ ok: false, detail: q.detail ?? "quote failed" }, 502, origin);
      const payload = {
        ok: true,
        price: q.price,
        prevClose: q.prevClose,
        tradeDate: q.tradeDate,
        quoteTime: q.quoteTime,
        source: q.source,
      };
      ctx.waitUntil(
        cache.put(
          cacheKey,
          new Response(JSON.stringify(payload), {
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "public, max-age=30",
            },
          }),
        ),
      );
      return json(payload, 200, origin);
    }

    if (request.method !== "GET" || url.pathname !== "/api/bundle") {
      return json({ error: "not_found" }, 404, origin);
    }

    const files: Partial<Record<FileKey, string>> = {};
    await Promise.all(
      (Object.keys(FILES) as FileKey[]).map(async (name) => {
        files[name] = await readText(env.DATA_BUCKET, FILES[name]);
      })
    );

    if (!files.bars?.trim()) {
      return json({ error: "missing_required_data", message: "R2 object bars.csv is required" }, 503, origin);
    }

    return json({ generatedAt: new Date().toISOString(), files }, 200, origin);
  },
};
