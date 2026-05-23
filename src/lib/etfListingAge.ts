import type { EtfDefinition } from "../types";

/** 成立/首交易满该年限才默认展示 ETF 策略回测（指数详情仍按基日展示） */
export const ETF_MIN_BACKTEST_YEARS = 2;

type ListingProductMeta = {
  firstTradeDate?: string;
  listedDate?: string;
};

function parseYmd(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 产品成立/首交易起点：优先 etf_products，否则日 K 首根 */
/** 已上市可交易：本地有日 K，或 etf_products 已记录首交易日 */
export function isEtfProductListed(
  etf: EtfDefinition | undefined,
  product?: ListingProductMeta | null
): boolean {
  if (etf?.bars.length) return true;
  const start = (product?.firstTradeDate ?? product?.listedDate ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(start);
}

export function etfListingStartDate(
  etf: EtfDefinition,
  product?: ListingProductMeta | null
): string | undefined {
  const fromProduct = (product?.firstTradeDate ?? product?.listedDate ?? "").trim();
  if (fromProduct && parseYmd(fromProduct)) return fromProduct;
  if (!etf.bars.length) return undefined;
  const sorted = [...etf.bars].sort((a, b) => a.date.localeCompare(b.date));
  return sorted[0]?.date;
}

export function etfListingYears(
  etf: EtfDefinition,
  product?: ListingProductMeta | null,
  asOfDate?: string
): number | null {
  const start = etfListingStartDate(etf, product);
  if (!start) return null;
  const startD = parseYmd(start);
  if (!startD) return null;
  const sorted = [...etf.bars].sort((a, b) => a.date.localeCompare(b.date));
  const asOf = (asOfDate ?? sorted[sorted.length - 1]?.date ?? "").trim();
  const endD = parseYmd(asOf) ?? new Date();
  return (endD.getTime() - startD.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

export function etfBacktestEligible(
  etf: EtfDefinition,
  product?: ListingProductMeta | null,
  minYears: number = ETF_MIN_BACKTEST_YEARS
): boolean {
  const years = etfListingYears(etf, product);
  if (years == null) return false;
  return years >= minYears;
}

export function etfBacktestIneligibleReason(
  etf: EtfDefinition,
  product?: ListingProductMeta | null,
  minYears: number = ETF_MIN_BACKTEST_YEARS
): string {
  const start = etfListingStartDate(etf, product);
  const years = etfListingYears(etf, product);
  if (!start) return "未识别首交易日，默认不展示策略回测。";
  if (years == null) return "成立时长无法计算，默认不展示策略回测。";
  const y = years < 1 ? `${Math.round(years * 12)} 个月` : `${years.toFixed(1)} 年`;
  return `成立约 ${y}（首交易 ${start}），未满 ${minYears} 年，默认不展示策略回测。`;
}

export type EtfDashboardTabId = "backtest" | "intraday" | "ledger" | "methodology";

/** 策略回测入口应打开的页签：满 {ETF_MIN_BACKTEST_YEARS} 年为回测，否则落到盘中监控。 */
export function etfDashboardStrategyTab(
  etf: EtfDefinition,
  product?: ListingProductMeta | null
): "backtest" | "intraday" {
  return etfBacktestEligible(etf, product) ? "backtest" : "intraday";
}

export function etfDashboardHref(
  code: string,
  tab: EtfDashboardTabId,
  etf?: EtfDefinition,
  product?: ListingProductMeta | null
): string {
  let effective: EtfDashboardTabId = tab;
  if (etf && !etfBacktestEligible(etf, product) && (tab === "backtest" || tab === "ledger")) {
    effective = "intraday";
  }
  return `/etf/${encodeURIComponent(code)}?tab=${effective}`;
}
