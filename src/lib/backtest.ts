import type { EtfParams, MaCustomRule, OhlcBar, TradePoint } from "../types";
import type { Signal } from "./strategy";

/**
 * 与 computeSignalsMaCustom 一致：自买入日下一根起逐日检查，**首次**满足止盈或回撤的收盘目录入卖因；
 * 同日双触则「止盈+回撤（同日）」。
 */
function maCustomSellTriggerLabel(bars: OhlcBar[], entryIdx: number, exitIdx: number, rule: MaCustomRule): string {
  const closes = bars.map((b) => b.close);
  const entry = closes[entryIdx]!;
  let peak = entry;
  for (let j = entryIdx + 1; j <= exitIdx; j++) {
    peak = Math.max(peak, closes[j]!);
    const pnl = ((closes[j]! - entry) / entry) * 100;
    const dd = peak > 0 ? ((peak - closes[j]!) / peak) * 100 : 0;
    const hitP = pnl >= rule.profitTakePct;
    const hitD = dd >= rule.trailDrawdownPct;
    if (hitP || hitD) {
      if (hitP && hitD) return "止盈+回撤（同日）";
      if (hitP) return "止盈";
      return "回撤";
    }
  }
  return "止盈或回撤";
}

function triggerLabel(strategyId: string, side: "BUY" | "SELL"): string {
  const s = strategyId.toLowerCase();
  if (s.includes("ma_custom")) return side === "BUY" ? "MA上穿" : "止盈或回撤";
  if (s.includes("boll")) return side === "BUY" ? "下轨" : "上轨";
  if (s.includes("rsi")) return side === "BUY" ? "超卖" : "超买";
  return side === "BUY" ? "金叉" : "死叉";
}

/**
 * 单仓模型：持仓中再次出现 BUY 时不新增流水，仅刷新参考买入价/日（与下一笔 SELL 的盈亏一致）。
 */
export function buildTrades(
  bars: OhlcBar[],
  signals: Signal[],
  paramVersion: string,
  strategyId: string,
  params?: EtfParams | null
): TradePoint[] {
  const sid = strategyId.toLowerCase();
  const rule = sid.includes("ma_custom") && params?.ma_custom_rule ? params.ma_custom_rule : null;
  const trades: TradePoint[] = [];
  let lastBuyIdx: number | null = null;
  for (let i = 0; i < bars.length; i++) {
    if (signals[i] === "BUY") {
      if (lastBuyIdx == null) {
        lastBuyIdx = i;
        trades.push({
          date: bars[i].date,
          side: "BUY",
          price: bars[i].close,
          reason: triggerLabel(strategyId, "BUY"),
          param_version: paramVersion,
        });
      } else {
        lastBuyIdx = i;
      }
      continue;
    }
    if (signals[i] === "SELL" && lastBuyIdx != null) {
      const buy = bars[lastBuyIdx].close;
      const sell = bars[i].close;
      const pnl = ((sell - buy) / buy) * 100;
      const holdDays = i - lastBuyIdx;
      const sellReason =
        rule != null ? maCustomSellTriggerLabel(bars, lastBuyIdx, i, rule) : triggerLabel(strategyId, "SELL");
      trades.push({
        date: bars[i].date,
        side: "SELL",
        price: sell,
        reason: sellReason,
        param_version: paramVersion,
        holdDays,
        pnlPct: Math.round(pnl * 100) / 100,
      });
      lastBuyIdx = null;
    }
  }
  return trades;
}

/** 按 K 线顺序，每日收盘后权益（全仓进出；持仓中按收盘对净值做 MTM） */
export function buildEquitySeries(bars: OhlcBar[], trades: TradePoint[]): number[] {
  if (!bars.length) return [];
  const byDate = new Map<string, TradePoint[]>();
  for (const t of trades) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date)!.push(t);
  }
  let eq = 1;
  let inPos = false;
  let entry = 1;
  const series: number[] = [];
  for (const bar of bars) {
    const day = byDate.get(bar.date);
    if (day) {
      for (const t of day) {
        if (t.side === "BUY") {
          inPos = true;
          entry = t.price;
        } else if (t.side === "SELL" && inPos) {
          eq *= t.price / entry;
          inPos = false;
        }
      }
    }
    if (inPos) series.push(eq * (bar.close / entry));
    else series.push(eq);
  }
  return series;
}

export function equityReturnMetrics(series: number[]): {
  cumReturnPct: number;
  maxDrawdownPct: number;
  annualVolPct: number;
} {
  if (series.length < 2) {
    return { cumReturnPct: 0, maxDrawdownPct: 0, annualVolPct: 0 };
  }
  const a = series[0];
  const b = series[series.length - 1];
  const cumReturnPct = Math.round((b / a - 1) * 10000) / 100;
  let peak = series[0];
  let maxDd = 0;
  for (const v of series) {
    if (v > peak) peak = v;
    maxDd = Math.max(maxDd, (peak - v) / peak);
  }
  const rets: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const p = series[i - 1];
    if (p !== 0) rets.push(series[i] / p - 1);
  }
  if (rets.length < 2) {
    return {
      cumReturnPct,
      maxDrawdownPct: Math.round(maxDd * 10000) / 100,
      annualVolPct: 0,
    };
  }
  const mean = rets.reduce((x, y) => x + y, 0) / rets.length;
  const varSample = rets.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (rets.length - 1);
  const dailyVol = Math.sqrt(Math.max(0, varSample));
  const annualVolPct = Math.round(dailyVol * Math.sqrt(252) * 10000) / 100;
  return {
    cumReturnPct,
    maxDrawdownPct: Math.round(maxDd * 10000) / 100,
    annualVolPct,
  };
}

export function performanceFromTrades(trades: TradePoint[]): {
  cumReturnPct: number;
  maxDrawdownPct: number;
  winRate: number;
  annualVolPct: number;
} {
  const sells = trades.filter((t) => t.side === "SELL" && t.pnlPct != null);
  const wins = sells.filter((t) => (t.pnlPct ?? 0) > 0).length;
  const winRate = sells.length ? wins / sells.length : 0;
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  const rets: number[] = [];
  for (const t of sells) {
    const r = (t.pnlPct ?? 0) / 100;
    rets.push(r);
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, (peak - equity) / peak);
  }
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const var_ =
    rets.length > 1 ? rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1) : 0;
  const vol = rets.length > 1 ? Math.sqrt(var_) * Math.sqrt(252) * 100 : 0;
  return {
    cumReturnPct: Math.round((equity - 1) * 10000) / 100,
    maxDrawdownPct: Math.round(maxDd * 10000) / 100,
    winRate: Math.round(winRate * 1000) / 1000,
    annualVolPct: Math.round(vol * 100) / 100,
  };
}
