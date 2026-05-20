import type { EtfParams, MaCustomRule, OhlcBar } from "../types";
import { buildEquitySeries, buildTrades, equityReturnMetrics } from "./backtest";
import { attachNavToRounds, buildRoundTrips, buyHoldReturnPct, computeBacktestSummary } from "./backtestSummary";
import { bollinger, closesFromBars, rsi } from "./indicators";
import { computeSignals, type Signal } from "./strategy";
import { mondayKey, weeklyLastCloses } from "./weeklyAlign";

function maxDrawdownFromCloses(closes: number[]): number {
  if (closes.length < 2) return 0;
  let peak = closes[0];
  let maxDd = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    maxDd = Math.max(maxDd, (peak - c) / peak);
  }
  return maxDd;
}

function annualizedBuyHoldPct(closes: number[]): number {
  if (closes.length < 2) return 0;
  const n = closes.length;
  const ratio = closes[n - 1]! / closes[0]!;
  if (ratio <= 0) return 0;
  return (Math.pow(ratio, 252 / (n - 1)) - 1) * 100;
}

export type StrategyFamily = "ma" | "ma_custom" | "rsi" | "boll";

export type ScoredParamRow = {
  family: StrategyFamily;
  label: string;
  strategyId: string;
  paramVersion: string;
  params: EtfParams;
  /** 与 computeBacktestSummary.strategyReturnPct 一致（全样本权益曲线） */
  cumReturnPct: number;
  maxDrawdownPct: number;
  /** 累计收益 / 最大回撤，用于排序 */
  score: number;
  buyHoldReturnPct: number;
  excessReturnPct: number;
  /** 训练段 vs 买入持有超额；切片不足 MIN_SLICE_BARS 时为 null */
  excessTrainPct: number | null;
  /** 验证段 vs 买入持有超额；切片不足 MIN_SLICE_BARS 时为 null */
  excessValPct: number | null;
  /** 完整买卖对数（有配对的 SELL） */
  roundCount: number;
  rawBuyCount: number;
  rawSellCount: number;
  avgHoldDays: number;
  avgFlatDays: number;
  /** 已平仓卖出笔中盈利占比 */
  winRate: number;
};

export type GridSearchMeta = {
  startDate: string;
  endDate: string;
  barCount: number;
  buyHoldReturnPct: number;
  /** 买入持有年化 %（252 交易日） */
  buyHoldAnnualPct: number;
  /** 买入持有全程最大回撤 % */
  buyHoldMaxDrawdownPct: number;
};

/** 时间序训练 / 验证切分说明与可信度 */
export type GridSearchSplitMeta = {
  trainRatio: number;
  trainStartDate: string;
  trainEndDate: string;
  valStartDate: string;
  valEndDate: string;
  trainBarCount: number;
  valBarCount: number;
  credibility: "ok" | "weak_sample" | "short_train_slice" | "short_val_slice" | "no_candidates";
  notes: string[];
};

export type GridSearchOutcome = {
  meta: GridSearchMeta;
  split: GridSearchSplitMeta;
  /** 全网格合并：验证段超额最优（稳健优选） */
  globalRobustBest: ScoredParamRow | null;
  /** 全网格合并：全样本超额最优（全周期优选） */
  globalFullBest: ScoredParamRow | null;
  maCross: ScoredParamRow[];
  maCustom: ScoredParamRow[];
  rsi: ScoredParamRow[];
  boll: ScoredParamRow[];
};

/** 训练集占比（时间序前段），默认 0.7；单端最低约 5% 由切分逻辑保证 */
export type GridSearchOptions = {
  trainRatio?: number;
};

/** 系统默认参数搜索范围（可在「策略回测与注册」页覆盖） */
export type ParamSearchSnapshot = {
  maCrossFast: number[];
  maCrossSlow: number[];
  maCustomBuyMa: number[];
  maCustomProfitPct: number[];
  maCustomDrawdownPct: number[];
  rsiModes: ("1d" | "1w")[];
  rsiPeriods: number[];
  rsiOversold: number[];
  rsiOverbought: number[];
  bollModes: ("1d" | "1w")[];
  bollPeriods: number[];
  bollStd: number[];
};

