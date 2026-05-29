import { parseCsv, rowsToObjects } from "../lib/csv";
import {
  strategyKindLabel,
  stripQuotedAnnotations,
} from "../lib/strategyLabels";
import type {
  BondSeriesPoint,
  BollingerVariant,
  DivYieldSource,
  DividendMarketScope,
  EtfDefinition,
  EtfMeta,
  EtfParams,
  IndexDefinition,
  IndexTrackingRow,
  InvestorChannel,
  OhlcBar,
  ParamStrategyVariant,
  ProductKind,
  RsiVariant,
} from "../types";
import { parseEtfProductsCsv } from "../lib/etfProducts";
import { identifyIndexCsv, parseIndexCsvBundle } from "./indexCsv";

const PLACEHOLDER_ETF_NAME_RE =
  /仅 bars|etfs 为空|请在 etfs|已自动占位|etfsmore 补全/i;

function num(s: string, field: string): number {
  const v = Number(String(s).replace(/,/g, "").trim());
  if (Number.isNaN(v)) throw new Error(`列 ${field} 不是有效数字: ${s}`);
  return v;
}

function optNum(s: string | undefined): number | undefined {
  if (s == null || s.trim() === "") return undefined;
  const v = Number(s.replace(/,/g, "").trim());
  return Number.isNaN(v) ? undefined : v;
}

/** bars / 行情补片：可选按日股息率（%），与 etfs 中 div_yield_nominal_pct 同口径。 */
function optBarDivYieldNominalPct(
  r: Record<string, string>,
  code: string,
  date: string,
): number | undefined {
  const raw =
    r.div_yield_nominal_pct?.trim() ||
    r.dividend_yield_pct?.trim() ||
    r.div_yield_pct?.trim() ||
    "";
  if (raw === "") return undefined;
  const v = Number(String(raw).replace(/,/g, "").trim());
  if (Number.isNaN(v)) {
    throw new Error(
      `bars.csv 标的 ${code} 日期 ${date} 的股息率列不是有效数字: ${raw}`,
    );
  }
  return v;
}

function mustProductKind(s: string, code: string): ProductKind {
  const t = (s ?? "").trim();
  if (t === "红利_含股息分红" || t === "现金流类") return t;
  /** 兼容简写：ETF 视作红利（需配合 dividend_market_scope） */
  if (t === "ETF" || t.toLowerCase() === "etf") return "红利_含股息分红";
  throw new Error(
    `product_kind 无效: ${s}（标的 ${code}；请使用 红利_含股息分红 / 现金流类 / ETF）`,
  );
}

function optScope(s: string | undefined): DividendMarketScope | undefined {
  if (!s || s.trim() === "") return undefined;
  if (s === "A股红利" || s === "港股红利") return s;
  throw new Error(`dividend_market_scope 无效: ${s}`);
}

function mustDivSource(s: string): DivYieldSource {
  if (s === "基金披露" || s === "指数发布" || s === "估算") return s;
  throw new Error(`div_yield_source 无效: ${s}`);
}

function optChannel(s: string | undefined): InvestorChannel | undefined {
  if (!s || s.trim() === "") return undefined;
  if (s === "港股通" || s === "QDII" || s === "其他") return s;
  throw new Error(`investor_channel 无效: ${s}`);
}

function parseDocLinks(
  raw: string | undefined,
): { label: string; href: string }[] | undefined {
  if (!raw || !raw.trim()) return undefined;
  try {
    const j = JSON.parse(raw) as { label: string; href: string }[];
    if (!Array.isArray(j)) return undefined;
    return j.filter((x) => x && typeof x.href === "string");
  } catch {
    return undefined;
  }
}

const DATE_CELL = /^\d{4}-\d{1,2}-\d{1,2}$/;

function firstIsoDateInRow(r: Record<string, string>): string | null {
  for (const v of Object.values(r)) {
    const t = v.trim();
    if (DATE_CELL.test(t)) return t;
  }
  return null;
}

export type CsvBundle = {
  definitions: EtfDefinition[];
  bondByDate: Record<string, BondSeriesPoint>;
};

export type AppDataBundle = CsvBundle & {
  indices: IndexDefinition[];
  indexTracking: IndexTrackingRow[];
};

export function withIndexCsvSafe(
  bundle: CsvBundle,
  indicesText: string,
  indexBarsText: string,
  trackingText: string,
): { bundle: AppDataBundle; indexCsvError: string | null } {
  try {
    const { indices, indexTracking } = parseIndexCsvBundle(
      indicesText ?? "",
      indexBarsText ?? "",
      trackingText ?? "",
    );
    return {
      bundle: { ...bundle, indices, indexTracking },
      indexCsvError: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      bundle: { ...bundle, indices: [], indexTracking: [] },
      indexCsvError: `指数基础数据解析异常（已忽略部分指数），可能影响相关策略的展示：${msg}`,
    };
  }
}

/** 与主 CSV 合并：`etfsmore`/`barsmore`/`bondsmore` 中同标的、同日期覆盖主文件；国债序列按日期合并后重新排序。 */
export type CsvMergeOptions = {
  etfsMore?: string;
  barsMore?: string;
  bondsMore?: string;
  /** 场外基金净值（fund_bars.csv），按 fund_code 并入 bars，与场内 ETF 同看板展示 */
  fundBars?: string;
  /** 可选：用 etf_products.csv 中的产品名补全占位 meta */
  etfProducts?: string;
};

