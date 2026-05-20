import { parseCsv, rowsToObjects } from "../lib/csv";
import type { BondSeriesPoint } from "../types";
import type { IndexBar, IndexCategory, IndexDefinition, IndexMarket, IndexMeta, IndexTrackingRow } from "../types";

function num(s: string, field: string): number {
  const v = Number(String(s).replace(/,/g, "").trim());
  if (Number.isNaN(v)) throw new Error(`列 ${field} 不是有效数字: ${s}`);
  return v;
}

function optNum(s: string | undefined): number | undefined {
  if (s == null || String(s).trim() === "") return undefined;
  const v = Number(String(s).replace(/,/g, "").trim());
  return Number.isNaN(v) ? undefined : v;
}

function mustMarket(raw: string): IndexMarket {
  const t = (raw ?? "").trim();
  if (t === "A" || t === "A股") return "A";
  if (t === "H" || t === "港股" || t === "HK") return "H";
  throw new Error(`indices.csv market 须为 A / A股 / H / 港股，收到: ${raw}`);
}

function mustCategory(raw: string): IndexCategory {
  const t = (raw ?? "").trim();
  const ok: IndexCategory[] = ["A股红利", "港股红利", "现金流", "价值", "宽基"];
  if ((ok as string[]).includes(t)) return t as IndexCategory;
  throw new Error(`indices.csv category 无效: ${raw}（允许：${ok.join("、")}）`);
}

/** 空文件返回 [] */
export function parseIndicesCsv(text: string): IndexMeta[] {
  if (!text?.trim()) return [];
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rowsToObjects(headers, rows.slice(1)).map((r) => {
    const index_code = r.index_code?.trim();
    if (!index_code) throw new Error("indices.csv 存在缺少 index_code 的行");
    const meta: IndexMeta = {
      index_code,
      name: r.name?.trim() || index_code,
      market: mustMarket(r.market ?? ""),
      category: mustCategory(r.category ?? ""),
      methodology_summary: r.methodology_summary?.trim() || "",
      methodology_url: r.methodology_url?.trim() || undefined,
      fallback_div_yield_pct: optNum(r.fallback_div_yield_pct),
      inception_date: r.inception_date?.trim() || undefined,
      base_date: r.base_date?.trim() || undefined,
      base_value: optNum(r.base_value),
      launch_date: r.launch_date?.trim() || undefined,
      weighting_method: r.weighting_method?.trim() || undefined,
      rebalancing_frequency: r.rebalancing_frequency?.trim() || undefined,
    };
    return meta;
  });
}

export function parseIndexBarsCsv(text: string): Map<string, IndexBar[]> {
  const map = new Map<string, IndexBar[]>();
  if (!text?.trim()) return map;
  const rows = parseCsv(text);
  if (rows.length < 2) return map;
  const headers = rows[0];
  const list = rowsToObjects(headers, rows.slice(1));
  for (const r of list) {
    const index_code = r.index_code?.trim();
    const date = r.date?.trim();
    if (!index_code || !date) continue;
    const tri_close = num(r.tri_close ?? "", "tri_close");
    const price_close = optNum(r.price_close);
    const div_yield_nominal_pct = optNum(r.div_yield_nominal_pct);
    const bar: IndexBar = { date, tri_close };
    if (price_close !== undefined) bar.price_close = price_close;
    if (div_yield_nominal_pct !== undefined) bar.div_yield_nominal_pct = div_yield_nominal_pct;
    if (!map.has(index_code)) map.set(index_code, []);
    map.get(index_code)!.push(bar);
  }
  for (const [code, bars] of map) {
    bars.sort((a, b) => a.date.localeCompare(b.date));
    const seen = new Set<string>();
    for (const b of bars) {
      if (seen.has(b.date)) throw new Error(`index_bars.csv 指数 ${code} 重复日期 ${b.date}`);
      seen.add(b.date);
    }
  }
  return map;
}