export const DEFAULT_PARAM_SEARCH: ParamSearchSnapshot = {
  maCrossFast: [5, 10, 20, 30],
  maCrossSlow: [60, 120, 250],
  maCustomBuyMa: [120, 250],
  maCustomProfitPct: [6, 8, 10, 12],
  maCustomDrawdownPct: [4, 6, 8],
  rsiModes: ["1d", "1w"],
  rsiPeriods: [6, 12, 24],
  rsiOversold: [20, 25, 30, 35, 40],
  rsiOverbought: [70, 75, 80, 85, 90],
  bollModes: ["1d", "1w"],
  bollPeriods: [20, 40, 60, 80, 100, 120],
  bollStd: [1.5, 2.0, 2.5, 3.0],
};

export function mergeParamSearch(p?: Partial<ParamSearchSnapshot>): ParamSearchSnapshot {
  return { ...DEFAULT_PARAM_SEARCH, ...p };
}

const MIN_SLICE_BARS = 40;
const WEAK_SAMPLE_BARS = 504;

function splitChronoTrainVal(bars: OhlcBar[], trainRatio: number): { train: OhlcBar[]; val: OhlcBar[]; splitIdx: number } {
  const r = Math.min(0.95, Math.max(0.05, trainRatio));
  const splitIdx = Math.max(1, Math.min(bars.length - 1, Math.floor(bars.length * r)));
  return { train: bars.slice(0, splitIdx), val: bars.slice(splitIdx), splitIdx };
}

function attachTrainValExcess(
  row: ScoredParamRow,
  barsTrain: OhlcBar[],
  barsVal: OhlcBar[],
  rescore: (bx: OhlcBar[]) => ScoredParamRow | null
): ScoredParamRow {
  const t = barsTrain.length >= MIN_SLICE_BARS ? rescore(barsTrain) : null;
  const v = barsVal.length >= MIN_SLICE_BARS ? rescore(barsVal) : null;
  return {
    ...row,
    excessTrainPct: t?.excessReturnPct ?? null,
    excessValPct: v?.excessReturnPct ?? null,
  };
}

/** 表格排序：优先验证段超额，其次全样本超额与收益/回撤分 */
function sortRowsByValThenFull(rows: ScoredParamRow[]) {
  rows.sort((a, b) => {
    const av = a.excessValPct;
    const bv = b.excessValPct;
    if (av != null && bv != null && Math.abs(av - bv) > 1e-9) return bv - av;
    if (av != null && bv == null) return -1;
    if (av == null && bv != null) return 1;
    if (b.excessReturnPct !== a.excessReturnPct) return b.excessReturnPct - a.excessReturnPct;
    return b.score - a.score;
  });
}

export function sameScoredParamRow(a: ScoredParamRow, b: ScoredParamRow): boolean {
  return a.family === b.family && a.strategyId === b.strategyId && a.paramVersion === b.paramVersion && a.label === b.label;
}

function buildSplitMeta(
  bars: OhlcBar[],
  train: OhlcBar[],
  val: OhlcBar[],
  trainRatio: number,
  candidateCount: number
): GridSearchSplitMeta {
  const notes: string[] = [];
  let credibility: GridSearchSplitMeta["credibility"] = "ok";
  if (candidateCount === 0) {
    credibility = "no_candidates";
    notes.push("网格内无有效参数组合（样本或切片过短可能导致无法评分）。");
  }
  if (candidateCount > 0 && train.length < MIN_SLICE_BARS) {
    credibility = "short_train_slice";
    notes.push(`训练段仅 ${train.length} 根日K（建议≥${MIN_SLICE_BARS}），训练段指标可信度低。`);
  } else if (candidateCount > 0 && val.length < MIN_SLICE_BARS) {
    credibility = "short_val_slice";
    notes.push(`验证段仅 ${val.length} 根日K（建议≥${MIN_SLICE_BARS}），「稳健优选」参考意义有限。`);
  }
  if (candidateCount > 0 && bars.length < WEAK_SAMPLE_BARS && credibility === "ok") {
    credibility = "weak_sample";
    notes.push(`全样本仅 ${bars.length} 个交易日，低频换手机制下统计波动大，结论宜保守解读。`);
  }
  return {
    trainRatio,
    trainStartDate: train[0]?.date ?? "—",
    trainEndDate: train[train.length - 1]?.date ?? "—",
    valStartDate: val[0]?.date ?? "—",
    valEndDate: val[val.length - 1]?.date ?? "—",
    trainBarCount: train.length,
    valBarCount: val.length,
    credibility,
    notes,
  };
}

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