export function parseEtfsCsv(text: string): EtfMeta[] {
  if (!text?.trim()) return [];
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rowsToObjects(headers, rows.slice(1)).map((r) => {
    const code = r.code?.trim();
    if (!code) throw new Error("etfs.csv 存在缺少 code 的行");
    const product_kind = mustProductKind(r.product_kind ?? "", code);
    const div_scope = optScope(r.dividend_market_scope);
    const sid = r.strategy_id?.trim();
    const pv = r.param_version?.trim();
    if (!sid) throw new Error(`etfs.csv 标的 ${code} 缺少 strategy_id`);
    if (!pv) throw new Error(`etfs.csv 标的 ${code} 缺少 param_version`);
    const meta: EtfMeta = {
      code,
      name: r.name?.trim() || code,
      strategy_id: sid,
      param_version: pv,
      product_kind,
      dividend_market_scope: div_scope,
      div_yield_nominal_pct: num(
        r.div_yield_nominal_pct ?? "0",
        "div_yield_nominal_pct",
      ),
      div_yield_source: mustDivSource(r.div_yield_source ?? "估算"),
      investor_channel: optChannel(r.investor_channel),
      div_yield_after_tax_est_pct: optNum(r.div_yield_after_tax_est_pct),
      tax_assumption_note: r.tax_assumption_note?.trim() || undefined,
      fx_ccy: r.fx_ccy?.trim() || undefined,
      doc_links: parseDocLinks(r.doc_links),
    };
    if (product_kind === "红利_含股息分红" && !meta.dividend_market_scope) {
      throw new Error(`红利标的 ${meta.code} 缺少 dividend_market_scope`);
    }
    return meta;
  });
}

export function parseBarsCsv(text: string): Map<string, OhlcBar[]> {
  if (!text?.trim()) return new Map();
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("bars.csv 无数据行");
  const headers = rows[0];
  const list = rowsToObjects(headers, rows.slice(1));
  const map = new Map<string, OhlcBar[]>();
  for (const r of list) {
    const code = r.etf_code?.trim();
    if (!code) throw new Error("bars.csv 存在空 etf_code");
    const date =
      r.date?.trim() ||
      (() => {
        throw new Error("bars.csv 缺少 date");
      })();
    const bar: OhlcBar = {
      date,
      open: num(r.open ?? "", "open"),
      high: num(r.high ?? "", "high"),
      low: num(r.low ?? "", "low"),
      close: num(r.close ?? "", "close"),
    };
    const divY = optBarDivYieldNominalPct(r, code, date);
    if (divY !== undefined) bar.div_yield_nominal_pct = divY;
    if (!map.has(code)) map.set(code, []);
    map.get(code)!.push(bar);
  }
  for (const [code, bars] of map) {
    bars.sort((a, b) => a.date.localeCompare(b.date));
    const seen = new Set<string>();
    for (const b of bars) {
      if (seen.has(b.date))
        throw new Error(`bars.csv 标的 ${code} 重复日期 ${b.date}`);
      seen.add(b.date);
    }
  }
  return map;
}

/** fund_bars.csv：场外开放式基金净值 → OHLC；优先使用前复权净值作为 close。 */
export function parseFundBarsCsv(text: string): Map<string, OhlcBar[]> {
  if (!text?.trim()) return new Map();
  const rows = parseCsv(text);
  if (rows.length < 2) return new Map();
  const headers = rows[0];
  const list = rowsToObjects(headers, rows.slice(1));
  const map = new Map<string, OhlcBar[]>();
  for (const r of list) {
    const code = (r.fund_code ?? r.etf_code ?? "").trim();
    const date = r.date?.trim();
    if (!code || !date) continue;
    const navRaw =
      r.nav_forward_adjusted?.trim() ||
      r.nav_adjusted_front?.trim() ||
      r.adj_close?.trim() ||
      r.nav_unit?.trim() ||
      r.close?.trim();
    if (!navRaw) continue;
    const c = num(navRaw, "nav_unit");
    const bar: OhlcBar = { date, open: c, high: c, low: c, close: c };
    const divRaw =
      r.div_yield_index_did_pct?.trim() ||
      r.div_yield_nominal_pct?.trim() ||
      r.div_yield_fund_ttm_pct?.trim() ||
      "";
    if (divRaw) {
      bar.div_yield_nominal_pct = num(divRaw.replace(/,/g, ""), "div_yield");
    }
    if (!map.has(code)) map.set(code, []);
    map.get(code)!.push(bar);
  }
  for (const [code, bars] of map) {
    bars.sort((a, b) => a.date.localeCompare(b.date));
    const seen = new Set<string>();
    for (const b of bars) {
      if (seen.has(b.date))
        throw new Error(`fund_bars.csv 标的 ${code} 重复日期 ${b.date}`);
      seen.add(b.date);
    }
  }
  return map;
}

function looksLikeInstrumentHeaderRow(row: string[]): boolean {
  const j = row.join("|").toLowerCase();
  const hasCode = /etf_code|基金代码|产品代码|fund_code/i.test(j);
  const hasDate = /\bdate\b|日期|trade_date|交易日期/i.test(j);
  const hasCloseLike = /收盘|净值|nav|\bclose\b|单位净值/i.test(j);
  if (/cn10y|us10y|中债国债|美债|国债收益率/i.test(j) && !hasCode) return false;
  return Boolean(hasDate && hasCloseLike && (hasCode || /\bcode\b/i.test(j)));
}

function findInstrumentHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(20, rows.length - 1); i++) {
    if (looksLikeInstrumentHeaderRow(rows[i])) return i;
  }
  return -1;
}

function pickCell(r: Record<string, string>, ...names: string[]): string {
  for (const n of names) {
    const v = r[n]?.trim();
    if (v) return v;
  }
  for (const key of Object.keys(r)) {
    const t = key.trim();
    for (const n of names) {
      if (t === n || (n.length > 1 && t.includes(n))) {
        const v = r[key]?.trim();
        if (v) return v;
      }
    }
  }
  return "";
}

/**
 * bonds.csv / bondsmore 双用途：① 含 etf_code+日期+收盘/净值 → **追加**并入行情（主数据仍须来自 bars.csv）；② 否则按国债收益率解析（可空）。
 */
export function parseBondsFileDualPurpose(text: string): {
  quoteBars: Map<string, OhlcBar[]>;
  yieldCurve: BondSeriesPoint[];
} {
  if (!text?.trim()) return { quoteBars: new Map(), yieldCurve: [] };
  const rows = parseCsv(text);
  if (rows.length < 2)
    return { quoteBars: new Map(), yieldCurve: parseBondsCsvToList(text) };
  const hi = findInstrumentHeaderRow(rows);
  if (hi < 0)
    return { quoteBars: new Map(), yieldCurve: parseBondsCsvToList(text) };
  const headers = rows[hi].map((x) => x.trim());
  const list = rowsToObjects(headers, rows.slice(hi + 1));
  const map = new Map<string, OhlcBar[]>();
  for (const r of list) {
    const code =
      pickCell(r, "etf_code", "基金代码", "产品代码", "code") ||
      (() => {
        const k = Object.keys(r).find(
          (x) => /代码$/i.test(x.trim()) && !/指标|策略/i.test(x),
        );
        return k ? r[k]!.trim() : "";
      })();
    const date = pickCell(r, "date", "日期", "trade_date", "交易日期");
    if (!code || !date || !DATE_CELL.test(date)) continue;
    const closeRaw = pickCell(
      r,
      "close",
      "收盘",
      "收盘价",
      "净值",
      "nav",
      "单位净值",
    );
    if (!closeRaw) continue;
    const c = num(closeRaw.replace(/,/g, ""), "close");
    const oRaw = pickCell(r, "open", "开盘", "开盘价");
    const hRaw = pickCell(r, "high", "最高", "最高价");
    const lRaw = pickCell(r, "low", "最低", "最低价");
    const o = oRaw ? num(oRaw.replace(/,/g, ""), "open") : c;
    const h = hRaw ? num(hRaw.replace(/,/g, ""), "high") : c;
    const l = lRaw ? num(lRaw.replace(/,/g, ""), "low") : c;
    const bar: OhlcBar = { date, open: o, high: h, low: l, close: c };
    const divRaw = pickCell(
      r,
      "div_yield_nominal_pct",
      "dividend_yield_pct",
      "div_yield_pct",
      "股息率",
    );
    if (divRaw) {
      const v = num(divRaw.replace(/,/g, ""), "div_yield_nominal_pct");
      bar.div_yield_nominal_pct = v;
    }
    if (!map.has(code)) map.set(code, []);
    map.get(code)!.push(bar);
  }
  for (const [code, bars] of map) {
    bars.sort((a, b) => a.date.localeCompare(b.date));
    const byD = new Map<string, OhlcBar>();
    for (const b of bars) byD.set(b.date, b);
    map.set(
      code,
      [...byD.values()].sort((a, b) => a.date.localeCompare(b.date)),
    );
  }
  return { quoteBars: map, yieldCurve: [] };
}

/** etfs 全空时，按 bars 中的代码生成占位 meta（与 ensureParamRows 配合）。 */
function syntheticMetasWhenNoEtfs(barsMap: Map<string, OhlcBar[]>): EtfMeta[] {
  return [...barsMap.keys()].sort().map((code) => ({
    code,
    name: code,
    strategy_id: "rsi_mean_reversion",
    param_version: `auto-${code}`,
    product_kind: "红利_含股息分红",
    dividend_market_scope: "A股红利",
    div_yield_nominal_pct: 0,
    div_yield_source: "估算",
  }));
}

/** 多标的 K 线合并：同一 etf_code 同一 date 以后出现的序列为准（通常来自 barsmore）；OHLC 以后表为准，按日股息率仅在后表缺列时保留先表。 */
export function mergeBarsMaps(
  primary: Map<string, OhlcBar[]>,
  secondary: Map<string, OhlcBar[]>,
): Map<string, OhlcBar[]> {
  const out = new Map<string, OhlcBar[]>();
  const codes = new Set<string>([...primary.keys(), ...secondary.keys()]);
  for (const code of codes) {
    const a = primary.get(code) ?? [];
    const b = secondary.get(code) ?? [];
    const byDate = new Map<string, OhlcBar>();
    for (const bar of a) byDate.set(bar.date, { ...bar });
    for (const bar of b) {
      const prev = byDate.get(bar.date);
      byDate.set(bar.date, {
        ...(prev ?? {}),
        ...bar,
        div_yield_nominal_pct:
          bar.div_yield_nominal_pct ?? prev?.div_yield_nominal_pct,
      });
    }
    const merged = [...byDate.values()].sort((x, y) =>
      x.date.localeCompare(y.date),
    );
    out.set(code, merged);
  }
  return out;
}

