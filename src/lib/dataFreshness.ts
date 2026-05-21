import type { EtfDefinition, IndexDefinition } from "../types";

/** 全库 ETF + 指数 K 线中的最新交易日 */
export function latestTradeDate(
  definitions: EtfDefinition[],
  indices: IndexDefinition[]
): string | null {
  let max = "";
  for (const d of definitions) {
    for (const b of d.bars) {
      if (b.date > max) max = b.date;
    }
  }
  for (const ix of indices) {
    for (const b of ix.bars) {
      if (b.date > max) max = b.date;
    }
  }
  return max || null;
}
