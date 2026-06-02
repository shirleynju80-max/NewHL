// 境内单机托管的实时价服务：同源 /api/quote，复用 worker 同款抓取逻辑（东财→新浪→腾讯）。
// 用 tsx 直跑 TS，避免与 workers/data-api/src/eastmoneyQuote.ts 逻辑重复。
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fetchRealtimeQuote } from "../../workers/data-api/src/eastmoneyQuote";

const PORT = Number(process.env.PORT ?? 8787);
// 同一 code 进程内缓存 30s，对齐 Worker 边缘缓存口径，避免多人刷新把上游打挂。
const CACHE_TTL_MS = 30_000;

const cache = new Map<string, { at: number; body: string }>();

function send(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=30",
  });
  res.end(body);
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/healthz") {
    send(res, 200, JSON.stringify({ ok: true }));
    return;
  }

  if (req.method !== "GET" || url.pathname !== "/api/quote") {
    send(res, 404, JSON.stringify({ ok: false, detail: "not_found" }));
    return;
  }

  const code = (url.searchParams.get("code") ?? "").trim();
  if (!code) {
    send(res, 400, JSON.stringify({ ok: false, detail: "missing code" }));
    return;
  }

  const now = Date.now();
  const hit = cache.get(code);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    send(res, 200, hit.body);
    return;
  }

  const q = await fetchRealtimeQuote(code);
  if (!q.ok) {
    send(res, 502, JSON.stringify({ ok: false, detail: q.detail ?? "quote failed" }));
    return;
  }

  const body = JSON.stringify({
    ok: true,
    price: q.price,
    prevClose: q.prevClose,
    tradeDate: q.tradeDate,
    quoteTime: q.quoteTime,
    source: q.source,
  });
  cache.set(code, { at: now, body });
  send(res, 200, body);
});

server.listen(PORT, () => {
  console.log(`[quote] listening on :${PORT}`);
});
