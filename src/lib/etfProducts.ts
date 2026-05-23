import { parseCsv, rowsToObjects } from "./csv";
import type { EtfDefinition, IndexDefinition, IndexTrackingRow } from "../types";

export type EtfProductGroupId =
  | "cash_creation"
  | "shareholder_return_cn"
  | "shareholder_return_hk"
  | "otc_fund"
  | "other";

export type EtfProductDataStatus = "ok" | "partial" | "missing" | "needs_review";

export type EtfProduct = {
  code: string;
  name: string;
  product_group: EtfProductGroupId;
  index_code: string;
  index_name: string;
  exchange?: "SH" | "SZ" | "OTC";
  issuer?: string;
  listed_date?: string;
  first_trade_date?: string;
  aum_cny?: number;
  management_fee_pct?: number;
  custody_fee_pct?: number;
  total_fee_pct?: number;
  avg_daily_turnover_cny?: number;
  latest_premium_discount_pct?: number;
  tracking_error_pct?: number;
  is_primary: boolean;
  source_url?: string;
  updated_at?: string;
  data_status: EtfProductDataStatus;
  note?: string;
};

export type EtfProductLandingGroups<T = EtfProduct> = Record<EtfProductGroupId, T[]> & {
  cash: T[];
  cn: T[];
  hk: T[];
  otc: T[];
};

export type EtfProductRecord = {
  code: string;
  name: string;
  group: EtfProductGroupId;
  productGroup: EtfProductGroupId;
  indexCode: string;
  indexName: string;
  exchange?: "SH" | "SZ" | "OTC";
  issuer?: string;
  listedDate?: string;
  firstTradeDate?: string;
  aumCny?: number;
  managementFeePct?: number;
  custodyFeePct?: number;
  totalFeePct?: number;
  feePct?: number;
  avgDailyTurnoverCny?: number;
  latestPremiumDiscountPct?: number;
  trackingErrorPct?: number;
  isPrimary: boolean;
  sourceUrl?: string;
  updatedAt?: string;
  dataStatus: EtfProductDataStatus;
  note?: string;
};

export const ETF_PRODUCT_GROUP_LABELS: Record<
  EtfProductGroupId,
  { title: string; subtitle: string; emptyText: string }
> = {
  cash_creation: {
    title: "现金创造",
    subtitle: "",
    emptyText: "暂无",
  },
  shareholder_return_cn: {
    title: "A 股红利",
    subtitle: "",
    emptyText: "暂无",
  },
  shareholder_return_hk: {
    title: "港股红利",
    subtitle: "",
    emptyText: "暂无",
  },
  otc_fund: {
    title: "场外基金",
    subtitle: "",
    emptyText: "暂无",
  },
  other: {
    title: "其他",
    subtitle: "",
    emptyText: "暂无",
  },
};

const GROUPS: EtfProductGroupId[] = [
  "cash_creation",
  "shareholder_return_cn",
  "shareholder_return_hk",
  "otc_fund",
  "other",
];

function optNum(raw: string | undefined): number | undefined {
  if (raw == null || String(raw).trim() === "") return undefined;
  const v = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(v) ? v : undefined;
}

function mustGroup(raw: string): EtfProductGroupId {
  const value = raw.trim();
  if ((GROUPS as string[]).includes(value)) return value as EtfProductGroupId;
  throw new Error(`etf_products.csv product_group 无效: ${raw}`);
}

function mustStatus(raw: string): EtfProductDataStatus {
  const value = raw.trim();
  const statuses: EtfProductDataStatus[] = ["ok", "partial", "missing", "needs_review"];
  if ((statuses as string[]).includes(value)) return value as EtfProductDataStatus;
  throw new Error(`etf_products.csv data_status 无效: ${raw}`);
}

function optExchange(raw: string | undefined): EtfProduct["exchange"] {
  const value = raw?.trim();
  if (!value) return undefined;
  if (value === "SH" || value === "SZ" || value === "OTC") return value;
  return undefined;
}

