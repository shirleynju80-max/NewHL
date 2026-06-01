import type { Connect } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fetchRealtimeQuote } from "./workers/data-api/src/eastmoneyQuote";

// 若部署在子路径（如 https://example.com/desk/），构建前设置：VITE_BASE_PATH=/desk/
const base = (process.env.VITE_BASE_PATH as string | undefined) || "/";

function noCacheIndexHtmlMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    if (
      path === "/" ||
      path === "/index.html" ||
      path.endsWith("/index.html")
    ) {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
    }
    next();
  };
}

function quoteApiDevMiddleware(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    const url = req.url ?? "";
    if (!url.startsWith("/api/quote")) return next();
    const parsed = new URL(url, "http://local");
    const code = parsed.searchParams.get("code")?.trim() ?? "";
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (!code) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, detail: "missing code" }));
      return;
    }
    const q = await fetchRealtimeQuote(code);
    if (!q.ok) {
      res.statusCode = 502;
      res.end(JSON.stringify({ ok: false, detail: q.detail ?? "quote failed" }));
      return;
    }
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        ok: true,
        price: q.price,
        prevClose: q.prevClose,
        tradeDate: q.tradeDate,
        quoteTime: q.quoteTime,
        source: q.source,
      })
    );
  };
}

export default defineConfig({
  base,
  plugins: [
    react(),
    {
      name: "quote-api-dev",
      configureServer(server) {
        server.middlewares.use(noCacheIndexHtmlMiddleware());
        server.middlewares.use(quoteApiDevMiddleware());
      },
    },
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
        },
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
  },
});