function mergeOptionalString(
  overlay: string | undefined,
  base: string | undefined,
): string | undefined {
  const o = overlay?.trim();
  if (o) return o;
  return base?.trim() ? base : undefined;
}

function mergeEtfMetaPair(base: EtfMeta, more: EtfMeta): EtfMeta {
  const moreName = more.name?.trim();
  const baseName = base.name?.trim();
  const name =
    moreName && moreName !== more.code
      ? moreName
      : baseName && !PLACEHOLDER_ETF_NAME_RE.test(baseName)
        ? baseName
        : moreName || baseName || base.code;
  const moreSid = more.strategy_id?.trim();
  const morePv = more.param_version?.trim();
  return {
    code: base.code,
    name,
    strategy_id: moreSid || base.strategy_id,
    param_version: morePv || base.param_version,
    product_kind: more.product_kind ?? base.product_kind,
    dividend_market_scope:
      more.dividend_market_scope ?? base.dividend_market_scope,
    div_yield_nominal_pct:
      more.div_yield_nominal_pct !== 0
        ? more.div_yield_nominal_pct
        : base.div_yield_nominal_pct,
    div_yield_source: more.div_yield_source ?? base.div_yield_source,
    investor_channel:
      mergeOptionalString(more.investor_channel, base.investor_channel) as
        | EtfMeta["investor_channel"]
        | undefined,
    div_yield_after_tax_est_pct:
      more.div_yield_after_tax_est_pct ?? base.div_yield_after_tax_est_pct,
    tax_assumption_note: mergeOptionalString(
      more.tax_assumption_note,
      base.tax_assumption_note,
    ),
    fx_ccy: mergeOptionalString(more.fx_ccy, base.fx_ccy),
    doc_links:
      more.doc_links && more.doc_links.length > 0
        ? more.doc_links
        : base.doc_links,
  };
}

/** etfs + etfsmore：同 code 字段级合并，etfsmore 有值优先，缺项用 etfs 补。顺序为「主表 + more 新增 code」。 */
export function mergeEtfMetas(base: EtfMeta[], more: EtfMeta[]): EtfMeta[] {
  const byCode = new Map<string, EtfMeta>();
  for (const m of base) byCode.set(m.code, m);
  for (const m of more) {
    const prev = byCode.get(m.code);
    byCode.set(m.code, prev ? mergeEtfMetaPair(prev, m) : m);
  }
  const order: string[] = [];
  for (const m of base) if (!order.includes(m.code)) order.push(m.code);
  for (const m of more) if (!order.includes(m.code)) order.push(m.code);
  return order.map((c) => {
    const meta = byCode.get(c);
    if (!meta) throw new Error(`mergeEtfMetas: 缺少标的 ${c}`);
    return meta;
  });
}

/** 用 etf_products.csv 补全占位或仅代码的 meta 名称。 */
export function enrichEtfMetasFromProducts(
  metas: EtfMeta[],
  etfProductsText: string,
): EtfMeta[] {
  if (!etfProductsText?.trim()) return metas;
  let products: ReturnType<typeof parseEtfProductsCsv>;
  try {
    products = parseEtfProductsCsv(etfProductsText);
  } catch {
    return metas;
  }
  const names = new Map(
    products.map((p) => [p.code, p.name.trim()] as const),
  );
  return metas.map((m) => {
    const productName = names.get(m.code);
    if (!productName || productName === m.code) return m;
    const cur = m.name.trim();
    if (
      PLACEHOLDER_ETF_NAME_RE.test(cur) ||
      !cur ||
      cur === m.code
    ) {
      return { ...m, name: productName };
    }
    return m;
  });
}

/** 国债收益率按 date 合并，同一日期以后出现的文件为准；再按日期排序。 */
export function mergeBondSeries(
  primary: BondSeriesPoint[],
  secondary: BondSeriesPoint[],
): BondSeriesPoint[] {
  const byDate = new Map<string, BondSeriesPoint>();
  for (const p of primary) byDate.set(p.date, { ...p });
  for (const p of secondary) byDate.set(p.date, { ...p });
  const dates = [...byDate.keys()].sort();
  return dates.map((d) => byDate.get(d)!);
}

function bondHeaderScore(row: string[]): number {
  let s = 0;
  for (const c of row) {
    const t = c.trim();
    const low = t.toLowerCase();
    if (low === "date" || t === "日期" || t.includes("日期")) s += 3;
    if (/中债|cn\s*10|cn10y|国债.*10/.test(t)) s += 2;
    if (/美国|us\s*10|us10y|美债|u\.s\./i.test(t)) s += 2;
  }
  return s;
}

/** 定位表头行（兼容 Wind/中债等前几行为说明、表头为「日期」+ 两列收益率） */
function findBondTableStart(
  rows: string[][],
): { headerIdx: number; headers: string[] } | null {
  let best: { headerIdx: number; headers: string[]; score: number } | null =
    null;
  for (let i = 0; i < rows.length - 1; i++) {
    const hdr = rows[i];
    if (!hdr.some((c) => c.trim())) continue;
    const sc = bondHeaderScore(hdr);
    if (sc >= 3 && (!best || sc > best.score))
      best = { headerIdx: i, headers: hdr, score: sc };
  }
  if (best) return { headerIdx: best.headerIdx, headers: best.headers };
  return null;
}

