import type { BondSeriesPoint } from "../types";

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildBondSeries(dates: string[]): BondSeriesPoint[] {
  const r1 = mulberry32(101);
  const r2 = mulberry32(202);
  let cn = 2.55;
  let us = 4.1;
  return dates.map((date) => {
    cn += (r1() - 0.5) * 0.04;
    us += (r2() - 0.5) * 0.05;
    cn = Math.min(3.2, Math.max(2.1, cn));
    us = Math.min(5.0, Math.max(3.2, us));
    return { date, cn10y_pct: Math.round(cn * 100) / 100, us10y_pct: Math.round(us * 100) / 100 };
  });
}

export function bondMap(series: BondSeriesPoint[]): Record<string, BondSeriesPoint> {
  return Object.fromEntries(series.map((b) => [b.date, b]));
}
