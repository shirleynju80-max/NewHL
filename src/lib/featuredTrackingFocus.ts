import type { EtfDefinition } from "../types";
import type { EtfProductRecord } from "./etfProducts";

/** 与精选跟踪页 FOCUS_ITEMS 保持一致 */
export type FeaturedFocusDimension = "cash" | "dividend";

/** 展示顺序用：A 股红利 → 港股红利 → 现金流（不在 UI 展示分组名） */
export type FeaturedFocusMarketGroup = "a_dividend" | "hk_dividend" | "cash";

export type FeaturedFocusItem = {
  dimension: FeaturedFocusDimension;
  marketGroup: FeaturedFocusMarketGroup;
  indexCode: string;
  reason: string;
};

const MARKET_GROUP_RANK: Record<FeaturedFocusMarketGroup, number> = {
  a_dividend: 0,
  hk_dividend: 1,
  cash: 2,
};

export const FEATURED_FOCUS_ITEMS: FeaturedFocusItem[] = [
  {
    dimension: "dividend",
    marketGroup: "a_dividend",
    indexCode: "H30269",
    reason: "中证红利低波动代表，主跟踪 512890，与红利低波 100 形成互补观察。",
  },
  {
    dimension: "dividend",
    marketGroup: "a_dividend",
    indexCode: "930955",
    reason: "A 股红利低波 100 代表，替代高度相关的中证红利/上证红利观察位。",
  },
  {
    dimension: "dividend",
    marketGroup: "a_dividend",
    indexCode: "SPCLLHCP.SPI",
    reason: "标普中国 A 股大盘红利低波 50，保留不同编制商与大盘风格口径。",
  },
  {
    dimension: "dividend",
    marketGroup: "a_dividend",
    indexCode: "931157",
    reason: "沪港深红利成长低波动，兼顾红利释放与成长质量。",
  },
  {
    dimension: "dividend",
    marketGroup: "hk_dividend",
    indexCode: "HSSCSOY.HI",
    reason: "港股通中国央企红利代表，补充港股央企现金回报敞口。",
  },
  {
    dimension: "dividend",
    marketGroup: "hk_dividend",
    indexCode: "HSI114",
    reason: "恒生港股通高股息低波动代表，偏防御与现金回报。",
  },
  {
    dimension: "cash",
    marketGroup: "cash",
    indexCode: "980092",
    reason: "现金创造代表，适合作为长期定投观察与质量底仓候选。",
  },
];

/** 精选跟踪 ETF 策略表等：按 marketGroup 与 FEATURED_FOCUS_ITEMS 顺序排序 */
export function compareFeaturedFocusIndexCodes(a: string, b: string): number {
  const itemA = FEATURED_FOCUS_ITEMS.find((i) => i.indexCode === a);
  const itemB = FEATURED_FOCUS_ITEMS.find((i) => i.indexCode === b);
  const rankA = itemA ? MARKET_GROUP_RANK[itemA.marketGroup] : 99;
  const rankB = itemB ? MARKET_GROUP_RANK[itemB.marketGroup] : 99;
  if (rankA !== rankB) return rankA - rankB;
  const idxA = FEATURED_FOCUS_ITEMS.findIndex((i) => i.indexCode === a);
  const idxB = FEATURED_FOCUS_ITEMS.findIndex((i) => i.indexCode === b);
  return (idxA < 0 ? 999 : idxA) - (idxB < 0 ? 999 : idxB);
}

export type FeaturedFocusRow = {
  item: FeaturedFocusItem;
  product: EtfProductRecord | undefined;
  etf: EtfDefinition | undefined;
};

export function dimensionLabel(dimension: FeaturedFocusDimension): string {
  return dimension === "cash" ? "现金创造" : "股东回报";
}

export function resolveFeaturedFocusRows(
  products: EtfProductRecord[],
  getEtf: (code: string) => EtfDefinition | undefined,
): FeaturedFocusRow[] {
  return FEATURED_FOCUS_ITEMS.map((item) => {
    const product = products.find(
      (p) => p.indexCode === item.indexCode && p.isPrimary,
    );
    return {
      item,
      product,
      etf: product ? getEtf(product.code) : undefined,
    };
  });
}
