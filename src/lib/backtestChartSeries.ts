import type { EtfParams, OhlcBar, TradePoint } from "../types";
import { bollinger, closesFromBars, rsi, sma } from "./indicators";
import {
  getBollingerVariant,
  getMaPair,
  getRsiVariant,
  usesBollStrategy,
  usesMaCustomStrategy,
  usesRsiStrategy,
} from "./strategy";

export type PriceIndicatorRow = {
  date: string;
  price: number;
  maFast?: number | null;
  maSlow?: number | null;
  rsi?: number | null;
  rsiOverbought?: number;
  rsiOversold?: number;
  bbUpper?: number | null;
  bbLower?: number | null;
  bbMid?: number | null;
};

/** 与主图同一 data 数组，买卖点与 K 线严格对齐 */
export type ChartRow = PriceIndicatorRow & {
  buyMark?: number;
  sellMark?: number;
};

export function mergeTradeMarkers(rows: PriceIndicatorRow[], trades: TradePoint[]): ChartRow[] {
  const buyDates = new Set(trades.filter((t) => t.side === "BUY").map((t) => t.date));
  const sellDates = new Set(trades.filter((t) => t.side === "SELL").map((t) => t.date));
  return rows.map((r) => ({
    ...r,
    buyMark: buyDates.has(r.date) ? r.price : undefined,
    sellMark: sellDates.has(r.date) ? r.price : undefined,
  }));
}

/** 与主图日期对齐：窗口内每日价格 + MA 或 RSI 数值（用于子图/叠加） */
export function buildPriceIndicatorRows(
  bars: OhlcBar[],
  params: EtfParams,
  strategyId: string,
  i0: number,
  i1: number
): PriceIndicatorRow[] {
  const n = bars.length;
  if (!n || i0 > i1) return [];
  const a = Math.max(0, Math.min(i0, n - 1));
  const b = Math.max(a, Math.min(i1, n - 1));
  const closes = closesFromBars(bars);
  const rsiMode = usesRsiStrategy(strategyId);
  const maCustomMode = usesMaCustomStrategy(strategyId);
  const bollMode = usesBollStrategy(strategyId);
  let fast: (number | null)[] | null = null;
  let slow: (number | null)[] | null = null;
  let rsiSeries: (number | null)[] | null = null;
  let ob: number | undefined;
  let os: number | undefined;
  let bbUpper: (number | null)[] | null = null;
  let bbLower: (number | null)[] | null = null;
  let bbMid: (number | null)[] | null = null;

  if (maCustomMode && params.ma_custom_rule) {
    const p = params.ma_custom_rule.buyMaPeriod;
    fast = sma(closes, p);
    slow = fast;
  } else if (rsiMode) {
    const rv = getRsiVariant(params);
    if (rv) {
      rsiSeries = rsi(closes, rv.period);
      ob = rv.overbought;
      os = rv.oversold;
    }
  } else if (bollMode) {
    const bv = getBollingerVariant(params);
    if (bv) {
      const bands = bollinger(closes, bv.period, bv.stdDev);
      bbUpper = bands.upper;
      bbLower = bands.lower;
      bbMid = bands.mid;
    }
  } else {
    const pair = getMaPair(params);
    if (pair) {
      fast = sma(closes, pair.fastP);
      slow = sma(closes, pair.slowP);
    }
  }

  const rows: PriceIndicatorRow[] = [];
  for (let i = a; i <= b; i++) {
    const row: PriceIndicatorRow = {
      date: bars[i].date,
      price: Number(bars[i].close.toFixed(6)),
    };
    if (maCustomMode && fast && slow) {
      row.maFast = fast[i] != null ? Math.round((fast[i] as number) * 10000) / 10000 : null;
      row.maSlow = slow[i] != null ? Math.round((slow[i] as number) * 10000) / 10000 : null;
    } else if (rsiMode && rsiSeries) {
      const v = rsiSeries[i];
      row.rsi = v != null ? Math.round(v * 100) / 100 : null;
      row.rsiOverbought = ob;
      row.rsiOversold = os;
    } else if (bollMode && bbUpper && bbLower && bbMid) {
      row.bbUpper = bbUpper[i] != null ? Math.round((bbUpper[i] as number) * 10000) / 10000 : null;
      row.bbLower = bbLower[i] != null ? Math.round((bbLower[i] as number) * 10000) / 10000 : null;
      row.bbMid = bbMid[i] != null ? Math.round((bbMid[i] as number) * 10000) / 10000 : null;
    } else if (fast && slow) {
      row.maFast = fast[i] != null ? Math.round((fast[i] as number) * 10000) / 10000 : null;
      row.maSlow = slow[i] != null ? Math.round((slow[i] as number) * 10000) / 10000 : null;
    }
    rows.push(row);
  }
  return rows;
}
