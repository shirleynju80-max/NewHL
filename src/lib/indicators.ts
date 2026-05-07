import type { OhlcBar } from "../types";

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i + 1 < period ? null : sum / period);
  }
  return out;
}

export function rsi(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  if (closes.length < period + 1) return closes.map(() => null);
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gains += ch;
    else losses -= ch;
  }
  const pushRsi = (avgGain: number, avgLoss: number) => {
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  };
  for (let i = 0; i < period; i++) out.push(null);
  let avgG = gains / period;
  let avgL = losses / period;
  out.push(pushRsi(avgG, avgL));
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out.push(pushRsi(avgG, avgL));
  }
  return out;
}

export function bollinger(
  closes: number[],
  period: number,
  stdMult: number
): { mid: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] } {
  const mid = sma(closes, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (mid[i] == null) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += (closes[j] - (mid[i] as number)) ** 2;
    }
    const sd = Math.sqrt(sumSq / period);
    upper.push((mid[i] as number) + stdMult * sd);
    lower.push((mid[i] as number) - stdMult * sd);
  }
  return { mid, upper, lower };
}

export function closesFromBars(bars: OhlcBar[]): number[] {
  return bars.map((b) => b.close);
}
