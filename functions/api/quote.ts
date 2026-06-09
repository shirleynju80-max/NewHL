// Cloudflare Pages Function：同源 /api/quote（静态 Pages 无此路由时会 SPA 回退成 HTML）。
import { fetchRealtimeQuote } from "../../workers/data-api/src/eastmoneyQuote";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=30",
};

export const onRequestGet = async (context: {
  request: Request;
  waitUntil: (promise: Promise<unknown>) => void;
}): Promise<Response> => {
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code")?.trim() ?? "";
  if (!code) {
    return new Response(JSON.stringify({ ok: false, detail: "missing code" }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  // pages.dev 上 caches.default 可能不可用；有则用，无则直拉上游。
  const cache = typeof caches !== "undefined" ? caches.default : undefined;
  const cacheKey = new Request(
    new URL(`/__quote/${encodeURIComponent(code)}`, url.origin).toString(),
  );
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return new Response(cached.body, {
        status: 200,
        headers: JSON_HEADERS,
      });
    }
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
  if (cache) {
    context.waitUntil(
      cache.put(cacheKey, new Response(body, { headers: JSON_HEADERS })),
    );
  }
  return new Response(body, { status: 200, headers: JSON_HEADERS });
};
