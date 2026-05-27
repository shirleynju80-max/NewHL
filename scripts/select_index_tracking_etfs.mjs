import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, "public", "data");
const MAX_PRODUCTS_PER_INDEX = 4;
const SEARCH_ENDPOINT = "https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx";

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQ = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQ = true;
    } else if (c === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseCsvFile(name) {
  const text = readFileSync(join(DATA_DIR, name), "utf-8")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((header, i) => {
      row[header.trim()] = cols[i]?.trim() ?? "";
    });
    return row;
  });
}

function escapeCsv(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function stripHtml(html) {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tableValueByHeader(html, header) {
  const re = new RegExp(`<th[^>]*>\\s*${header}\\s*<\\/th>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, "i");
  const m = html.match(re);
  return m ? stripHtml(m[1]) : "";
}

function normalizeName(raw) {
  return String(raw ?? "")
    .replace(/\s+/g, "")
    .replace(/[（）()]/g, "")
    .replace(/人民币|港元|价格|收益|全收益|全价|净收益/g, "")
    .replace(/RateIndex|PriceReturn|TotalReturn/gi, "")
    .toLowerCase();
}

function normalizeDate(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(/(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})/);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function parsePct(raw) {
  const m = String(raw ?? "").replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : NaN;
}

function parseAumCny(raw) {
  const s = String(raw ?? "").replace(/,/g, "");
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*(万|亿)?元/);
  if (!m) return NaN;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return NaN;
  const unit = m[2] || "";
  if (unit === "亿") return Math.round(value * 100000000);
  if (unit === "万") return Math.round(value * 10000);
  return Math.round(value);
}

function isExchangeEtfCode(code) {
  return /^(15|50|51|52|53|56|58)\d{4}$/.test(String(code ?? ""));
}

function exchangeFor(code) {
  if (/^(50|51|52|53|56|58)/.test(code)) return "SH";
  if (/^15/.test(code)) return "SZ";
  return "";
}

function secidFor(code) {
  const exchange = exchangeFor(code);
  if (exchange === "SH") return `1.${code}`;
  if (exchange === "SZ") return `0.${code}`;
  return "";
}

function queryVariants(index) {
  const name = index.name;
  const base = name.replace(/指数$/, "");
  const shortBase = base
    .replace(/^中证/, "")
    .replace(/^上证/, "")
    .replace(/^国证/, "")
    .replace(/^恒生/, "")
    .replace(/^标普/, "")
    .replace(/低波动/g, "低波");
  const variants = new Set([name, `${base}ETF`, `${shortBase}ETF`]);

  if (name.includes("红利低波动")) variants.add("红利低波ETF");
  if (name.includes("中证红利指数")) variants.add("中证红利ETF");
  if (name.includes("上证红利")) variants.add("上证红利ETF");
  if (name.includes("红利质量")) variants.add("红利质量ETF");
  if (name.includes("中央企业红利") || name.includes("央企红利")) variants.add("央企红利ETF");
  if (index.category === "港股红利") {
    variants.add("港股红利ETF");
    variants.add("港股红利低波ETF");
    variants.add("港股央企红利ETF");
    variants.add("港股通红利ETF");
  }
  if (index.category === "现金流") {
    variants.add("现金流ETF");
    variants.add("自由现金流ETF");
  }

  return [...variants].filter(Boolean);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://fund.eastmoney.com/",
    },
  });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return await res.text();
}

async function searchFunds(query) {
  const url = `${SEARCH_ENDPOINT}?m=1&key=${encodeURIComponent(query)}`;
  const json = JSON.parse(await fetchText(url));
  return (json.Datas ?? []).map((item) => ({
    code: item.CODE,
    name: item.FundBaseInfo?.SHORTNAME || item.NAME || "",
    newtexch: item.NEWTEXCH || "",
  }));
}

async function fetchFundF10(code) {
  const sourceUrl = `https://fundf10.eastmoney.com/jbgk_${code}.html`;
  const html = await fetchText(sourceUrl);
  const managementFeePct = parsePct(tableValueByHeader(html, "管理费率"));
  const custodyFeePct = parsePct(tableValueByHeader(html, "托管费率"));
  return {
    code,
    sourceUrl,
    shortName: tableValueByHeader(html, "基金简称"),
    trackingTarget: tableValueByHeader(html, "跟踪标的"),
    listedDate: normalizeDate(tableValueByHeader(html, "成立日期/规模")),
    aumCny: parseAumCny(tableValueByHeader(html, "净资产规模")),
    totalFeePct:
      Number.isFinite(managementFeePct) && Number.isFinite(custodyFeePct)
        ? Number((managementFeePct + custodyFeePct).toFixed(2))
        : NaN,
  };
}

async function fetchAvgTurnoverCny(code) {
  const secid = secidFor(code);
  if (!secid) return NaN;
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}` +
    "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=101&fqt=1&lmt=20";
  try {
    const json = JSON.parse(await fetchText(url));
    const rows = json.data?.klines ?? [];
    const amounts = rows
      .map((line) => Number(String(line).split(",")[6]))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!amounts.length) return NaN;
    return Math.round(amounts.reduce((sum, value) => sum + value, 0) / amounts.length);
  } catch {
    return NaN;
  }
}

function targetMatchesIndex(trackingTarget, indexName) {
  const target = normalizeName(trackingTarget);
  const index = normalizeName(indexName);
  if (!target || !index) return false;
  return target === index || target.includes(index) || index.includes(target);
}

function addReason(map, code, reason) {
  if (!map.has(code)) map.set(code, new Set());
  map.get(code).add(reason);
}

function pickBy(candidates, compare) {
  return [...candidates].filter(compare.valid).sort(compare.sort)[0];
}

function hasLocalBars(localBarCodes, code) {
  return localBarCodes.has(code);
}

function selectProducts(candidates, localBarCodes) {
  const unique = new Map();
  for (const candidate of candidates) unique.set(candidate.code, candidate);
  const rows = [...unique.values()];
  if (!rows.length) return [];

  const primary = [...rows].sort((a, b) => {
    const localDiff = Number(hasLocalBars(localBarCodes, b.code)) - Number(hasLocalBars(localBarCodes, a.code));
    if (localDiff) return localDiff;
    return (Number.isFinite(b.aumCny) ? b.aumCny : -1) - (Number.isFinite(a.aumCny) ? a.aumCny : -1);
  })[0];

  const reasons = new Map();
  addReason(reasons, primary.code, "主产品");

  const largestAum = pickBy(rows, {
    valid: (row) => Number.isFinite(row.aumCny),
    sort: (a, b) => b.aumCny - a.aumCny,
  });
  if (largestAum) addReason(reasons, largestAum.code, "规模最大");

  const lowestFee = pickBy(rows, {
    valid: (row) => Number.isFinite(row.totalFeePct),
    sort: (a, b) => a.totalFeePct - b.totalFeePct || (b.aumCny || 0) - (a.aumCny || 0),
  });
  if (lowestFee) addReason(reasons, lowestFee.code, "费率最低");

  const earliestListed = pickBy(rows, {
    valid: (row) => row.listedDate,
    sort: (a, b) => a.listedDate.localeCompare(b.listedDate),
  });
  if (earliestListed) addReason(reasons, earliestListed.code, "成立最早");

  const highestLiquidity = pickBy(rows, {
    valid: (row) => Number.isFinite(row.avgDailyTurnoverCny),
    sort: (a, b) => b.avgDailyTurnoverCny - a.avgDailyTurnoverCny,
  });
  if (highestLiquidity) addReason(reasons, highestLiquidity.code, "流动性最好");

  const fillers = [...rows].sort((a, b) => {
    const localDiff = Number(hasLocalBars(localBarCodes, b.code)) - Number(hasLocalBars(localBarCodes, a.code));
    if (localDiff) return localDiff;
    const aumDiff = (Number.isFinite(b.aumCny) ? b.aumCny : -1) - (Number.isFinite(a.aumCny) ? a.aumCny : -1);
    if (aumDiff) return aumDiff;
    return (Number.isFinite(a.totalFeePct) ? a.totalFeePct : 999) - (Number.isFinite(b.totalFeePct) ? b.totalFeePct : 999);
  });
  for (const row of fillers) {
    if (reasons.size >= Math.min(MAX_PRODUCTS_PER_INDEX, rows.length)) break;
    addReason(reasons, row.code, "规模补位");
  }

  return [...reasons.keys()]
    .map((code) => rows.find((row) => row.code === code))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.code === primary.code) return -1;
      if (b.code === primary.code) return 1;
      return [...reasons.get(a.code)].join("").localeCompare([...reasons.get(b.code)].join(""));
    })
    .slice(0, MAX_PRODUCTS_PER_INDEX)
    .map((row, i) => ({
      ...row,
      isPrimary: i === 0,
      reasons: [...reasons.get(row.code)],
    }));
}

const indices = parseCsvFile("indices.csv").filter((row) => ["A股红利", "港股红利", "现金流"].includes(row.category));
const existingTrackingRows = parseCsvFile("index_tracking_etfs.csv");
const bars = [...parseCsvFile("bars.csv"), ...parseCsvFile("barsmore.csv")];
const localBarCodes = new Set(bars.map((row) => row.etf_code).filter(Boolean));
const existingCodesByIndex = new Map();
for (const row of existingTrackingRows) {
  if (row.product_type === "otc_fund") continue;
  if (!isExchangeEtfCode(row.etf_code)) continue;
  if (!existingCodesByIndex.has(row.index_code)) existingCodesByIndex.set(row.index_code, new Set());
  existingCodesByIndex.get(row.index_code).add(row.etf_code);
}

const f10Cache = new Map();
const turnoverCache = new Map();
const outputRows = [];

for (const index of indices) {
  const candidateCodes = new Set(existingCodesByIndex.get(index.index_code) ?? []);
  for (const query of queryVariants(index)) {
    try {
      const searchRows = await searchFunds(query);
      for (const row of searchRows) {
        if (!isExchangeEtfCode(row.code)) continue;
        if (row.name.includes("联接")) continue;
        candidateCodes.add(row.code);
      }
    } catch (err) {
      console.warn(`${index.index_code} search failed: ${query}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const candidates = [];
  for (const code of candidateCodes) {
    try {
      if (!f10Cache.has(code)) f10Cache.set(code, await fetchFundF10(code));
      const f10 = f10Cache.get(code);
      if (!targetMatchesIndex(f10.trackingTarget, index.name)) continue;
      if (!turnoverCache.has(code)) turnoverCache.set(code, await fetchAvgTurnoverCny(code));
      candidates.push({
        ...f10,
        name: f10.shortName || code,
        avgDailyTurnoverCny: turnoverCache.get(code),
      });
    } catch (err) {
      console.warn(`${index.index_code} F10 failed: ${code}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const selected = selectProducts(candidates, localBarCodes);
  for (const product of selected) {
    const nonPrimary = product.isPrimary ? "" : "产品落地参考，不作为盘中默认监控";
    const reasonNote = `候选维度：${product.reasons.join("/")}`;
    outputRows.push({
      index_code: index.index_code,
      etf_code: product.code,
      note: [nonPrimary, reasonNote].filter(Boolean).join("；"),
      fee_pct: Number.isFinite(product.totalFeePct) ? product.totalFeePct.toFixed(2) : "",
      product_type: "",
    });
  }

  console.log(
    `${index.index_code} ${index.name}: ${selected.length}/${candidates.length} selected -> ${selected
      .map((row) => `${row.code}${row.isPrimary ? "*" : ""}[${row.reasons.join("/")}]`)
      .join(", ")}`
  );
}

const headers = ["index_code", "etf_code", "note", "fee_pct", "product_type"];
const output =
  [headers.join(","), ...outputRows.map((row) => headers.map((field) => escapeCsv(row[field])).join(","))].join("\n") +
  "\n";
writeFileSync(join(DATA_DIR, "index_tracking_etfs.csv"), output, "utf-8");
console.log(`wrote ${outputRows.length} rows to public/data/index_tracking_etfs.csv`);
