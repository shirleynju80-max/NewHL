import { describe, expect, it } from "vitest";
import { parseFundBarsCsv } from "./csvLoader";

describe("parseFundBarsCsv", () => {
  it("uses nav_accum when forward-adjusted fields are absent", () => {
    const csv = [
      "fund_code,index_code,date,nav_unit,nav_accum",
      "007751,931157,2026-06-01,1.2347,1.6300",
    ].join("\n");

    const map = parseFundBarsCsv(csv);
    const bars = map.get("007751");
    expect(bars).toBeDefined();
    expect(bars?.[0]?.close).toBeCloseTo(1.63, 6);
  });

  it("prefers nav_forward_adjusted over nav_accum", () => {
    const csv = [
      "fund_code,index_code,date,nav_unit,nav_accum,nav_forward_adjusted",
      "007751,931157,2026-06-01,1.2347,1.6300,1.5800",
    ].join("\n");

    const map = parseFundBarsCsv(csv);
    const bars = map.get("007751");
    expect(bars).toBeDefined();
    expect(bars?.[0]?.close).toBeCloseTo(1.58, 6);
  });
});
