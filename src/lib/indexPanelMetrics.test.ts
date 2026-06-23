import { describe, expect, it } from "vitest";
import {
  calcMetricBlockForWindow,
  displayReturnPctForWindow,
  isMetricWindowSatisfied,
  type DateValuePoint,
} from "./indexPanelMetrics";

function seriesFrom(
  start: string,
  end: string,
  stepDays = 7,
): DateValuePoint[] {
  const out: DateValuePoint[] = [];
  let v = 100;
  const startMs = Date.parse(`${start}T00:00:00`);
  const endMs = Date.parse(`${end}T00:00:00`);
  for (let t = startMs; t <= endMs; t += stepDays * 24 * 60 * 60 * 1000) {
    out.push({
      date: new Date(t).toISOString().slice(0, 10),
      value: v,
    });
    v *= 1.001;
  }
  return out;
}

describe("isMetricWindowSatisfied", () => {
  const young = seriesFrom("2023-06-12", "2026-05-20");

  it("近5年样本不足时返回 false", () => {
    expect(isMetricWindowSatisfied(young, "y5")).toBe(false);
    expect(isMetricWindowSatisfied(young, "y3")).toBe(false);
    expect(isMetricWindowSatisfied(young, "y10")).toBe(false);
  });

  it("近1年样本足够时返回 true", () => {
    expect(isMetricWindowSatisfied(young, "y1")).toBe(true);
    expect(isMetricWindowSatisfied(young, "m3")).toBe(true);
  });

  it("全周期始终可用", () => {
    expect(isMetricWindowSatisfied(young, "all")).toBe(true);
  });

  it("calcMetricBlockForWindow 样本不足时返回空块", () => {
    const block = calcMetricBlockForWindow(young, "y5");
    expect(block.annualReturnPct).toBeNull();
    expect(block.totalReturnPct).toBeNull();
    expect(block.points).toBe(0);
  });

  it("长历史指数满足近5年", () => {
    const long = seriesFrom("2015-01-01", "2026-05-20");
    expect(isMetricWindowSatisfied(long, "y5")).toBe(true);
    const block = calcMetricBlockForWindow(long, "y5");
    expect(block.annualReturnPct).not.toBeNull();
  });

  it("displayReturnPctForWindow：ytd 用区间收益，y5 用年化", () => {
    const block = calcMetricBlockForWindow(
      seriesFrom("2026-01-01", "2026-06-20"),
      "ytd",
    );
    expect(displayReturnPctForWindow(block, "ytd")).toBe(block.totalReturnPct);
    const y5 = calcMetricBlockForWindow(
      seriesFrom("2015-01-01", "2026-05-20"),
      "y5",
    );
    expect(displayReturnPctForWindow(y5, "y5")).toBe(y5.annualReturnPct);
  });
});

describe("buildSeriesOverviewRowFromNav", () => {
  it("成立不足时 y5 为 null", async () => {
    const { buildSeriesOverviewRowFromNav } = await import("./compareEtfs");
    const young = seriesFrom("2023-06-12", "2026-05-20");
    const dates = young.map((p) => p.date);
    const closes = young.map((p) => p.value);
    const row = buildSeriesOverviewRowFromNav(
      closes,
      dates,
      "HSSCSOY.HI",
      "测试",
    );
    expect(row?.y5).toBeNull();
    expect(row?.y1).not.toBeNull();
  });
});
