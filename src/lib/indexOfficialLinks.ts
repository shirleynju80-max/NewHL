import type { IndexMeta } from "../types";

/** 国证官网行情代码与本地展示代码不一致时的映射 */
const CNINDEX_MARKET_CODE: Record<string, string> = {
  CIS51002: "987016",
};

/** 编制机构介绍页（非 PDF 编制方案） */
const EXPLICIT_INTRO_URL: Record<string, string> = {
  FCFQCD:
    "https://www.lseg.com/en/ftse-russell/indices/ftse-china-a-free-cash-flow-focus-index",
  "SPCLLHCP.SPI":
    "https://www.spglobal.com/spdji/en/indices/dividends-factors/sp-china-a-share-largecap-low-volatility-high-dividend-50-index/",
  "SPAHLVCP.SPI":
    "https://www.spglobal.com/spdji/zh/indices/dividends-factors/sp-access-hong-kong-low-volatility-high-dividend-index/",
};

function csiIndexIntroUrl(code: string): string {
  return `https://www.csindex.com.cn/#/indices/family/detail?indexCode=${encodeURIComponent(code)}`;
}

function cnindexIntroUrl(marketCode: string): string {
  return `https://www.cnindex.com.cn/module/index-detail.html?act_menu=1&indexCode=${encodeURIComponent(marketCode)}`;
}

function hsiIndexIntroUrl(code: string): string | null {
  if (code === "HSI114") {
    return "https://www.hsi.com.hk/index360/chi/indexes/detail/HSI114";
  }
  if (code === "HSSCSOY.HI") {
    return "https://www.hsi.com.hk/chi/indexes/all-indexes/hsscsoy";
  }
  return null;
}

function isCsiIndexCode(code: string): boolean {
  return /^\d{6}$/.test(code) || /^H\d+$/i.test(code);
}

function isCnindexLocalCode(code: string): boolean {
  return /^980\d{3}$/.test(code) || code in CNINDEX_MARKET_CODE;
}

function methodologyWebIntroUrl(url: string | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed || trimmed.toLowerCase().endsWith(".pdf")) return null;
  return trimmed;
}

/** 指数编制机构官网「指数介绍」页；编制方案 PDF 见 methodology_url。 */
export function indexOfficialIntroUrl(
  meta: Pick<IndexMeta, "index_code" | "methodology_url">,
): string | null {
  const code = meta.index_code.trim();
  if (!code) return null;

  const explicit = EXPLICIT_INTRO_URL[code];
  if (explicit) return explicit;

  const hsi = hsiIndexIntroUrl(code);
  if (hsi) return hsi;

  if (isCnindexLocalCode(code)) {
    const marketCode = CNINDEX_MARKET_CODE[code] ?? code;
    return cnindexIntroUrl(marketCode);
  }

  if (isCsiIndexCode(code)) {
    return csiIndexIntroUrl(code);
  }

  return methodologyWebIntroUrl(meta.methodology_url);
}

export function indicesMissingOfficialIntro(
  indices: Pick<IndexDefinitionLike, "meta">[],
): string[] {
  return indices
    .filter((ix) => !indexOfficialIntroUrl(ix.meta))
    .map((ix) => `${ix.meta.name}（${ix.meta.index_code}）`);
}

type IndexDefinitionLike = {
  meta: Pick<IndexMeta, "index_code" | "name" | "methodology_url">;
};