export function normalizeEtfProductRow(row: Record<string, string>): EtfProduct {
  const code = row.code?.trim();
  const indexCode = row.index_code?.trim();
  if (!code) throw new Error("etf_products.csv 存在缺少 code 的行");
  if (!indexCode) throw new Error(`etf_products.csv 产品 ${code} 缺少 index_code`);
  return {
    code,
    name: row.name?.trim() || code,
    product_group: mustGroup(row.product_group ?? ""),
    index_code: indexCode,
    index_name: row.index_name?.trim() || indexCode,
    exchange: optExchange(row.exchange),
    issuer: row.issuer?.trim() || undefined,
    listed_date: row.listed_date?.trim() || undefined,
    first_trade_date: row.first_trade_date?.trim() || undefined,
    aum_cny: optNum(row.aum_cny),
    management_fee_pct: optNum(row.management_fee_pct),
    custody_fee_pct: optNum(row.custody_fee_pct),
    total_fee_pct: optNum(row.total_fee_pct),
    avg_daily_turnover_cny: optNum(row.avg_daily_turnover_cny),
    latest_premium_discount_pct: optNum(row.latest_premium_discount_pct),
    tracking_error_pct: optNum(row.tracking_error_pct),
    is_primary: (row.is_primary ?? "").trim().toLowerCase() === "true",
    source_url: row.source_url?.trim() || undefined,
    updated_at: row.updated_at?.trim() || undefined,
    data_status: mustStatus(row.data_status ?? ""),
    note: row.note?.trim() || undefined,
  };
}

export function parseEtfProductsCsv(text: string): EtfProduct[] {
  if (!text?.trim()) return [];
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const [headers, ...body] = rows;
  return rowsToObjects(headers, body).map(normalizeEtfProductRow);
}

function productGroupOf(product: EtfProduct | EtfProductRecord): EtfProductGroupId {
  return "product_group" in product ? product.product_group : product.group;
}

function productIndexCodeOf(product: EtfProduct | EtfProductRecord): string {
  return "index_code" in product ? product.index_code : product.indexCode;
}

function productPrimaryOf(product: EtfProduct | EtfProductRecord): boolean {
  return "is_primary" in product ? product.is_primary : product.isPrimary;
}

function productFirstTradeDateOf(product: EtfProduct | EtfProductRecord): string | undefined {
  return "first_trade_date" in product ? product.first_trade_date : (product as EtfProductRecord).firstTradeDate;
}

function productSortKey(product: EtfProduct | EtfProductRecord): string {
  return `${productGroupOf(product)}:${productIndexCodeOf(product)}:${productPrimaryOf(product) ? "0" : "1"}:${productFirstTradeDateOf(product) || "9999"}:${product.code}`;
}

export function groupEtfProductsForLanding<T extends EtfProduct | EtfProductRecord>(products: T[]): EtfProductLandingGroups<T> {
  const grouped: EtfProductLandingGroups<T> = {
    cash_creation: [],
    shareholder_return_cn: [],
    shareholder_return_hk: [],
    otc_fund: [],
    other: [],
    cash: [],
    cn: [],
    hk: [],
    otc: [],
  };
  for (const product of products) {
    grouped[productGroupOf(product)].push(product);
  }
  for (const group of GROUPS) {
    grouped[group].sort((a, b) => productSortKey(a).localeCompare(productSortKey(b)));
  }
  grouped.cash = grouped.cash_creation;
  grouped.cn = grouped.shareholder_return_cn;
  grouped.hk = grouped.shareholder_return_hk;
  grouped.otc = grouped.otc_fund;
  return grouped;
}

export function getProductsForIndex(products: EtfProduct[], indexCode: string): EtfProduct[] {
  return products
    .filter((product) => product.index_code === indexCode)
    .sort((a, b) => productSortKey(a).localeCompare(productSortKey(b)));
}

export function getPrimaryProductForIndex(products: EtfProduct[], indexCode: string): EtfProduct | undefined {
  const matches = getProductsForIndex(products, indexCode);
  return matches.find((product) => product.is_primary) ?? matches[0];
}

export function etfProductDataStatusLabel(status: EtfProductDataStatus): string {
  switch (status) {
    case "ok":
      return "数据可用";
    case "partial":
      return "样本偏短";
    case "missing":
      return "暂无行情";
    case "needs_review":
      return "待核实";
    default:
      return "—";
  }
}

export const productDataStatusLabel = etfProductDataStatusLabel;

/** 产品页等面向用户的简短状态说明 */
export function productDataStatusHint(status: EtfProductDataStatus): string {
  switch (status) {
    case "ok":
      return "行情已同步";
    case "partial":
      return "属性已更新，行情待同步";
    case "missing":
      return "待上市或暂无行情";
    case "needs_review":
      return "待人工核实";
    default:
      return "—";
  }
}

export function productDataStatusTone(status: EtfProductDataStatus): "good" | "warn" | "muted" {
  if (status === "ok") return "good";
  if (status === "partial" || status === "needs_review") return "warn";
  return "muted";
}

