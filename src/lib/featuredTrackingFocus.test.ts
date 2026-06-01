import { describe, expect, it } from "vitest";
import {
  FEATURED_FOCUS_ITEMS,
  compareFeaturedFocusIndexCodes,
} from "./featuredTrackingFocus";

describe("compareFeaturedFocusIndexCodes", () => {
  it("orders A-share dividend before HK dividend before cash", () => {
    expect(
      compareFeaturedFocusIndexCodes("H30269", "HSSCSOY.HI"),
    ).toBeLessThan(0);
    expect(compareFeaturedFocusIndexCodes("HSI114", "980092")).toBeLessThan(0);
    expect(compareFeaturedFocusIndexCodes("980092", "930955")).toBeGreaterThan(
      0,
    );
  });

  it("keeps FEATURED_FOCUS_ITEMS order within A-share group", () => {
    const aShare = FEATURED_FOCUS_ITEMS.filter(
      (i) => i.marketGroup === "a_dividend",
    ).map((i) => i.indexCode);
    const sorted = [...aShare].sort(compareFeaturedFocusIndexCodes);
    expect(sorted).toEqual(aShare);
  });
});
