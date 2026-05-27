import type { OhlcBar } from "../types";

/** 以该日所在「自然周」的周一（本地时区）为桶键。 */
export function mondayKey(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00");
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

export type WeeklyPoint = {
  weekMonday: string;
  lastDate: string;
  close: number;
};

/** 按周聚合：每周取区间内最后一根 bar 的收盘价（按日期字符串排序）。 */
export function weeklyLastCloses(bars: OhlcBar[]): WeeklyPoint[] {
  const m = new Map<string, { lastDate: string; close: number }>();
  for (const b of bars) {
    const k = mondayKey(b.date);
    const cur = m.get(k);
    if (!cur || b.date >= cur.lastDate)
      m.set(k, { lastDate: b.date, close: b.close });
  }
  return Array.from(m.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekMonday, v]) => ({
      weekMonday,
      lastDate: v.lastDate,
      close: v.close,
    }));
}

/** 将「每周一个标量」对齐到与 bars 等长的序列（同周内各日相同值）。 */
export function expandWeeklyScalarToDaily(
  bars: OhlcBar[],
  weekly: WeeklyPoint[],
  selector: (p: WeeklyPoint) => number,
): (number | null)[] {
  const byWeek = new Map(weekly.map((p) => [p.weekMonday, selector(p)]));
  return bars.map((b) => {
    const k = mondayKey(b.date);
    const v = byWeek.get(k);
    return v === undefined ? null : v;
  });
}