function shellParamsMaCustom(rule: MaCustomRule): EtfParams {
  return {
    ma_variants: [{ variant_id: "mc_shell", fast: 5, slow: 20 }],
    rsi_variants: [{ variant_id: "rsi_shell", period: 14, overbought: 70, oversold: 30 }],
    bollinger_variants: [{ variant_id: "bb_shell", period: 20, stdDev: 2 }],
    strategy_ma_ids: ["mc_shell", "mc_shell"],
    ma_custom_rule: rule,
  };
}

function rsiSignalsFromSeries(series: (number | null)[], ob: number, os: number): Signal[] {
  const sig: Signal[] = series.map(() => "HOLD");
  for (let i = 1; i < series.length; i++) {
    const r = series[i];
    const pr = series[i - 1];
    if (r == null || pr == null) continue;
    if (pr >= os && r < os) sig[i] = "BUY";
    else if (pr <= ob && r > ob) sig[i] = "SELL";
  }
  return sig;
}

function bollSignalsFromBands(closes: number[], upper: (number | null)[], lower: (number | null)[]): Signal[] {
  const sig: Signal[] = closes.map(() => "HOLD");
  for (let i = 1; i < closes.length; i++) {
    const up = upper[i];
    const lo = lower[i];
    const pup = upper[i - 1];
    const plo = lower[i - 1];
    if (up == null || lo == null || pup == null || plo == null) continue;
    const c = closes[i];
    const pc = closes[i - 1];
    if (pc < plo && c >= lo) sig[i] = "BUY";
    else if (pc > pup && c <= up) sig[i] = "SELL";
  }
  return sig;
}

function scoreFromSignals(
  bars: OhlcBar[],
  signals: Signal[],
  strategyId: string,
  label: string,
  family: StrategyFamily,
  params: EtfParams
): ScoredParamRow | null {
  if (bars.length < 40) return null;
  const pv = `bt-${family}-${label.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 96)}`;
  const trades = buildTrades(bars, signals, pv, strategyId, params);
  const rounds = attachNavToRounds(buildRoundTrips(trades));
  const sum = computeBacktestSummary(bars, trades, rounds);
  const eq = buildEquitySeries(bars, trades);
  const m = equityReturnMetrics(eq);
  const dd = Math.max(m.maxDrawdownPct, 0.01);
  const score = sum.strategyReturnPct / dd;
  return {
    family,
    label,
    strategyId,
    paramVersion: pv,
    params,
    cumReturnPct: sum.strategyReturnPct,
    maxDrawdownPct: sum.maxDrawdownPct,
    score: Math.round(score * 100) / 100,
    buyHoldReturnPct: sum.buyHoldReturnPct,
    excessReturnPct: sum.excessReturnPct,
    excessTrainPct: null,
    excessValPct: null,
    roundCount: sum.roundCount,
    rawBuyCount: sum.rawBuyCount,
    rawSellCount: sum.rawSellCount,
    avgHoldDays: sum.avgHoldDays,
    avgFlatDays: sum.avgFlatDays,
    winRate: sum.winRate,
  };
}

function scoreRow(bars: OhlcBar[], params: EtfParams, strategyId: string, label: string, family: StrategyFamily): ScoredParamRow | null {
  if (bars.length < 40) return null;
  const sig = computeSignals(bars, params, strategyId);
  return scoreFromSignals(bars, sig, strategyId, label, family, params);
}

function sortRows(rows: ScoredParamRow[]) {
  sortRowsByValThenFull(rows);
}

