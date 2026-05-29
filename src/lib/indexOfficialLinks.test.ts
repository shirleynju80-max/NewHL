import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  indexOfficialIntroUrl,
  indicesMissingOfficialIntro,
} from "./indexOfficialLinks";

function loadIndexCodesFromCsv(): string[] {
  const csv = readFileSync(
    resolve(process.cwd(), "public/data/indices.csv"),
    "utf8",
  );
  return csv
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(",")[0]?.trim())
    .filter((code): code is string => Boolean(code));
}

describe("indexOfficialIntroUrl", () => {
  it("中证指数链到 csindex 介绍页", () => {
    expect(
      indexOfficialIntroUrl({ index_code: "931157", methodology_url: undefined }),
    ).toBe(
      "https://www.csindex.com.cn/#/indices/family/detail?indexCode=931157",
    );
  });

  it("国证 CIS51002 使用官网行情代码 987016", () => {
    expect(
      indexOfficialIntroUrl({ index_code: "CIS51002", methodology_url: undefined }),
    ).toBe(
      "https://www.cnindex.com.cn/module/index-detail.html?act_menu=1&indexCode=987016",
    );
  });

  it("恒生指数链到 HSI 介绍页", () => {
    expect(
      indexOfficialIntroUrl({
        index_code: "HSSCSOY.HI",
        methodology_url:
          "https://www.hsi.com.hk/static/uploads/contents/zh_cn/dl_centre/methodologies/IM_hsscsoyc.pdf",
      }),
    ).toBe("https://www.hsi.com.hk/chi/indexes/all-indexes/hsscsoy");
  });

  it("indices.csv 内全部指数均有官网介绍链接", () => {
    const codes = loadIndexCodesFromCsv();
    const missing = indicesMissingOfficialIntro(
      codes.map((code) => ({ meta: { index_code: code, name: code } })),
    );
    expect(missing).toEqual([]);
  });
});
