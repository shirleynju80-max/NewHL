// Cloudflare Pages Function：同源 /api/quote，避免静态站 SPA 回退把 HTML 当行情。
// 境内 users.dev 可能不可达，但 pages.dev 同域小 JSON 请求通常可达。
import { fetchRealtimeQuote } from "../../workers/data-api/src/eastmoneyQuote";

type PagesContext = {
  request: Request;
  waitUntil: (promise: Promise<unknown>) => void;
  caches: { default: Cache };
};

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=30",
};

export const onRequestGet = async (
  context: PagesContext,
): Promise<Response> => {
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code")?.trim() ?? "";
  if (!code) {
    return new Response(JSON.stringify({ ok: false, detail: "missing code" }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const cache = context.caches.default;
  const cacheKey = new Request(
    new URL(`/__quote/${encodeURIComponent(code)}`, url.origin).toString(),
  );
  const cached = await cache.match(cacheKey);
  if (cached) {
    return new Response(cached.body, {
      status: 200,
      headers: JSON_HEADERS,
    });
  }

  const q = await fetchRealtimeQuote(code);
  if (!q.ok) {
    return new Response(
      JSON.stringify({ ok: false, detail: q.detail ?? "quote failed" }),
      { status: 502, headers: JSON_HEADERS },
    );
  }
  const payload = {
    ok: true,
    price: q.price,
    prevClose: q.prevClose,
    tradeDate: q.tradeDate,
    quoteTime: q.quoteTime,
    source: q.source,
  };
  const body = JSON.stringify(payload);
  context.waitUntil(
    cache.put(cacheKey, new Response(body, { headers: JSON_HEADERS })),
  );
  return new Response(body, { status: 200, headers: JSON_HEADERS });
};