function mapBondRow(
  headers: string[],
  cols: string[],
): { date: string; cnRaw: string; usRaw: string } | null {
  const h = headers.map((x) => x.trim());
  const cells = h.map((_, j) => (cols[j] ?? "").trim());
  let di = h.findIndex((t) => {
    const low = t.toLowerCase();
    return (
      low === "date" ||
      t === "日期" ||
      t.includes("日期") ||
      low === "trade_date"
    );
  });
  if (di < 0) di = 0;
  const date = cells[di];
  if (!date || !DATE_CELL.test(date)) return null;

  let ci = h.findIndex(
    (t) =>
      /中债|cn\s*10|cn10y|国债.*10/.test(t) || t.toLowerCase() === "cn10y_pct",
  );
  let ui = h.findIndex(
    (t) =>
      /美国|us\s*10|us10y|美债|u\.s\./i.test(t) ||
      t.toLowerCase() === "us10y_pct",
  );
  const numericIdxs = cells
    .map((v, j) => ({ v, j }))
    .filter(
      ({ v, j }) =>
        j !== di && v !== "" && !Number.isNaN(Number(v.replace(/,/g, ""))),
    );
  if (ci < 0 && numericIdxs.length >= 1) ci = numericIdxs[0].j;
  if (ui < 0 && numericIdxs.length >= 2)
    ui = numericIdxs.find((x) => x.j !== ci)?.j ?? -1;
  const cnRaw = ci >= 0 ? cells[ci] : "";
  const usRaw = ui >= 0 ? cells[ui] : "";
  return { date, cnRaw, usRaw };
}

/** 无国债文件或文件无有效行时用于对齐 K 线的常数（%） */
export const DEFAULT_BOND_CN10Y_PCT = 2.5;
export const DEFAULT_BOND_US10Y_PCT = 4.0;