function toRecord(product: EtfProduct): EtfProductRecord {
  return {
    code: product.code,
    name: product.name,
    group: product.product_group,
    productGroup: product.product_group,
    indexCode: product.index_code,
    indexName: product.index_name,
    exchange: product.exchange,
    issuer: product.issuer,
    listedDate: product.listed_date,
    firstTradeDate: product.first_trade_date,
    aumCny: product.aum_cny,
    managementFeePct: product.management_fee_pct,
    custodyFeePct: product.custody_fee_pct,
    totalFeePct: product.total_fee_pct,
    feePct: product.total_fee_pct,
    avgDailyTurnoverCny: product.avg_daily_turnover_cny,
    latestPremiumDiscountPct: product.latest_premium_discount_pct,
    trackingErrorPct: product.tracking_error_pct,
    isPrimary: product.is_primary,
    sourceUrl: product.source_url,
    updatedAt: product.updated_at,
    dataStatus: product.data_status,
    note: product.note,
  };
}

export function parseEtfProductRecordsCsv(text: string): EtfProductRecord[] {
  return parseEtfProductsCsv(text).map(toRecord);
}

function indexToGroup(index: IndexDefinition | undefined, productType: IndexTrackingRow["product_type"]): EtfProductGroupId {
  if (productType === "otc_fund") return "otc_fund";
  if (index?.meta.category === "现金流") return "cash_creation";
  if (index?.meta.category === "港股红利") return "shareholder_return_hk";
  return "shareholder_return_cn";
}

function inferExchange(code: string, productType: IndexTrackingRow["product_type"]): EtfProductRecord["exchange"] {
  if (productType === "otc_fund") return "OTC";
  if (/^(50|51|52|53|56|58)/.test(code)) return "SH";
  if (/^(15|16|18)/.test(code)) return "SZ";
  return undefined;
}

function firstTradeDateFor(definitions: EtfDefinition[], code: string): string | undefined {
  const def = definitions.find((item) => item.meta.code === code);
  return def?.bars[0]?.date;
}

export function buildEtfProductCatalog({
  definitions,
  indices,
  indexTracking,
  csvText,
}: {
  definitions: EtfDefinition[];
  indices: IndexDefinition[];
  indexTracking: IndexTrackingRow[];
  csvText?: string | null;
}): EtfProductRecord[] {
  if (csvText?.trim()) return parseEtfProductRecordsCsv(csvText);
  const seen = new Set<string>();
  return indexTracking.map((row) => {
    const index = indices.find((item) => item.meta.index_code === row.index_code);
    const def = definitions.find((item) => item.meta.code === row.etf_code);
    const isPrimary = !seen.has(row.index_code);
    seen.add(row.index_code);
    return {
      code: row.etf_code,
      name: def?.meta.name ?? row.note ?? row.etf_code,
      group: indexToGroup(index, row.product_type),
      productGroup: indexToGroup(index, row.product_type),
      indexCode: row.index_code,
      indexName: index?.meta.name ?? row.index_code,
      exchange: inferExchange(row.etf_code, row.product_type),
      listedDate: row.listed_date,
      firstTradeDate: firstTradeDateFor(definitions, row.etf_code),
      totalFeePct: row.fee_pct,
      feePct: row.fee_pct,
      isPrimary,
      dataStatus: firstTradeDateFor(definitions, row.etf_code) ? "ok" : "missing",
      note: row.note,
    };
  });
}

function recordSortKey(product: EtfProductRecord): string {
  return `${product.group}:${product.indexCode}:${product.isPrimary ? "0" : "1"}:${product.firstTradeDate || "9999"}:${product.code}`;
}

export function groupEtfProductRecordsForLanding(products: EtfProductRecord[]): Record<EtfProductGroupId, EtfProductRecord[]> {
  const grouped: Record<EtfProductGroupId, EtfProductRecord[]> = {
    cash_creation: [],
    shareholder_return_cn: [],
    shareholder_return_hk: [],
    otc_fund: [],
    other: [],
  };
  for (const product of products) grouped[product.group].push(product);
  for (const group of GROUPS) grouped[group].sort((a, b) => recordSortKey(a).localeCompare(recordSortKey(b)));
  return grouped;
}

export function productsForIndex(products: EtfProductRecord[], indexCode: string): EtfProductRecord[] {
  return products.filter((product) => product.indexCode === indexCode).sort((a, b) => recordSortKey(a).localeCompare(recordSortKey(b)));
}

export function primaryProductForIndex(products: EtfProductRecord[], indexCode: string): EtfProductRecord | undefined {
  const matches = productsForIndex(products, indexCode);
  return matches.find((product) => product.isPrimary) ?? matches[0];
}

