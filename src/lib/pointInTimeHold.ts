import type { EtfParams, OhlcBar } from "../types";
import { computeSignals } from "./strategy";

/**
 * 假设在指定交易日 **以收盘价买入**，之后仅按策略信号在出现 **SELL** 时平仓（忽略买入信号加仓）。
 * 用于「任意时点买入」的简化验证；与全样本回测的建仓节奏不同，结论仅供对照。
 */
export function forwardHoldFromBuyDay(
  bars: OhlcBar[],
  buyDate: string,
  params: EtfParams,
  strategyId: string,
): {
  buyDate: string;
  exitDate: string | null;
  holdDays: number;
  pnlPct: number;
  mddWhileHeldPct: number;
  note: string;
} | null {
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const buyIdx = sorted.findIndex((b) => b.date === buyDate);
  if (buyIdx < 0) return null;
  const sig = computeSignals(sorted, params, strategyId);
  const entry = sorted[buyIdx]!.close;
  if (entry <= 0) return null;
  let peak = entry;
  let maxDd = 0;
  let exitIdx: number | null = null;
  for (let i = buyIdx + 1; i < sorted.length; i++) {
    const c = sorted[i]!.close;
    if (c > peak) peak = c;
    maxDd = Math.max(maxDd, (peak - c) / peak);
    if (sig[i] === "SELL") {
      exitIdx = i;
      break;
    }
  }
  const endIdx = exitIdx ?? sorted.length - 1;
  const exitClose = sorted[endIdx]!.close;
  const pnlPct = Math.round((exitClose / entry - 1) * 100 * 100) / 100;
  const mddWhileHeldPct = Math.round(maxDd * 10000) / 100;
  const holdDays = endIdx - buyIdx;
  const note =
    exitIdx != null
      ? `于 ${sorted[exitIdx]!.date} 按策略 SELL 信号平仓。`
      : "样本内未再出现 SELL，按最后一日收盘计价。";
  return {
    buyDate,
    exitDate: exitIdx != null ? sorted[exitIdx]!.date : null,
    holdDays,
    pnlPct,
    mddWhileHeldPct,
    note,
  };
}
