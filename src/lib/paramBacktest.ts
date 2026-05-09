import type { EtfParams, OhlcBar } from "../types";
import { buildEquitySeries, buildTrades, equityReturnMetrics } from "./backtest";
import { computeSignals } from "./strategy";

export type StrategyFamily = "ma" | "rsi" | "boll";

export type ScoredParamRow = {
  family: StrategyFamily;
  label: string;
  strategyId: string;
  paramVersion: string;
  params: EtfParams;
  cumReturnPct: number;
  maxDrawdownPct: number;
  score: number;
};

const MA_GRID: { fast: number; slow: number }[] = [
  { fast: 5, slow: 20 },
  { fast: 5, slow: 30 },
  { fast: 8, slow: 34 },
  { fast: 10, slow: 30 },
  { fast: 10, slow: 40 },
  { fast: 12, slow: 26 },
];

const RSI_GRID: { period: number; overbought: number; oversold: number }[] = [
  { period: 14, overbought: 72, oversold: 28 },
  { period: 14, overbought: 70, oversold: 30 },
  { period: 21, overbought: 75, oversold: 25 },
  { period: 10, overbought: 75, oversold: 25 },
];

const BOLL_GRID: { period: number; stdDev: number }[] = [
  { period: 20, stdDev: 2 },
  { period: 26, stdDev: 2 },
  { period: 20, stdDev: 2.5 },
  { period: 14, stdDev: 2 },
];

function shellParamsMa(fast: number, slow: number): EtfParams {
  const vid = `ma_bt_${fast}_${slow}`;
  return {
    ma_variants: [{ variant_id: vid, fast, slow }],
    rsi_variants: [{ variant_id: "rsi_shell", period: 14, overbought: 70, oversold: 30 }],
    bollinger_variants: [{ variant_id: "bb_shell", period: 20, stdDev: 2 }],
    strategy_ma_ids: [vid, vid],
    strategy_rsi_id: "rsi_shell",
  };
}

function shellParamsRsi(period: number, overbought: number, oversold: number): EtfParams {
  const vid = `rsi_bt_${period}_${overbought}_${oversold}`;
  return {
    ma_variants: [{ variant_id: "ma_shell", fast: 5, slow: 20 }],
    rsi_variants: [{ variant_id: vid, period, overbought, oversold }],
    bollinger_variants: [{ variant_id: "bb_shell", period: 20, stdDev: 2 }],
    strategy_ma_ids: ["ma_shell", "ma_shell"],
    strategy_rsi_id: vid,
  };
}

function shellParamsBoll(period: number, stdDev: number): EtfParams {
  const vid = `bb_bt_${period}_${stdDev}`;
  return {
    ma_variants: [{ variant_id: "ma_shell", fast: 5, slow: 20 }],
    rsi_variants: [{ variant_id: "rsi_shell", period: 14, overbought: 70, oversold: 30 }],
    bollinger_variants: [{ variant_id: vid, period, stdDev }],
    strategy_ma_ids: ["ma_shell", "ma_shell"],
    strategy_rsi_id: "rsi_shell",
  };
}

function scoreRow(bars: OhlcBar[], params: EtfParams, strategyId: string, label: string, family: StrategyFamily): ScoredParamRow | null {
  if (bars.length < 40) return null;
  const sig = computeSignals(bars, params, strategyId);
  const pv = `bt-${family}-${label.replace(/\s+/g, "_")}`;
  const trades = buildTrades(bars, sig, pv, strategyId);
  const eq = buildEquitySeries(bars, trades);
  const m = equityReturnMetrics(eq);
  const dd = Math.max(m.maxDrawdownPct, 0.01);
  const score = m.cumReturnPct / dd;
  return {
    family,
    label,
    strategyId,
    paramVersion: pv,
    params,
    cumReturnPct: m.cumReturnPct,
    maxDrawdownPct: m.maxDrawdownPct,
    score: Math.round(score * 100) / 100,
  };
}

/** 对单标的 OHLC 做粗网格回测，按 score 排序后取 topK（每类策略独立）。 */
export function gridSearchTopParams(bars: OhlcBar[], topK = 2): {
  ma: ScoredParamRow[];
  rsi: ScoredParamRow[];
  boll: ScoredParamRow[];
} {
  const maRows: ScoredParamRow[] = [];
  for (const { fast, slow } of MA_GRID) {
    if (fast >= slow) continue;
    const p = shellParamsMa(fast, slow);
    const row = scoreRow(bars, p, "str_ma_cn", `MA ${fast}/${slow}`, "ma");
    if (row) maRows.push(row);
  }
  maRows.sort((a, b) => b.score - a.score);

  const rsiRows: ScoredParamRow[] = [];
  for (const g of RSI_GRID) {
    const p = shellParamsRsi(g.period, g.overbought, g.oversold);
    const row = scoreRow(
      bars,
      p,
      "str_rsi_mean_cn",
      `RSI ${g.period} OB${g.overbought}/OS${g.oversold}`,
      "rsi"
    );
    if (row) rsiRows.push(row);
  }
  rsiRows.sort((a, b) => b.score - a.score);

  const bollRows: ScoredParamRow[] = [];
  for (const g of BOLL_GRID) {
    const p = shellParamsBoll(g.period, g.stdDev);
    const row = scoreRow(bars, p, "str_boll_mr", `BB ${g.period}/${g.stdDev}σ`, "boll");
    if (row) bollRows.push(row);
  }
  bollRows.sort((a, b) => b.score - a.score);

  return {
    ma: maRows.slice(0, topK),
    rsi: rsiRows.slice(0, topK),
    boll: bollRows.slice(0, topK),
  };
}