export function parseIndexTrackingEtfsCsv(text: string): IndexTrackingRow[] {
  if (!text?.trim()) return [];
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rowsToObjects(headers, rows.slice(1)).map((r) => {
    const index_code = r.index_code?.trim();
    const etf_code = r.etf_code?.trim();
    if (!index_code || !etf_code) throw new Error("index_tracking_etfs.csv 每行须含 index_code、etf_code");
    const row: IndexTrackingRow = { index_code, etf_code };
    const pt = (r.product_type ?? "").trim().toLowerCase();
    if (pt === "otc_fund" || pt === "otc") row.product_type = "otc_fund";
    else if (pt === "etf") row.product_type = "etf";
    const note = r.note?.trim();
    if (note) row.note = note;
    const fee = optNum(r.fee_pct);
    if (fee !== undefined) row.fee_pct = fee;
    const ld = r.listed_date?.trim();
    if (ld) row.listed_date = ld;
    return row;
  });
}

export function buildIndexDefinitions(metas: IndexMeta[], barsByCode: Map<string, IndexBar[]>): IndexDefinition[] {
  return metas.map((meta) => {
    const bars = barsByCode.get(meta.index_code) ?? [];
    return { meta, bars };
  });
}

/** 解析三套 CSV；任一解析失败抛错由调用方捕获。indices 为空则返回空列表。 */
export function parseIndexCsvBundle(
  indicesText: string,
  indexBarsText: string,
  trackingText: string
): { indices: IndexDefinition[]; indexTracking: IndexTrackingRow[] } {
  const metas = parseIndicesCsv(indicesText);
  const barsMap = parseIndexBarsCsv(indexBarsText);
  const tracking = parseIndexTrackingEtfsCsv(trackingText);
  const indices = buildIndexDefinitions(metas, barsMap);
  return { indices, indexTracking: tracking };
}

export function bondAnchorForIndexMarket(market: IndexMarket): "CN_10Y" | "US_10Y" {
  return market === "A" ? "CN_10Y" : "US_10Y";
}

export function indexShowsSpread(category: IndexCategory): boolean {
  return (
    category === "A股红利" ||
    category === "港股红利" ||
    category === "现金流" ||
    category === "价值"
  );
}

export type IndexValueMode = "tri" | "price";

export function indexSeriesForMode(bars: IndexBar[], mode: IndexValueMode): { date: string; value: number }[] {
  return bars.map((b) => {
    if (mode === "price") {
      const v = b.price_close;
      if (v === undefined) return { date: b.date, value: Number.NaN };
      return { date: b.date, value: v };
    }
    return { date: b.date, value: b.tri_close };
  });
}

export function indexHasPriceSeries(bars: IndexBar[]): boolean {
  return bars.some((b) => typeof b.price_close === "number" && !Number.isNaN(b.price_close));
}

/** 与现有 ETF 利差一致：仅使用 index_bars 中有显式股息率的日期，不做前向填充。 */
export function buildIndexSpreadRows(
  def: IndexDefinition,
  bondByDate: Record<string, BondSeriesPoint>
): { date: string; divYieldPct: number; bondYieldPct: number; spreadPct: number }[] {
  if (!indexShowsSpread(def.meta.category)) return [];
  const anchor = bondAnchorForIndexMarket(def.meta.market);
  return def.bars.flatMap((b) => {
    const raw = b.div_yield_nominal_pct;
    if (typeof raw !== "number" || Number.isNaN(raw)) return [];
    const divYieldPct = raw;
    const bondRow = bondByDate[b.date];
    if (!bondRow) return [];
    const bondYieldPct =
      anchor === "CN_10Y" ? bondRow.cn10y_pct : bondRow.us10y_pct;
    const spreadPct = Math.round((divYieldPct - bondYieldPct) * 100) / 100;
    return { date: b.date, divYieldPct, bondYieldPct, spreadPct };
  });
}

export function identifyIndexCsv(
  name: string
): "indices" | "index_bars" | "index_tracking_etfs" | null {
  const n = name.toLowerCase().trim();
  if (n === "indices.csv" || n.endsWith("/indices.csv")) return "indices";
  if (n === "index_bars.csv" || n.endsWith("/index_bars.csv")) return "index_bars";
  if (n === "index_tracking_etfs.csv" || n.endsWith("/index_tracking_etfs.csv")) return "index_tracking_etfs";
  return null;
}
