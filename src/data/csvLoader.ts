import { parseCsv, rowsToObjects } from "../lib/csv";
import type {
  BondSeriesPoint,
  BollingerVariant,
  DivYieldSource,
  DividendMarketScope,
  EtfDefinition,
  EtfMeta,
  EtfParams,
  InvestorChannel,
  OhlcBar,
  ParamStrategyVariant,
  ProductKind,
  RsiVariant,
} from "../types";

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

function mustProductKind(s: string, code: string): ProductKind {
  const t = (s ?? "").trim();
  if (t === "红利_含股息分红" || t === "现金流类") return t;
  /** 兼容简写：ETF 视作红利（需配合 dividend_market_scope） */
  if (t === "ETF" || t.toLowerCase() === "etf") return "红利_含股息分红";
  throw new Error(`product_kind 无效: ${s}（标的 ${code}；请使用 红利_含股息分红 / 现金流类 / ETF）`);
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

function parseDocLinks(raw: string | undefined): { label: string; href: string }[] | undefined {
  if (!raw || !raw.trim()) return undefined;
  try {
    const j = JSON.parse(raw) as { label: string; href: string }[];
    if (!Array.isArray(j)) return undefined;
    return j.filter((x) => x && typeof x.href === "string");
  } catch {
    return undefined;
  }
}

export type CsvBundle = {
  definitions: EtfDefinition[];
  bondByDate: Record<string, BondSeriesPoint>;
};

export function parseEtfsCsv(text: string): EtfMeta[] {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("etfs.csv 无数据行");
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
      div_yield_nominal_pct: num(r.div_yield_nominal_pct ?? "0", "div_yield_nominal_pct"),
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
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("bars.csv 无数据行");
  const headers = rows[0];
  const list = rowsToObjects(headers, rows.slice(1));
  const map = new Map<string, OhlcBar[]>();
  for (const r of list) {
    const code = r.etf_code?.trim();
    if (!code) throw new Error("bars.csv 存在空 etf_code");
    const bar: OhlcBar = {
      date: r.date?.trim() || (() => {
        throw new Error("bars.csv 缺少 date");
      })(),
      open: num(r.open ?? "", "open"),
      high: num(r.high ?? "", "high"),
      low: num(r.low ?? "", "low"),
      close: num(r.close ?? "", "close"),
    };
    if (!map.has(code)) map.set(code, []);
    map.get(code)!.push(bar);
  }
  for (const [code, bars] of map) {
    bars.sort((a, b) => a.date.localeCompare(b.date));
    const seen = new Set<string>();
    for (const b of bars) {
      if (seen.has(b.date)) throw new Error(`bars.csv 标的 ${code} 重复日期 ${b.date}`);
      seen.add(b.date);
    }
  }
  return map;
}

/** 读 bonds.csv：空单元格沿用上一行有效值（文件内前向填充） */
export function parseBondsCsvToList(text: string): BondSeriesPoint[] {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("bonds.csv 无数据行");
  const headers = rows[0];
  const list = rowsToObjects(headers, rows.slice(1));
  let lastCn = 2.5;
  let lastUs = 4.0;
  const out: BondSeriesPoint[] = [];
  for (const r of list) {
    const date = r.date?.trim();
    if (!date) throw new Error("bonds.csv 缺少 date");
    const cnRaw = r.cn10y_pct?.trim();
    const usRaw = r.us10y_pct?.trim();
    if (cnRaw) lastCn = num(cnRaw, "cn10y_pct");
    if (usRaw) lastUs = num(usRaw, "us10y_pct");
    out.push({ date, cn10y_pct: lastCn, us10y_pct: lastUs });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/** 将国债序列对齐到 K 线每一个交易日：对每个 bar 日期取「最近且不晚于该日」的国债观测 */
export function expandBondsToBarDates(
  bondSeries: BondSeriesPoint[],
  barDates: string[]
): Record<string, BondSeriesPoint> {
  if (!bondSeries.length) throw new Error("bonds.csv 无有效行");
  const sorted = [...bondSeries].sort((a, b) => a.date.localeCompare(b.date));
  const out: Record<string, BondSeriesPoint> = {};
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
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("etf_params.csv 无数据行");
  const headers = rows[0];
  const list = rowsToObjects(headers, rows.slice(1));
  return list.map((r) => {
    const rsiPeriod = optNum(r.rsi_period) ?? optNum(r.rsi_window) ?? 14;
    const bbPeriod = optNum(r.bb_period) ?? optNum(r.boll_window) ?? 20;
    const bbStd = optNum(r.bb_std) ?? optNum(r.boll_std) ?? 2;
    const maFast = optNum(r.ma_fast) ?? 5;
    const maSlow = optNum(r.ma_slow) ?? 20;
    return {
      etf_code: r.etf_code?.trim() || (() => {
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

function paramsFromRow(row: ParamRow): EtfParams {
  const ma_variants = [{ variant_id: "ma_csv", fast: row.ma_fast, slow: row.ma_slow }];
  const rsi_variants: RsiVariant[] = [
    {
      variant_id: "rsi_csv",
      period: row.rsi_period,
      overbought: row.rsi_overbought,
      oversold: row.rsi_oversold,
    },
  ];
  const bollinger_variants: BollingerVariant[] = [
    { variant_id: "bb_csv", period: row.bb_period, stdDev: row.bb_std },
  ];
  return {
    ma_variants,
    rsi_variants,
    bollinger_variants,
    strategy_ma_ids: ["ma_csv", "ma_csv"],
    strategy_rsi_id: "rsi_csv",
  };
}

function buildParamVariantList(meta: EtfMeta, rowsForCode: ParamRow[]): ParamStrategyVariant[] {
  return rowsForCode.map((row, i) => ({
    key: `${meta.code}|${i}|${row.param_version ?? ""}|${row.strategy_id ?? ""}`,
    label: row.note?.trim() || row.param_version?.trim() || `参数组 ${i + 1}`,
    strategyId: row.strategy_id?.trim() || meta.strategy_id,
    paramVersion: row.param_version?.trim() || meta.param_version,
    params: paramsFromRow(row),
  }));
}

function findParamRow(rows: ParamRow[], meta: EtfMeta): ParamRow {
  const forCode = rows.filter((p) => p.etf_code === meta.code);
  if (forCode.length === 0) throw new Error(`etf_params.csv 无 etf_code=${meta.code}`);
  const withVer = forCode.filter((p) => p.param_version && p.param_version.trim() !== "");
  if (withVer.length) {
    const m = withVer.filter((p) => p.param_version === meta.param_version);
    if (m.length === 1) return m[0];
    if (m.length === 0) {
      throw new Error(`etf_params 无 param_version=${meta.param_version} 的行: ${meta.code}`);
    }
    throw new Error(`etf_params 中 ${meta.code} 匹配 param_version=${meta.param_version} 多于一行`);
  }
  if (forCode.length === 1) return forCode[0];
  throw new Error(`etf_params 中 ${meta.code} 有多行且未提供 param_version，无法与 etfs 对齐`);
}

export function buildCsvBundle(
  etfsText: string,
  barsText: string,
  bondsText: string,
  paramsText: string
): CsvBundle {
  const metas = parseEtfsCsv(etfsText);
  const barsMap = parseBarsCsv(barsText);
  const paramRows = parseEtfParamsCsv(paramsText);

  const allBarDates = new Set<string>();
  for (const bars of barsMap.values()) {
    for (const b of bars) allBarDates.add(b.date);
  }
  const barDatesSorted = [...allBarDates].sort();
  const bondList = parseBondsCsvToList(bondsText);
  const bondByDate = expandBondsToBarDates(bondList, barDatesSorted);

  const definitions: EtfDefinition[] = metas.map((meta) => {
    const bars = barsMap.get(meta.code);
    if (!bars?.length) throw new Error(`标的 ${meta.code} 在 bars.csv 中无数据`);
    const rowsForCode = paramRows.filter((p) => p.etf_code === meta.code);
    if (!rowsForCode.length) throw new Error(`etf_params.csv 无 etf_code=${meta.code}`);
    const prow = findParamRow(paramRows, meta);
    if (prow.strategy_id && prow.strategy_id !== meta.strategy_id) {
      throw new Error(`标的 ${meta.code}: etfs.strategy_id=${meta.strategy_id} 与默认行 etf_params.strategy_id=${prow.strategy_id} 不一致`);
    }
    if (prow.param_version && prow.param_version !== meta.param_version) {
      throw new Error(`标的 ${meta.code}: etfs.param_version=${meta.param_version} 与默认行 etf_params.param_version=${prow.param_version} 不一致`);
    }
    const paramVariants = buildParamVariantList(meta, rowsForCode);
    return {
      meta,
      params: paramsFromRow(prow),
      bars,
      paramVariants,
    };
  });

  return { definitions, bondByDate };
}

export function identifyCsv(name: string): "etfs" | "bars" | "bonds" | "etf_params" | null {
  const n = name.toLowerCase().trim();
  if (n === "etfs.csv" || n.endsWith("/etfs.csv")) return "etfs";
  if (n === "bars.csv" || n.endsWith("/bars.csv")) return "bars";
  if (n === "bonds.csv" || n.endsWith("/bonds.csv")) return "bonds";
  if (n === "etf_params.csv" || n.endsWith("/etf_params.csv")) return "etf_params";
  return null;
}

export async function readFilesAsBundle(files: FileList | File[]): Promise<CsvBundle> {
  const arr = Array.from(files);
  let etfs = "";
  let bars = "";
  let bonds = "";
  let params = "";
  for (const f of arr) {
    const kind = identifyCsv(f.name);
    if (!kind) throw new Error(`无法识别文件（请命名为 etfs.csv / bars.csv / bonds.csv / etf_params.csv）: ${f.name}`);
    const text = await f.text();
    if (kind === "etfs") etfs = text;
    if (kind === "bars") bars = text;
    if (kind === "bonds") bonds = text;
    if (kind === "etf_params") params = text;
  }
  if (!etfs || !bars || !bonds || !params) {
    throw new Error("请一次选择四个文件：etfs.csv、bars.csv、bonds.csv、etf_params.csv");
  }
  return buildCsvBundle(etfs, bars, bonds, params);
}
