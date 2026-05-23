import { bondYieldFromRow, getHkBondAnchorPreference } from "./bondAnchor";
import type { BondAnchorId, BondSeriesPoint, EtfDefinition } from "../types";

export function bondAnchorForEtf(etf: EtfDefinition): BondAnchorId | null {
  if (etf.meta.product_kind !== "红利_含股息分红") return null;
  if (!etf.meta.dividend_market_scope) return null;
  return etf.meta.dividend_market_scope === "A股红利" ? "CN_10Y" : getHkBondAnchorPreference();
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
  bondByDate: Record<string, BondSeriesPoint>,
  bondAnchor?: BondAnchorId
): SpreadRow[] {
  const anchor = bondAnchor ?? bondAnchorForEtf(etf);
  if (!anchor) return [];
  const fallbackNominal = etf.meta.div_yield_nominal_pct;
  let lastExplicit: number | undefined;
  return etf.bars.map((b) => {
    const raw = b.div_yield_nominal_pct;
    if (typeof raw === "number" && !Number.isNaN(raw)) {
      lastExplicit = raw;
    }
    const divYieldPct = lastExplicit ?? fallbackNominal;
    const bondRow = bondByDate[b.date];
    const bondYieldPct = bondYieldFromRow(bondRow, anchor, 2.5, 4.2);
    return {
      date: b.date,
      price: b.close,
      divYieldPct,
      bondYieldPct: bondYieldPct,
      spreadPct: Math.round((divYieldPct - bondYieldPct) * 100) / 100,
    };
  });
}