const PRODUCT_GROUP_SORT: Record<EtfProductGroupId, number> = {
  cash_creation: 0,
  shareholder_return_cn: 1,
  shareholder_return_hk: 2,
  otc_fund: 3,
  other: 4,
};

/** 从 note 提取「候选维度」摘要（规模/费率等） */
export function productCandidateTags(note?: string): string[] {
  if (!note?.trim()) return [];
  const m = note.match(/候选维度：([^；]+)/);
  if (!m?.[1]) return [];
  return m[1]
    .split(/[、/]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
}

export type DeskCandidateRow = {
  code: string;
  name: string;
  etfCode: string;
  productCount: number;
  referenceCount: number;
};

/** 配置驾驶舱「代表入口」：按观察池指数聚合，主产品来自 is_primary */
export function buildDeskCandidates(
  indices: { meta: { index_code: string; name: string } }[],
  products: EtfProductRecord[]
): DeskCandidateRow[] {
  const primaryByIndex = new Map<string, string>();
  const countByIndex = new Map<string, number>();
  const groupByIndex = new Map<string, EtfProductGroupId>();

  for (const p of products) {
    countByIndex.set(p.indexCode, (countByIndex.get(p.indexCode) ?? 0) + 1);
    if (p.isPrimary) {
      primaryByIndex.set(p.indexCode, p.code);
      groupByIndex.set(p.indexCode, p.productGroup);
    } else if (!groupByIndex.has(p.indexCode)) {
      groupByIndex.set(p.indexCode, p.productGroup);
    }
  }

  return [...countByIndex.keys()]
    .map((code) => {
      const def = indices.find((ix) => ix.meta.index_code === code);
      const total = countByIndex.get(code) ?? 0;
      return {
        code,
        name: def?.meta.name ?? products.find((p) => p.indexCode === code)?.indexName ?? code,
        etfCode: primaryByIndex.get(code) ?? "—",
        productCount: total,
        referenceCount: Math.max(0, total - (primaryByIndex.has(code) ? 1 : 0)),
      };
    })
    .sort((a, b) => {
      const ga = PRODUCT_GROUP_SORT[groupByIndex.get(a.code) ?? "other"];
      const gb = PRODUCT_GROUP_SORT[groupByIndex.get(b.code) ?? "other"];
      if (ga !== gb) return ga - gb;
      return a.name.localeCompare(b.name, "zh-Hans-CN");
    });
}

export type EtfProductsByIndexGroup = {
  indexCode: string;
  indexName: string;
  productGroup: EtfProductGroupId;
  products: EtfProductRecord[];
};

/** 产品选择页：按跟踪指数聚合，组内主跟踪优先 */
export function groupEtfProductsByIndex(products: EtfProductRecord[]): EtfProductsByIndexGroup[] {
  const byIndex = new Map<string, EtfProductRecord[]>();
  for (const product of products) {
    const list = byIndex.get(product.indexCode) ?? [];
    list.push(product);
    byIndex.set(product.indexCode, list);
  }
  return [...byIndex.entries()]
    .map(([indexCode, indexProducts]) => {
      const sorted = [...indexProducts].sort((a, b) => {
        if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
        const da = a.firstTradeDate ?? "9999";
        const db = b.firstTradeDate ?? "9999";
        if (da !== db) return da.localeCompare(db);
        return a.code.localeCompare(b.code);
      });
      return {
        indexCode,
        indexName: sorted[0]?.indexName ?? indexCode,
        productGroup: sorted[0]?.productGroup ?? "other",
        products: sorted,
      };
    })
    .sort((a, b) => {
      const ga = PRODUCT_GROUP_SORT[a.productGroup];
      const gb = PRODUCT_GROUP_SORT[b.productGroup];
      if (ga !== gb) return ga - gb;
      return a.indexName.localeCompare(b.indexName, "zh-Hans-CN");
    });
}

export function maxEtfProductsUpdatedAt(products: EtfProductRecord[]): string | null {
  let max = "";
  for (const product of products) {
    const u = product.updatedAt?.trim();
    if (u && u > max) max = u;
  }
  return max || null;
}

export function indexCodesForProductGroup(
  products: EtfProductRecord[],
  group: EtfProductGroupId | "shareholder_return"
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of products) {
    if (!p.isPrimary) continue;
    const match =
      group === "shareholder_return"
        ? p.productGroup === "shareholder_return_cn" || p.productGroup === "shareholder_return_hk"
        : p.productGroup === group;
    if (!match || seen.has(p.indexCode)) continue;
    seen.add(p.indexCode);
    out.push(p.indexCode);
  }
  return out;
}
