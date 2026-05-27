import type { OhlcBar, RoundTripDetail, TradePoint } from "../types";
import { buildEquitySeries, equityReturnMetrics } from "./backtest";

function barIndexByDate(bars: OhlcBar[], date: string): number {
  return bars.findIndex((b) => b.date === date);
}

export function buildRoundTrips(
  trades: TradePoint[],
): Omit<RoundTripDetail, "round" | "buyNav" | "sellNav">[] {
  const ordered = [...trades]
    .filter((t) => t.side === "BUY" || t.side === "SELL")
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: Omit<RoundTripDetail, "round" | "buyNav" | "sellNav">[] = [];
  let buy: TradePoint | null = null;
  for (const t of ordered) {
    if (t.side === "BUY") buy = t;
    else if (t.side === "SELL" && buy) {
      out.push({
        buyDate: buy.date,
        sellDate: t.date,
        buyPrice: buy.price,
        sellPrice: t.price,
        buyTrigger: buy.reason,
        sellTrigger: t.reason,
        pnlPct: t.pnlPct ?? 0,
        holdDays: t.holdDays ?? 0,
      });
      buy = null;
    }
  }
  return out;
}

export function buyHoldReturnPct(bars: OhlcBar[]): number {
  if (bars.length < 2) return 0;
  const a = bars[0].close;
  const b = bars[bars.length - 1].close;
  return Math.round((b / a - 1) * 100 * 100) / 100;
}

/** 按成交流水：最后一笔为买则视为当前仍持仓 */
export function findOpenBuy(trades: TradePoint[]): TradePoint | null {
  const ordered = [...trades]
    .filter((t) => t.side === "BUY" || t.side === "SELL")
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!ordered.length) return null;
  const last = ordered[ordered.length - 1];
  return last.side === "BUY" ? last : null;
}

export function attachNavToRounds(
  rounds: Omit<RoundTripDetail, "round" | "buyNav" | "sellNav">[],
): RoundTripDetail[] {
  let nav = 1;
  return rounds.map((r, i) => {
    const buyNav = nav;
    nav *= 1 + r.pnlPct / 100;
    const sellNav = nav;
    return {
      round: i + 1,
      buyNav: Math.round(buyNav * 10000) / 10000,
      sellNav: Math.round(sellNav * 10000) / 10000,
      ...r,
    };
  });
}

export function avgFlatDays(
  bars: OhlcBar[],
  rounds: RoundTripDetail[],
): number {
  if (rounds.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < rounds.length; i++) {
    const ia = barIndexByDate(bars, rounds[i - 1].sellDate);
    const ib = barIndexByDate(bars, rounds[i].buyDate);
    if (ia < 0 || ib < 0) continue;
    const d = ib - ia - 1;
    if (d > 0) gaps.push(d);
  }
  if (!gaps.length) return 0;
  return (
    Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 100) / 100
  );
}

/** 与 avgFlatDays 一致：完成买卖轮次不足 2 时不展示均值 */
export const MIN_ROUNDS_FOR_AVG_HOLD_FLAT_DAYS = 2;

export const HOLD_FLAT_AVG_TOO_FEW_ROUNDS_NOTE =
  "买卖轮数太少，未计算平均持仓/空仓天数";

export function canComputeAvgHoldFlatDays(roundCount: number): boolean {
  return roundCount >= MIN_ROUNDS_FOR_AVG_HOLD_FLAT_DAYS;
}

export function formatAvgHoldDaysDisplay(
  roundCount: number,
  avgHoldDays: number,
): string {
  return canComputeAvgHoldFlatDays(roundCount) ? String(avgHoldDays) : "/";
}

export function formatAvgFlatDaysDisplay(
  roundCount: number,
  avgFlatDays: number,
): string {
  return canComputeAvgHoldFlatDays(roundCount) ? String(avgFlatDays) : "/";
}

export function formatAvgHoldFlatPairDisplay(
  roundCount: number,
  avgHoldDays: number,
  avgFlatDays: number,
): string {
  if (!canComputeAvgHoldFlatDays(roundCount)) return "/ /";
  return `${avgHoldDays} / ${avgFlatDays}`;
}

export type BacktestSummary = {
  /** 与权益曲线末值一致：区间首日至末日收盘的净值变化（%） */
  strategyReturnPct: number;
  buyHoldReturnPct: number;
  excessReturnPct: number;
  maxDrawdownPct: number;
  annualVolPct: number;
  winRate: number;
  roundCount: number;
  pairedBuyCount: number;
  pairedSellCount: number;
  pendingBuyCount: number;
  rawBuyCount: number;
  rawSellCount: number;
  avgHoldDays: number;
  avgFlatDays: number;
  position: "持仓" | "空仓";
};

export function computeBacktestSummary(
  bars: OhlcBar[],
  trades: TradePoint[],
  rounds: RoundTripDetail[],
): BacktestSummary {
  const bh = buyHoldReturnPct(bars);
  const series = buildEquitySeries(bars, trades);
  const em = equityReturnMetrics(series);
  const st = em.cumReturnPct;
  const sells = trades.filter((t) => t.side === "SELL" && t.pnlPct != null);
  const buys = trades.filter((t) => t.side === "BUY");
  const wins = sells.filter((t) => (t.pnlPct ?? 0) > 0).length;
  const winRate = sells.length
    ? Math.round((wins / sells.length) * 1000) / 1000
    : 0;
  const open = findOpenBuy(trades);
  const closedRounds = rounds.length;
  const pendingBuyCount = open ? 1 : 0;
  const avgHold =
    rounds.length > 0
      ? Math.round(
          (rounds.reduce((a, r) => a + r.holdDays, 0) / rounds.length) * 100,
        ) / 100
      : 0;
  const flat = avgFlatDays(bars, rounds);
  return {
    strategyReturnPct: st,
    buyHoldReturnPct: bh,
    excessReturnPct: Math.round((st - bh) * 100) / 100,
    maxDrawdownPct: em.maxDrawdownPct,
    annualVolPct: em.annualVolPct,
    winRate,
    roundCount: closedRounds,
    pairedBuyCount: closedRounds,
    pairedSellCount: closedRounds,
    pendingBuyCount,
    rawBuyCount: buys.length,
    rawSellCount: trades.filter((t) => t.side === "SELL").length,
    avgHoldDays: avgHold,
    avgFlatDays: flat,
    position: open ? "持仓" : "空仓",
  };
}
