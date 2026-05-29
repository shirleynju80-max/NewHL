import type { OhlcBar } from "../types";

/** 收盘价相对误差，用于重叠日校验 */
const DEFAULT_CLOSE_REL_TOL = 0.002;

export type HistoryConsistency = {
  ok: boolean;
  overlapDates: number;
  matchedDates: number;
  mismatchSamples: string[];
  messages: string[];
};

/**
 * 对「同一标的」两段按日期对齐的 K 线做一致性检查（默认比收盘，相对容差）。
 * 用于 Web/API 拉取的历史与本地 CSV 交叉验证。
 */
export function compareBarHistory(
  local: OhlcBar[],
  remote: OhlcBar[],
  opts?: { closeRelTol?: number; maxMismatchesToList?: number },
): HistoryConsistency {
  const relTol = opts?.closeRelTol ?? DEFAULT_CLOSE_REL_TOL;
  const maxList = opts?.maxMismatchesToList ?? 8;
  const lm = new Map(local.map((b) => [b.date, b]));
  const rm = new Map(remote.map((b) => [b.date, b]));
  const overlapDates = [...lm.keys()].filter((d) => rm.has(d)).sort();
  const mismatchSamples: string[] = [];
  let matched = 0;
  for (const d of overlapDates) {
    const a = lm.get(d)!;
    const b = rm.get(d)!;
    const denom = Math.max(Math.abs(a.close), 1e-9);
    const rel = Math.abs(a.close - b.close) / denom;
    if (rel <= relTol) matched++;
    else if (mismatchSamples.length < maxList) {
      mismatchSamples.push(
        `${d} 收 ${a.close.toFixed(4)} ≠ ${b.close.toFixed(4)}`,
      );
    }
  }
  const messages: string[] = [];
  const badDays = overlapDates.length - matched;
  if (!overlapDates.length) {
    messages.push("远程与本地无重叠交易日，无法比对。");
  } else if (badDays > 0) {
    messages.push(
      `重叠 ${overlapDates.length} 日中，${badDays} 日收盘超出容差（±${(relTol * 100).toFixed(2)}%），以下为部分样例：`,
    );
  } else {
    messages.push(
      `重叠 ${overlapDates.length} 日收盘校验通过（容差 ±${(relTol * 100).toFixed(2)}%）。`,
    );
  }
  return {
    ok: badDays === 0 && overlapDates.length > 0,
    overlapDates: overlapDates.length,
    matchedDates: matched,
    mismatchSamples,
    messages,
  };
}

export type RemoteBarsFetch = {
  ok: boolean;
  bars?: OhlcBar[];
  source: "web" | "api" | "none";
  detail?: string;
};

/**
 * Web 模板拉取：需配置 `VITE_QUOTE_WEB_URL`（建议经同域反代解决 CORS），
 * GET `?code=510300` 返回 JSON：`{ "bars": OhlcBar[] }`。
 * 真实爬虫（解析东财/新浪页）应放在服务端，由该 URL 转发为统一 JSON。
 */
export async function fetchBarsFromWebTemplate(
  code: string,
): Promise<RemoteBarsFetch> {
  const base = (import.meta as ImportMeta & { env?: Record<string, string> })
    .env?.VITE_QUOTE_WEB_URL;
  if (!base?.trim()) {
    return {
      ok: false,
      source: "none",
      detail:
        "未配置 VITE_QUOTE_WEB_URL。请在环境变量中设置行情网关（返回 { bars } JSON）。",
    };
  }
  try {
    const url = `${base.replace(/\/$/, "")}?code=${encodeURIComponent(code)}`;
    const r = await fetch(url, { mode: "cors", cache: "no-store" });
    if (!r.ok)
      return { ok: false, source: "web", detail: `服务响应异常 (${r.status})` };
    const j = (await r.json()) as { bars?: OhlcBar[] };
    const bars = Array.isArray(j.bars) ? j.bars : null;
    if (!bars?.length)
      return { ok: false, source: "web", detail: "返回数据格式异常" };
    return { ok: true, bars, source: "web" };
  } catch (e) {
    return {
      ok: false,
      source: "web",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * API 模板：`VITE_QUOTE_API_URL` + 可选 `VITE_QUOTE_API_KEY`，同样约定 `{ bars }`。
 */
export async function fetchBarsFromApiTemplate(
  code: string,
): Promise<RemoteBarsFetch> {
  const env =
    (import.meta as ImportMeta & { env?: Record<string, string> }).env ?? {};
  const base = env.VITE_QUOTE_API_URL;
  if (!base?.trim()) {
    return { ok: false, source: "none", detail: "未配置 VITE_QUOTE_API_URL。" };
  }
  try {
    const url = `${base.replace(/\/$/, "")}?code=${encodeURIComponent(code)}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    const key = env.VITE_QUOTE_API_KEY;
    if (key) headers.Authorization = `Bearer ${key}`;
    const r = await fetch(url, { headers, cache: "no-store" });
    if (!r.ok)
      return { ok: false, source: "api", detail: `服务响应异常 (${r.status})` };
    const j = (await r.json()) as { bars?: OhlcBar[] };
    const bars = Array.isArray(j.bars) ? j.bars : null;
    if (!bars?.length)
      return { ok: false, source: "api", detail: "返回数据格式异常" };
    return { ok: true, bars, source: "api" };
  } catch (e) {
    return {
      ok: false,
      source: "api",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export type SyncRemoteResult = RemoteBarsFetch & {
  consistency?: HistoryConsistency;
};

/** 先 Web 模板，失败再 API；若成功拉取且传入本地 bars，则附带一致性报告。 */
export async function tryWebThenApiBars(
  code: string,
  localBars?: OhlcBar[],
): Promise<SyncRemoteResult> {
  const web = await fetchBarsFromWebTemplate(code);
  if (web.ok && web.bars) {
    const consistency = localBars?.length
      ? compareBarHistory(localBars, web.bars)
      : undefined;
    return { ...web, consistency };
  }
  const api = await fetchBarsFromApiTemplate(code);
  if (api.ok && api.bars) {
    const consistency = localBars?.length
      ? compareBarHistory(localBars, api.bars)
      : undefined;
    return { ...api, consistency };
  }
  const detail = [web.detail, api.detail].filter(Boolean).join(" → ");
  return {
    ok: false,
    source: "none",
    detail: detail || "远程数据源均未返回数据",
  };
}
