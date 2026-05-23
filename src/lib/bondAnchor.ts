import type { BondAnchorId } from "../types";
import type { IndexDefinition, IndexMarket } from "../types";

export const HK_BOND_ANCHOR_LS = "desk.hkBondAnchor.v1";
export const HK_BOND_ANCHOR_EVENT = "desk:hkBondAnchor";

/** A 股与港股红利利差默认均对齐中国 10 年期国债；港股可在界面切换美债基准 */
export function defaultBondAnchorForMarket(_market: IndexMarket): BondAnchorId {
  return "CN_10Y";
}

export function getHkBondAnchorPreference(): BondAnchorId {
  if (typeof window === "undefined") return "CN_10Y";
  try {
    const v = localStorage.getItem(HK_BOND_ANCHOR_LS);
    if (v === "US_10Y" || v === "CN_10Y") return v;
  } catch {
    /* ignore */
  }
  return "CN_10Y";
}

export function setHkBondAnchorPreference(anchor: BondAnchorId): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(HK_BOND_ANCHOR_LS, anchor);
    window.dispatchEvent(new CustomEvent(HK_BOND_ANCHOR_EVENT));
  } catch {
    /* ignore */
  }
}

export function resolveBondAnchorForIndex(def: Pick<IndexDefinition, "meta">): BondAnchorId {
  if (def.meta.market === "H") return getHkBondAnchorPreference();
  return defaultBondAnchorForMarket(def.meta.market);
}

export function bondAnchorLabel(anchor: BondAnchorId): string {
  return anchor === "CN_10Y" ? "中国 10 年期国债收益率（%）" : "美国 10 年期国债收益率（%）";
}

export function bondAnchorShortLabel(anchor: BondAnchorId): string {
  return anchor === "CN_10Y" ? "中国10年期国债" : "美国10年期国债";
}

export function bondYieldFromRow(
  bondRow: { cn10y_pct: number; us10y_pct: number } | undefined,
  anchor: BondAnchorId,
  fallbackCn = 2.5,
  fallbackUs = 4.0
): number {
  if (!bondRow) return anchor === "CN_10Y" ? fallbackCn : fallbackUs;
  return anchor === "CN_10Y" ? bondRow.cn10y_pct : bondRow.us10y_pct;
}
