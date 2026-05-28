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
  async fetch(request: Request, env: Env): Promise<Response> {
    const configuredOrigin = env.ALLOWED_ORIGIN || "*";
    const origin = configuredOrigin === "*" ? "*" : request.headers.get("Origin") || configuredOrigin;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/quote") {
      const code = url.searchParams.get("code")?.trim() ?? "";
      if (!code) return json({ ok: false, detail: "missing code" }, 400, origin);
      const q = await fetchRealtimeQuote(code);
      if (!q.ok) return json({ ok: false, detail: q.detail ?? "quote failed" }, 502, origin);
      return json(
        {
          ok: true,
          price: q.price,
          prevClose: q.prevClose,
          tradeDate: q.tradeDate,
          quoteTime: q.quoteTime,
          source: q.source,
        },
        200,
        origin
      );
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
