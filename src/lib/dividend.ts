import type { BondAnchorId, BondSeriesPoint, EtfDefinition } from "../types";

export function bondAnchorForEtf(etf: EtfDefinition): BondAnchorId | null {
  if (etf.meta.product_kind !== "红利_含股息分红") return null;
  if (!etf.meta.dividend_market_scope) return null;
  return etf.meta.dividend_market_scope === "A股红利" ? "CN_10Y" : "US_10Y";
}

export type SpreadRow = {
  date: string;
  price: number;
  divYieldPct: number;
  bondYieldPct: number;
  spreadPct: number;
};

export function buildSpreadSeries(
  etf: EtfDefinition,
  bondByDate: Record<string, BondSeriesPoint>
): SpreadRow[] {
  const anchor = bondAnchorForEtf(etf);
  if (!anchor) return [];
  const nominal = etf.meta.div_yield_nominal_pct;
  return etf.bars.map((b) => {
    const bondRow = bondByDate[b.date];
    const bondYieldPct =
      anchor === "CN_10Y" ? bondRow?.cn10y_pct ?? 2.5 : bondRow?.us10y_pct ?? 4.2;
    return {
      date: b.date,
      price: b.close,
      divYieldPct: nominal,
      bondYieldPct: bondYieldPct,
      spreadPct: Math.round((nominal - bondYieldPct) * 100) / 100,
    };
  });
}
