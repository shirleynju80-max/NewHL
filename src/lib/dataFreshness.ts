import type { EtfDefinition, IndexDefinition } from "../types";

/** 全库 ETF + 指数 K 线中的最新交易日 */
export function latestTradeDate(
  definitions: EtfDefinition[],
  indices: IndexDefinition[],
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

/** 交易日 YYYY-MM-DD 距「今日」日历天数（仅日期，不含时分） */
export function daysSinceTradeDate(
  tradeDate: string,
  asOf: Date = new Date(),
): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tradeDate.trim());
  if (!m) return null;
  const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const diff = Math.round((now.getTime() - then.getTime()) / 86_400_000);
  return diff >= 0 ? diff : null;
}