function expandWeeklyRsiToDaily(bars: OhlcBar[], period: number): (number | null)[] {
  const w = weeklyLastCloses(bars);
  if (w.length < period + 2) return bars.map(() => null);
  const wc = w.map((x) => x.close);
  const rw = rsi(wc, period);
  const map = new Map<string, number>();
  for (let j = 0; j < w.length; j++) {
    const v = rw[j];
    if (v != null) map.set(w[j].weekMonday, v);
  }
  return bars.map((b) => map.get(mondayKey(b.date)) ?? null);
}

function expandWeeklyBollToDaily(
  bars: OhlcBar[],
  period: number,
  std: number
): { upper: (number | null)[]; lower: (number | null)[] } {
  const w = weeklyLastCloses(bars);
  if (w.length < period + 2) {
    const empty = bars.map(() => null as number | null);
    return { upper: empty, lower: empty };
  }
  const wc = w.map((x) => x.close);
  const { upper: uw, lower: lw } = bollinger(wc, period, std);
  type Band = { u: number; l: number };
  const map = new Map<string, Band>();
  for (let j = 0; j < w.length; j++) {
    const u = uw[j];
    const l = lw[j];
    if (u != null && l != null) map.set(w[j].weekMonday, { u, l });
  }
  const upper = bars.map((b) => map.get(mondayKey(b.date))?.u ?? null);
  const lower = bars.map((b) => map.get(mondayKey(b.date))?.l ?? null);
  return { upper, lower };
}

/** 与单标的页一致：同 bars + params + strategyId 的摘要（用于核验） */
export function backtestSummaryForParams(
  bars: OhlcBar[],
  params: EtfParams,
  strategyId: string,
  paramVersion: string
): ReturnType<typeof computeBacktestSummary> | null {
  if (bars.length < 2) return null;
  const sig = computeSignals(bars, params, strategyId);
  const trades = buildTrades(bars, sig, paramVersion, strategyId, params);
  const rounds = attachNavToRounds(buildRoundTrips(trades));
  return computeBacktestSummary(bars, trades, rounds);
}

