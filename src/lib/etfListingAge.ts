import type { EtfDefinition } from "../types";

/** 策略研究页：满该年限可执行网格回测 */
export const ETF_REGISTRY_MIN_BACKTEST_YEARS = 1;

/** ETF 详情页：满该年限才展示策略回测 / 信号台账（指数详情仍按基日展示） */
export const ETF_MIN_BACKTEST_YEARS = 2;

export type EtfStrategyProductMeta = ListingProductMeta & {
  productGroup?: string;
};

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
  product?: ListingProductMeta | null,
): boolean {
  if (etf?.bars.length) return true;
  const start = (product?.firstTradeDate ?? product?.listedDate ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(start);
}

export function isCashCreationEtf(
  etf: EtfDefinition,
  product?: EtfStrategyProductMeta | null,
): boolean {
  if (product?.productGroup === "cash_creation") return true;
  return etf.meta.product_kind === "现金流类";
}

export function etfListingStartDate(
  etf: EtfDefinition,
  product?: ListingProductMeta | null,
): string | undefined {
  const fromProduct = (
    product?.firstTradeDate ??
    product?.listedDate ??
    ""
  ).trim();
  if (fromProduct && parseYmd(fromProduct)) return fromProduct;
  if (!etf.bars.length) return undefined;
  const sorted = [...etf.bars].sort((a, b) => a.date.localeCompare(b.date));
  return sorted[0]?.date;
}

export function etfListingYears(
  etf: EtfDefinition,
  product?: ListingProductMeta | null,
  asOfDate?: string,
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

function listingYearsLabel(years: number): string {
  return years < 1 ? `${Math.round(years * 12)} 个月` : `${years.toFixed(1)} 年`;
}

/** 满年限且非现金流类：可展示 ETF 层策略回测 / 盘中信号 / 登记参数 */
export function etfProductStrategyEligible(
  etf: EtfDefinition,
  product?: EtfStrategyProductMeta | null,
  minYears: number = ETF_MIN_BACKTEST_YEARS,
): boolean {
  if (isCashCreationEtf(etf, product)) return false;
  const years = etfListingYears(etf, product);
  if (years == null) return false;
  return years >= minYears;
}

export function etfProductStrategyIneligibleReason(
  etf: EtfDefinition,
  product?: EtfStrategyProductMeta | null,
  minYears: number = ETF_MIN_BACKTEST_YEARS,
): string {
  if (isCashCreationEtf(etf, product)) {
    return "现金流类产品不登记 ETF 层策略参数，策略回测与盘中信号暂不适用。";
  }
  const start = etfListingStartDate(etf, product);
  const years = etfListingYears(etf, product);
  if (!start) {
    return "未识别首交易日，成立时间过短，策略置信度不足，暂不展示策略相关内容。";
  }
  if (years == null) {
    return "成立时长无法计算，策略置信度不足，暂不展示策略相关内容。";
  }
  const y = listingYearsLabel(years);
  if (years < minYears) {
    return `成立约 ${y}（首交易 ${start}），未满 ${minYears} 年，成立时间过短，策略置信度不足，暂不展示策略回测与盘中信号。`;
  }
  return "";
}

export function etfBacktestEligible(
  etf: EtfDefinition,
  product?: EtfStrategyProductMeta | null,
  minYears: number = ETF_MIN_BACKTEST_YEARS,
): boolean {
  return etfProductStrategyEligible(etf, product, minYears);
}

export function etfBacktestIneligibleReason(
  etf: EtfDefinition,
  product?: EtfStrategyProductMeta | null,
  minYears: number = ETF_MIN_BACKTEST_YEARS,
): string {
  const reason = etfProductStrategyIneligibleReason(etf, product, minYears);
  if (reason) return reason;
  return "暂不展示策略回测。";
}

export type EtfDashboardTabId =
  | "backtest"
  | "intraday"
  | "ledger"
  | "methodology";

/** 策略回测入口应打开的页签：可展示策略时为回测，否则指数研究入口。 */
export function etfDashboardStrategyTab(
  etf: EtfDefinition,
  product?: EtfStrategyProductMeta | null,
): "backtest" | "intraday" {
  return etfProductStrategyEligible(etf, product) ? "backtest" : "intraday";
}

export function etfDashboardHref(
  code: string,
  tab: EtfDashboardTabId,
  etf?: EtfDefinition,
  product?: EtfStrategyProductMeta | null,
): string {
  let effective: EtfDashboardTabId = tab;
  if (
    etf &&
    !etfProductStrategyEligible(etf, product) &&
    (tab === "backtest" || tab === "ledger" || tab === "intraday")
  ) {
    effective = "methodology";
  }
  return `/etf/${encodeURIComponent(code)}?tab=${effective}`;
}
