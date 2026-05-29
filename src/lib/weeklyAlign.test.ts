import { describe, expect, it } from "vitest";
import { mondayKey, weeklyLastCloses } from "./weeklyAlign";
import type { OhlcBar } from "../types";

const bar = (date: string, close: number): OhlcBar => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
});

describe("mondayKey", () => {
  it("maps a mid-week day to that week's Monday", () => {
    // 2024-01-03 is a Wednesday
    expect(mondayKey("2024-01-03")).toBe("2024-01-01");
  });

  it("maps Sunday back to the Monday that started the week", () => {
    // 2024-01-07 is a Sunday
    expect(mondayKey("2024-01-07")).toBe("2024-01-01");
  });

  it("returns the same date when it is already a Monday", () => {
    expect(mondayKey("2024-01-08")).toBe("2024-01-08");
  });
});

describe("weeklyLastCloses", () => {
  it("keeps the last bar of each natural week, ordered by week", () => {
    const bars = [
      bar("2024-01-02", 10), // week of 2024-01-01
      bar("2024-01-05", 11), // same week, later → wins
      bar("2024-01-08", 12), // week of 2024-01-08
    ];
    const weekly = weeklyLastCloses(bars);
    expect(weekly).toEqual([
      { weekMonday: "2024-01-01", lastDate: "2024-01-05", close: 11 },
      { weekMonday: "2024-01-08", lastDate: "2024-01-08", close: 12 },
    ]);
  });

  it("returns an empty array for no bars", () => {
    expect(weeklyLastCloses([])).toEqual([]);
  });
});