/** 对单标的 OHLC 做参数网格回测；全样本指标 + 时间序训练/验证切片超额；表格按验证超额优先排序。 */
export function gridSearchTopParams(
  bars: OhlcBar[],
  topK = 2,
  search?: Partial<ParamSearchSnapshot>,
  options?: GridSearchOptions
): GridSearchOutcome {
  const cfg = mergeParamSearch(search);
  const trainRatio = options?.trainRatio != null ? options.trainRatio : 0.7;
  const { train: barsTrain, val: barsVal } = splitChronoTrainVal(bars, trainRatio);

  const bh = buyHoldReturnPct(bars);
  const buyHoldCloses = bars.map((b) => b.close);
  const mdd = maxDrawdownFromCloses(buyHoldCloses);
  const ann = annualizedBuyHoldPct(buyHoldCloses);
  const meta: GridSearchMeta = {
    startDate: bars[0]!.date,
    endDate: bars[bars.length - 1]!.date,
    barCount: bars.length,
    buyHoldReturnPct: bh,
    buyHoldAnnualPct: Math.round(ann * 100) / 100,
    buyHoldMaxDrawdownPct: Math.round(mdd * 10000) / 100,
  };

  const maCrossRows: ScoredParamRow[] = [];
  for (const fast of cfg.maCrossFast) {
    for (const slow of cfg.maCrossSlow) {
      if (fast >= slow) continue;
      const p = shellParamsMa(fast, slow);
      const label = `MA金叉 ${fast}/${slow}`;
      const row = scoreRow(bars, p, "str_ma_cn", label, "ma");
      if (!row) continue;
      maCrossRows.push(
        attachTrainValExcess(row, barsTrain, barsVal, (bx) => scoreRow(bx, p, "str_ma_cn", label, "ma"))
      );
    }
  }
  sortRows(maCrossRows);

  const maCustomRows: ScoredParamRow[] = [];
  for (const buyMa of cfg.maCustomBuyMa) {
    for (const profit of cfg.maCustomProfitPct) {
      for (const dd of cfg.maCustomDrawdownPct) {
        const rule: MaCustomRule = {
          buyMaPeriod: buyMa,
          profitTakePct: profit,
          trailDrawdownPct: dd,
        };
        const p = shellParamsMaCustom(rule);
        const label = `MA${buyMa} 买入 | 卖：止盈${profit}% 或 回撤≥${dd}%`;
        const row = scoreRow(bars, p, "str_ma_custom", label, "ma_custom");
        if (!row) continue;
        maCustomRows.push(
          attachTrainValExcess(row, barsTrain, barsVal, (bx) => scoreRow(bx, p, "str_ma_custom", label, "ma_custom"))
        );
      }
    }
  }
  sortRows(maCustomRows);

  const rsiRows: ScoredParamRow[] = [];
  for (const mode of cfg.rsiModes) {
    for (const period of cfg.rsiPeriods) {
      for (const os of cfg.rsiOversold) {
        for (const ob of cfg.rsiOverbought) {
          if (os >= ob) continue;
          const p = shellParamsRsi(period, ob, os);
          const label = `RSI${mode === "1w" ? "周" : "日"} p${period} OS${os}/OB${ob}`;
          const scoreRsiOn = (bx: OhlcBar[]): ScoredParamRow | null => {
            const cl = closesFromBars(bx);
            let ser: (number | null)[];
            if (mode === "1d") ser = rsi(cl, period);
            else ser = expandWeeklyRsiToDaily(bx, period);
            const sig = rsiSignalsFromSeries(ser, ob, os);
            return scoreFromSignals(bx, sig, "str_rsi_mean_cn", label, "rsi", p);
          };
          const row = scoreRsiOn(bars);
          if (!row) continue;
          rsiRows.push(attachTrainValExcess(row, barsTrain, barsVal, scoreRsiOn));
        }
      }
    }
  }
  sortRows(rsiRows);

  const bollRows: ScoredParamRow[] = [];
  for (const mode of cfg.bollModes) {
    for (const period of cfg.bollPeriods) {
      for (const std of cfg.bollStd) {
        const p = shellParamsBoll(period, std);
        const label = `BOLL${mode === "1w" ? "周" : "日"} ${period}/${std}σ`;
        const scoreBollOn = (bx: OhlcBar[]): ScoredParamRow | null => {
          const cl = closesFromBars(bx);
          let upper: (number | null)[];
          let lower: (number | null)[];
          if (mode === "1d") {
            const bb = bollinger(cl, period, std);
            upper = bb.upper;
            lower = bb.lower;
          } else {
            const ex = expandWeeklyBollToDaily(bx, period, std);
            upper = ex.upper;
            lower = ex.lower;
          }
          const sig = bollSignalsFromBands(cl, upper, lower);
          return scoreFromSignals(bx, sig, "str_boll_mr", label, "boll", p);
        };
        const row = scoreBollOn(bars);
        if (!row) continue;
        bollRows.push(attachTrainValExcess(row, barsTrain, barsVal, scoreBollOn));
      }
    }
  }
  sortRows(bollRows);

  const allMerged = [...maCrossRows, ...maCustomRows, ...rsiRows, ...bollRows];
  let globalFullBest: ScoredParamRow | null = null;
  let globalRobustBest: ScoredParamRow | null = null;
  for (const r of allMerged) {
    if (globalFullBest == null || r.excessReturnPct > globalFullBest.excessReturnPct) globalFullBest = r;
  }
  for (const r of allMerged) {
    const ev = r.excessValPct;
    if (ev == null) continue;
    if (globalRobustBest == null || ev > (globalRobustBest.excessValPct ?? -Infinity)) globalRobustBest = r;
  }

  const split = buildSplitMeta(bars, barsTrain, barsVal, trainRatio, allMerged.length);

  return {
    meta,
    split,
    globalRobustBest,
    globalFullBest,
    maCross: maCrossRows.slice(0, topK),
    maCustom: maCustomRows.slice(0, topK),
    rsi: rsiRows.slice(0, topK),
    boll: bollRows.slice(0, topK),
  };
}