/** 读 bonds.csv：空单元格沿用上一行有效值（文件内前向填充）；跳过无日期行；支持中文表头与前置说明行。缺文件、仅表头、无有效行时返回空数组。 */
export function parseBondsCsvToList(text: string): BondSeriesPoint[] {
  if (!text?.trim()) return [];
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  const start = findBondTableStart(rows);
  let list: Record<string, string>[];
  if (start && start.headerIdx > 0) {
    const headers = start.headers;
    const body = rows.slice(start.headerIdx + 1);
    list = body.map((cols) => {
      const o: Record<string, string> = {};
      headers.forEach((h, i) => {
        o[h.trim()] = cols[i]?.trim() ?? "";
      });
      return o;
    });
  } else {
    const headers = rows[0];
    list = rowsToObjects(headers, rows.slice(1));
  }

  let lastCn = 2.5;
  let lastUs = 4.0;
  const out: BondSeriesPoint[] = [];
  const headersForMap = start?.headers ?? rows[0];

  for (const r of list) {
    const cols = headersForMap.map((h) => r[h.trim()] ?? "");
    const mapped = mapBondRow(headersForMap, cols);
    if (!mapped) {
      const date = firstIsoDateInRow(r);
      if (!date) continue;
      const cnRaw = r.cn10y_pct?.trim() ?? "";
      const usRaw = r.us10y_pct?.trim() ?? "";
      if (cnRaw) lastCn = num(cnRaw, "cn10y_pct");
      if (usRaw) lastUs = num(usRaw, "us10y_pct");
      out.push({ date, cn10y_pct: lastCn, us10y_pct: lastUs });
      continue;
    }
    if (mapped.cnRaw) lastCn = num(mapped.cnRaw, "cn10y_pct");
    if (mapped.usRaw) lastUs = num(mapped.usRaw, "us10y_pct");
    out.push({ date: mapped.date, cn10y_pct: lastCn, us10y_pct: lastUs });
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/** 将国债序列对齐到 K 线每一个交易日：对每个 bar 日期取「最近且不晚于该日」的国债观测；无国债数据时对每个交易日填默认常数 */
export function expandBondsToBarDates(
  bondSeries: BondSeriesPoint[],
  barDates: string[],
): Record<string, BondSeriesPoint> {
  const out: Record<string, BondSeriesPoint> = {};
  if (!barDates.length) return out;
  if (!bondSeries.length) {
    for (const d of barDates) {
      out[d] = {
        date: d,
        cn10y_pct: DEFAULT_BOND_CN10Y_PCT,
        us10y_pct: DEFAULT_BOND_US10Y_PCT,
      };
    }
    return out;
  }
  const sorted = [...bondSeries].sort((a, b) => a.date.localeCompare(b.date));
  for (const d of barDates) {
    let pick = sorted[0];
    for (const b of sorted) {
      if (b.date <= d) pick = b;
      else break;
    }
    out[d] = { date: d, cn10y_pct: pick.cn10y_pct, us10y_pct: pick.us10y_pct };
  }
  return out;
}

type ParamRow = {
  etf_code: string;
  strategy_id?: string;
  param_version?: string;
  /** 下拉展示名，缺省用 param_version */
  note?: string;
  ma_fast: number;
  ma_slow: number;
  rsi_period: number;
  rsi_overbought: number;
  rsi_oversold: number;
  bb_period: number;
  bb_std: number;
};

export function parseEtfParamsCsv(text: string): ParamRow[] {
  if (!text?.trim()) return [];
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  const list = rowsToObjects(headers, rows.slice(1));
  return list.map((r) => {
    const rsiPeriod = optNum(r.rsi_period) ?? optNum(r.rsi_window) ?? 14;
    const bbPeriod = optNum(r.bb_period) ?? optNum(r.boll_window) ?? 20;
    const bbStd = optNum(r.bb_std) ?? optNum(r.boll_std) ?? 2;
    const maFast = optNum(r.ma_fast) ?? 5;
    const maSlow = optNum(r.ma_slow) ?? 20;
    return {
      etf_code:
        r.etf_code?.trim() ||
        (() => {
          throw new Error("etf_params.csv 缺少 etf_code");
        })(),
      strategy_id: r.strategy_id?.trim() || undefined,
      param_version: r.param_version?.trim() || undefined,
      note: r.note?.trim() || undefined,
      ma_fast: maFast,
      ma_slow: maSlow,
      rsi_period: rsiPeriod,
      rsi_overbought: optNum(r.rsi_overbought) ?? 70,
      rsi_oversold: optNum(r.rsi_oversold) ?? 30,
      bb_period: bbPeriod,
      bb_std: bbStd,
    };
  });
}

function variantCadenceFromNote(
  note: string | undefined,
  kind: "rsi" | "boll",
): "1d" | "1w" {
  const t = note?.trim() ?? "";
  if (!t.includes("周")) return "1d";
  if (kind === "boll" && /布林|boll/i.test(t)) return "1w";
  if (kind === "rsi" && /rsi/i.test(t)) return "1w";
  return "1d";
}

function paramsFromRow(row: ParamRow): EtfParams {
  const ma_variants = [
    { variant_id: "ma_csv", fast: row.ma_fast, slow: row.ma_slow },
  ];
  const rsi_variants: RsiVariant[] = [
    {
      variant_id: "rsi_csv",
      period: row.rsi_period,
      overbought: row.rsi_overbought,
      oversold: row.rsi_oversold,
      cadence: variantCadenceFromNote(row.note, "rsi"),
    },
  ];
  const bollinger_variants: BollingerVariant[] = [
    {
      variant_id: "bb_csv",
      period: row.bb_period,
      stdDev: row.bb_std,
      cadence: variantCadenceFromNote(row.note, "boll"),
    },
  ];
  return {
    ma_variants,
    rsi_variants,
    bollinger_variants,
    strategy_ma_ids: ["ma_csv", "ma_csv"],
    strategy_rsi_id: "rsi_csv",
  };
}

function buildParamVariantList(
  meta: EtfMeta,
  rowsForCode: ParamRow[],
): ParamStrategyVariant[] {
  return rowsForCode.map((row, i) => {
    const sid = row.strategy_id?.trim() || meta.strategy_id;
    const raw =
      stripQuotedAnnotations(row.note?.trim() || "") ||
      row.param_version?.trim() ||
      `参数组 ${i + 1}`;
    const kind = strategyKindLabel(sid);
    const label = raw.includes(kind) ? raw : `${raw} · ${kind}`;
    return {
      key: `${meta.code}|${i}|${row.param_version ?? ""}|${row.strategy_id ?? ""}`,
      label,
      strategyId: sid,
      paramVersion: row.param_version?.trim() || meta.param_version,
      params: paramsFromRow(row),
    };
  });
}

/** bars 有行情但 etfs 合并结果无 meta 时补最小占位（名称先用代码，可由 etf_products 补全）。 */
function ensureMetasForBars(
  metas: EtfMeta[],
  barsMap: Map<string, OhlcBar[]>,
): EtfMeta[] {
  if (!metas.length) return metas;
  const template = metas[0]!;
  const byCode = new Map(metas.map((m) => [m.code, m]));
  const barOnly: string[] = [];
  for (const code of barsMap.keys()) {
    if (!byCode.has(code)) {
      const pv = `auto-${code}`;
      const stub: EtfMeta = {
        code,
        name: code,
        strategy_id: template.strategy_id,
        param_version: pv,
        product_kind: template.product_kind,
        dividend_market_scope: template.dividend_market_scope,
        div_yield_nominal_pct: template.div_yield_nominal_pct,
        div_yield_source: template.div_yield_source,
      };
      byCode.set(code, stub);
      barOnly.push(code);
    }
  }
  if (!barOnly.length) return metas;
  barOnly.sort((a, b) => a.localeCompare(b));
  const order: string[] = [];
  const seen = new Set<string>();
  for (const m of metas) {
    if (!seen.has(m.code)) {
      order.push(m.code);
      seen.add(m.code);
    }
  }
  for (const c of barOnly) {
    if (!seen.has(c)) {
      order.push(c);
      seen.add(c);
    }
  }
  return order.map((c) => byCode.get(c)!);
}

function cashCreationCodesFromProducts(etfProductsText?: string): Set<string> {
  if (!etfProductsText?.trim()) return new Set();
  try {
    return new Set(
      parseEtfProductsCsv(etfProductsText)
        .filter((p) => p.product_group === "cash_creation")
        .map((p) => p.code),
    );
  } catch {
    return new Set();
  }
}

function isCashCreationMeta(meta: EtfMeta, cashCodes: Set<string>): boolean {
  if (cashCodes.has(meta.code)) return true;
  return meta.product_kind === "现金流类";
}

function placeholderParamRow(meta: EtfMeta): ParamRow {
  return {
    etf_code: meta.code,
    strategy_id: meta.strategy_id,
    param_version: meta.param_version,
    note: "现金流类占位（不展示策略）",
    ma_fast: 5,
    ma_slow: 20,
    rsi_period: 14,
    rsi_overbought: 70,
    rsi_oversold: 30,
    bb_period: 20,
    bb_std: 2,
  };
}

/** etfs 中有、etf_params 中无的标的：补一行与 etfs 默认版本对齐的参数，避免合并后无法建 bundle。 */
function ensureParamRowsForMetas(
  metas: EtfMeta[],
  paramRows: ParamRow[],
  cashCodes: Set<string>,
): ParamRow[] {
  const codesWith = new Set(paramRows.map((p) => p.etf_code));
  const extra: ParamRow[] = [];
  for (const meta of metas) {
    if (isCashCreationMeta(meta, cashCodes)) continue;
    if (codesWith.has(meta.code)) continue;
    extra.push({
      etf_code: meta.code,
      strategy_id: meta.strategy_id,
      param_version: meta.param_version,
      note: "合并补全（仅 etfs 无 etf_params 时自动生成，可在 etf_params.csv 中覆盖）",
      ma_fast: 5,
      ma_slow: 20,
      rsi_period: 14,
      rsi_overbought: 70,
      rsi_oversold: 30,
      bb_period: 20,
      bb_std: 2,
    });
    codesWith.add(meta.code);
  }
  return [...paramRows, ...extra];
}

function findParamRow(rows: ParamRow[], meta: EtfMeta): ParamRow {
  const forCode = rows.filter((p) => p.etf_code === meta.code);
  if (forCode.length === 0)
    throw new Error(`etf_params.csv 无 etf_code=${meta.code}`);
  const withVer = forCode.filter(
    (p) => p.param_version && p.param_version.trim() !== "",
  );
  if (withVer.length) {
    const m = withVer.filter((p) => p.param_version === meta.param_version);
    if (m.length === 1) return m[0];
    if (m.length === 0) {
      throw new Error(
        `etf_params 无 param_version=${meta.param_version} 的行: ${meta.code}`,
      );
    }
    throw new Error(
      `etf_params 中 ${meta.code} 匹配 param_version=${meta.param_version} 多于一行`,
    );
  }
  if (forCode.length === 1) return forCode[0];
  throw new Error(
    `etf_params 中 ${meta.code} 有多行且未提供 param_version，无法与 etfs 对齐`,
  );
}

export function buildCsvBundle(
  etfsText: string,
  barsText: string,
  bondsText: string,
  paramsText: string,
  merge?: CsvMergeOptions,
): CsvBundle {
  if (!barsText?.trim()) {
    throw new Error(
      "bars.csv 为必选：须包含产品代码（etf_code）、日期、收盘价或净值等有效数据行。",
    );
  }
  const splitMain = parseBondsFileDualPurpose(bondsText);
  let barsMap = mergeBarsMaps(parseBarsCsv(barsText), splitMain.quoteBars);
  let bondList = splitMain.yieldCurve;
  if (merge?.barsMore?.trim()) {
    barsMap = mergeBarsMaps(barsMap, parseBarsCsv(merge.barsMore.trim()));
  }
  if (merge?.bondsMore?.trim()) {
    const splitMore = parseBondsFileDualPurpose(merge.bondsMore.trim());
    if (splitMore.quoteBars.size)
      barsMap = mergeBarsMaps(barsMap, splitMore.quoteBars);
    if (splitMore.yieldCurve.length) {
      bondList = bondList.length
        ? mergeBondSeries(bondList, splitMore.yieldCurve)
        : splitMore.yieldCurve;
    }
  }
  if (merge?.fundBars?.trim()) {
    barsMap = mergeBarsMaps(barsMap, parseFundBarsCsv(merge.fundBars.trim()));
  }
  if (!barsMap.size) {
    throw new Error(
      "bars.csv 解析后无有效行情：请检查是否含 etf_code/基金代码、日期、收盘价或净值等列与数据行；可选地通过 bonds.csv / bondsmore 中带产品代码的行情表追加合并。",
    );
  }

  let metas = parseEtfsCsv(etfsText);
  if (merge?.etfsMore?.trim()) {
    metas = mergeEtfMetas(metas, parseEtfsCsv(merge.etfsMore.trim()));
  }
  if (!metas.length) metas = syntheticMetasWhenNoEtfs(barsMap);
  metas = ensureMetasForBars(metas, barsMap);
  if (merge?.etfProducts?.trim()) {
    metas = enrichEtfMetasFromProducts(metas, merge.etfProducts.trim());
  }
  const cashCodes = cashCreationCodesFromProducts(merge?.etfProducts);
  let paramRows = parseEtfParamsCsv(paramsText);
  paramRows = paramRows.filter((p) => !cashCodes.has(p.etf_code));
  paramRows = ensureParamRowsForMetas(metas, paramRows, cashCodes);

  const allBarDates = new Set<string>();
  for (const bars of barsMap.values()) {
    for (const b of bars) allBarDates.add(b.date);
  }
  const barDatesSorted = [...allBarDates].sort();
  const bondByDate = expandBondsToBarDates(bondList, barDatesSorted);

  const definitions: EtfDefinition[] = metas.map((meta) => {
    const bars = barsMap.get(meta.code);
    if (!bars?.length)
      throw new Error(`标的 ${meta.code} 在 bars.csv 中无数据`);
    const isCash = isCashCreationMeta(meta, cashCodes);
    const rowsForCode = paramRows.filter((p) => p.etf_code === meta.code);
    if (!rowsForCode.length) {
      if (isCash) {
        const prow = placeholderParamRow(meta);
        return {
          meta,
          params: paramsFromRow(prow),
          bars,
          paramVariants: [],
        };
      }
      throw new Error(`etf_params.csv 无 etf_code=${meta.code}`);
    }
    const prow = findParamRow(paramRows, meta);
    if (prow.param_version && prow.param_version !== meta.param_version) {
      throw new Error(
        `标的 ${meta.code}: etfs.param_version=${meta.param_version} 与默认行 etf_params.param_version=${prow.param_version} 不一致`,
      );
    }
    const paramVariants = isCash
      ? []
      : buildParamVariantList(meta, rowsForCode);
    return {
      meta,
      params: paramsFromRow(prow),
      bars,
      paramVariants,
    };
  });

  return { definitions, bondByDate };
}

export function identifyCsv(
  name: string,
): "etfs" | "bars" | "bonds" | "etf_params" | null {
  const n = name.toLowerCase().trim();
  if (n === "etfs.csv" || n.endsWith("/etfs.csv")) return "etfs";
  if (n === "bars.csv" || n.endsWith("/bars.csv")) return "bars";
  if (n === "bonds.csv" || n.endsWith("/bonds.csv")) return "bonds";
  if (n === "etf_params.csv" || n.endsWith("/etf_params.csv"))
    return "etf_params";
  return null;
}

export function identifyFundBarsCsv(name: string): boolean {
  const n = name.toLowerCase().trim();
  return n === "fund_bars.csv" || n.endsWith("/fund_bars.csv");
}

/** 可选补充 CSV，与主文件同名结构；可与 bars/bonds/etfs 等一并选择。 */
export function identifyOptionalMergeCsv(
  name: string,
): keyof CsvMergeOptions | null {
  const n = name.toLowerCase().trim();
  if (n === "etfsmore.csv" || n.endsWith("/etfsmore.csv")) return "etfsMore";
  if (n === "barsmore.csv" || n.endsWith("/barsmore.csv")) return "barsMore";
  if (n === "bondsmore.csv" || n.endsWith("/bondsmore.csv")) return "bondsMore";
  if (n === "etf_products.csv" || n.endsWith("/etf_products.csv"))
    return "etfProducts";
  return null;
}

export async function readFilesAsBundle(files: FileList | File[]): Promise<{
  bundle: AppDataBundle;
  indexCsvError: string | null;
}> {
  const arr = Array.from(files);
  let etfs = "";
  let bars = "";
  let bonds = "";
  let params = "";
  let indicesText = "";
  let indexBarsText = "";
  let indexTrackingText = "";
  const merge: Partial<CsvMergeOptions> = {};
  for (const f of arr) {
    const idxKind = identifyIndexCsv(f.name);
    if (idxKind) {
      const text = await f.text();
      if (idxKind === "indices") indicesText = text;
      else if (idxKind === "index_bars") indexBarsText = text;
      else indexTrackingText = text;
      continue;
    }
    if (identifyFundBarsCsv(f.name)) {
      merge.fundBars = await f.text();
      continue;
    }
    const opt = identifyOptionalMergeCsv(f.name);
    if (opt) {
      const text = await f.text();
      if (opt === "etfsMore") merge.etfsMore = text;
      else if (opt === "barsMore") merge.barsMore = text;
      else if (opt === "bondsMore") merge.bondsMore = text;
      else merge.etfProducts = text;
      continue;
    }
    const kind = identifyCsv(f.name);
    if (!kind) {
      throw new Error(
        `无法识别文件: ${f.name}（必选 bars.csv；bonds.csv、etfs.csv、etf_params.csv 可省略；可选 etfsmore / barsmore / bondsmore / fund_bars.csv；指数可选 indices.csv、index_bars.csv、index_tracking_etfs.csv）`,
      );
    }
    const text = await f.text();
    if (kind === "etfs") etfs = text;
    if (kind === "bars") bars = text;
    if (kind === "bonds") bonds = text;
    if (kind === "etf_params") params = text;
  }
  if (!bars.trim()) {
    throw new Error(
      "请选择 bars.csv（必选）：须含产品代码、日期、收盘价或净值。bonds.csv、etfs.csv、etf_params.csv 可省略；bonds 若含国债收益率或额外行情会与 bars 合并。",
    );
  }
  const hasMerge = Boolean(
    merge.etfsMore ||
      merge.barsMore ||
      merge.bondsMore ||
      merge.fundBars ||
      merge.etfProducts,
  );
  const base = buildCsvBundle(
    etfs,
    bars,
    bonds,
    params,
    hasMerge ? (merge as CsvMergeOptions) : undefined,
  );
  const { bundle, indexCsvError } = withIndexCsvSafe(
    base,
    indicesText,
    indexBarsText,
    indexTrackingText,
  );
  const allDates = new Set<string>();
  for (const def of bundle.definitions) {
    for (const b of def.bars) allDates.add(b.date);
  }
  for (const ix of bundle.indices) {
    for (const b of ix.bars) allDates.add(b.date);
  }
  const mainBondList = parseBondsFileDualPurpose(bonds).yieldCurve;
  const moreBondList = merge.bondsMore?.trim()
    ? parseBondsFileDualPurpose(merge.bondsMore).yieldCurve
    : [];
  const bondList =
    mainBondList.length && moreBondList.length
      ? mergeBondSeries(mainBondList, moreBondList)
      : moreBondList.length
        ? moreBondList
        : mainBondList;
  return {
    bundle: {
      ...bundle,
      bondByDate: expandBondsToBarDates(bondList, [...allDates].sort()),
    },
    indexCsvError,
  };
}
