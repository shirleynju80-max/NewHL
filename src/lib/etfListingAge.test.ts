import { describe, expect, it } from "vitest";
import {
  etfListingStartDate,
  etfListingYears,
  etfProductStrategyEligible,
  isCashCreationEtf,
  isEtfProductListed,
} from "./etfListingAge";
import type { EtfDefinition, EtfParams, OhlcBar } from "../types";

const params: EtfParams = {
  ma_variants: [{ variant_id: "ma", fast: 2, slow: 3 }],
  rsi_variants: [
    { variant_id: "rsi", period: 3, overbought: 70, oversold: 30 },
  ],
  bollinger_variants: [{ variant_id: "boll", period: 2, stdDev: 2 }],
  strategy_ma_ids: ["ma", "ma"],
};

const bar = (date: string): OhlcBar => ({
  date,
  open: 1,
  high: 1,
  low: 1,
  close: 1,
});

function makeEtf(
  dates: string[],
  productKind: EtfDefinition["meta"]["product_kind"] = "红利_含股息分红",
): EtfDefinition {
  return {
    meta: {
      code: "510000",
      name: "Test ETF",
      strategy_id: "ma",
      param_version: "v1",
      product_kind: productKind,
      div_yield_nominal_pct: 0,
      div_yield_source: "指数发布",
    },
    params,
    bars: dates.map(bar),
  };
}

describe("isEtfProductListed", () => {
  it("is listed when local bars exist", () => {
    expect(isEtfProductListed(makeEtf(["2024-01-01"]))).toBe(true);
  });

  it("is listed when a first trade date is recorded but no bars", () => {
    expect(
      isEtfProductListed(undefined, { firstTradeDate: "2024-01-01" }),
    ).toBe(true);
  });

  it("is not listed without bars or a valid date", () => {
    expect(isEtfProductListed(undefined, { firstTradeDate: "n/a" })).toBe(
      false,
    );
    expect(isEtfProductListed(undefined)).toBe(false);
  });
});

describe("etfListingStartDate", () => {
  it("prefers the product first-trade date over bars", () => {
    const etf = makeEtf(["2022-05-05"]);
    expect(etfListingStartDate(etf, { firstTradeDate: "2020-01-01" })).toBe(
      "2020-01-01",
    );
  });

  it("falls back to the earliest bar date", () => {
    const etf = makeEtf(["2022-03-03", "2021-01-01", "2023-01-01"]);
    expect(etfListingStartDate(etf)).toBe("2021-01-01");
  });
});

describe("etfListingYears", () => {
  it("measures elapsed years between start and as-of date", () => {
    const etf = makeEtf(["2020-01-01", "2022-01-01"]);
    expect(etfListingYears(etf, undefined, "2022-01-01")).toBeCloseTo(2, 1);
  });
});

describe("isCashCreationEtf", () => {
  it("treats 现金流类 product kind as cash creation", () => {
    expect(isCashCreationEtf(makeEtf(["2024-01-01"], "现金流类"))).toBe(true);
    expect(isCashCreationEtf(makeEtf(["2024-01-01"]))).toBe(false);
  });
});

describe("etfProductStrategyEligible", () => {
  it("is eligible for a dividend ETF older than the minimum", () => {
    expect(
      etfProductStrategyEligible(makeEtf(["2020-01-01", "2024-01-01"])),
    ).toBe(true);
  });

  it("is ineligible when younger than the minimum", () => {
    expect(
      etfProductStrategyEligible(makeEtf(["2023-06-01", "2024-01-01"])),
    ).toBe(false);
  });

  it("is always ineligible for cash-creation products", () => {
    expect(
      etfProductStrategyEligible(
        makeEtf(["2010-01-01", "2024-01-01"], "现金流类"),
      ),
    ).toBe(false);
  });
});
