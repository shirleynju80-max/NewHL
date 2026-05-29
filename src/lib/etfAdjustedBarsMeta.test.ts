import { describe, expect, it } from "vitest";
import {
  latestExDividendDateForCode,
  parseEtfAdjustedBarsMeta,
} from "./etfAdjustedBarsMeta";

describe("etfAdjustedBarsMeta", () => {
  it("reads latest ex date from etfs map", () => {
    const meta = parseEtfAdjustedBarsMeta(
      JSON.stringify({
        etfs: {
          "513630": { latest_ex_dividend_date: "2026-05-21" },
        },
      }),
    );
    expect(latestExDividendDateForCode(meta, "513630")).toBe("2026-05-21");
  });

  it("falls back to legacy funds array", () => {
    const meta = parseEtfAdjustedBarsMeta(
      JSON.stringify({
        funds: [{ code: "513630", latest_ex_dividend_date: "2026-05-21" }],
      }),
    );
    expect(latestExDividendDateForCode(meta, "513630")).toBe("2026-05-21");
  });
});
