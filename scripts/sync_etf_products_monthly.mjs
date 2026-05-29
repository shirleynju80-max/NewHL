import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, "public", "data");
const TODAY = new Date().toISOString().slice(0, 10);

const FIELDS = [
  "code",
  "name",
  "product_group",
  "index_code",
  "index_name",
  "exchange",
  "issuer",
  "listed_date",
  "first_trade_date",
  "aum_cny",
  "management_fee_pct",
  "custody_fee_pct",
  "total_fee_pct",
  "avg_daily_turnover_cny",
  "latest_premium_discount_pct",
  "tracking_error_pct",
  "is_primary",
  "source_url",
  "updated_at",
  "data_status",
  "note",
];

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

function parseCsvFile(name, { required = true } = {}) {
  const path = join(DATA_DIR, name);
  if (!existsSync(path)) {
    if (required) {
      throw new Error(`Missing required data file: ${path}`);
    }
    return [];
  }
  const text = readFileSync(path, "utf-8")
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
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(/(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})/);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function parsePct(raw) {
  const m = String(raw ?? "").replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*%/);
  return m ? m[1] : "";
}

function parseAumCny(raw) {
  const s = String(raw ?? "").replace(/,/g, "");
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*(万|亿)?元/);
  if (!m) return "";
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return "";
  const unit = m[2] || "";
  if (unit === "亿") return String(Math.round(value * 100000000));
  if (unit === "万") return String(Math.round(value * 10000));
  return String(Math.round(value));
}

function tableValueByHeader(html, header) {
  const re = new RegExp(`<th[^>]*>\\s*${header}\\s*<\\/th>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, "i");
  const m = html.match(re);
  return m ? stripHtml(m[1]) : "";
}

function indexGroup(index) {
  if (!index) return "otc_fund";
  if (index.category === "现金流") return "cash_creation";
  if (index.category === "A股红利") return "shareholder_return_cn";
  if (index.category === "港股红利") return "shareholder_return_hk";
  return "otc_fund";
}

function exchangeFor(code, productType) {
  if (productType === "otc_fund") return "OTC";
  if (/^(50|51|52|56|58|53)/.test(code)) return "SH";
  if (/^(15|16|18)/.test(code)) return "SZ";
  return "";
}

function issuerFromName(name) {
  const issuers = [
    "华泰柏瑞",
    "景顺长城",
    "南方",
    "招商",
    "华夏",
    "富国",
    "摩根",
    "华安",
    "国泰",
    "华宝",
    "万家",
    "鹏华",
    "汇添富",
    "广发",
  ];
  return issuers.find((issuer) => name.includes(issuer)) ?? "";
}

function earliestDate(rows, codeField, code) {
  const dates = rows
    .filter((row) => row[codeField] === code && row.date)
    .map((row) => row.date)
    .sort();
  return dates[0] ?? "";
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

async function fetchFundF10(code, productType) {
  if (productType === "otc_fund") {
    return { sourceUrl: `https://fundf10.eastmoney.com/jbgk_${code}.html`, data: null, note: "场外基金：暂不自动补 F10 产品字段" };
  }
  const sourceUrl = `https://fundf10.eastmoney.com/jbgk_${code}.html`;
  const html = await fetchText(sourceUrl);
  const fullName = tableValueByHeader(html, "基金全称");
  const shortName = tableValueByHeader(html, "基金简称");
  const manager = tableValueByHeader(html, "基金管理人").replace(/基金$/, "");
  const setup = tableValueByHeader(html, "成立日期/规模");
  const netAsset = tableValueByHeader(html, "净资产规模");
  const managementFee = tableValueByHeader(html, "管理费率");
  const custodyFee = tableValueByHeader(html, "托管费率");
  const trackingTarget = tableValueByHeader(html, "跟踪标的");
  const setupDate = normalizeDate(setup);
  const managementFeePct = parsePct(managementFee);
  const custodyFeePct = parsePct(custodyFee);
  const totalFeePct =
    managementFeePct && custodyFeePct
      ? (Number(managementFeePct) + Number(custodyFeePct)).toFixed(2)
      : "";
  return {
    sourceUrl,
    data: {
      fullName,
      shortName,
      issuer: manager,
      listedDate: setupDate,
      aumCny: parseAumCny(netAsset),
      managementFeePct,
      custodyFeePct,
      totalFeePct,
      trackingTarget,
    },
    note: "",
  };
}

const etfMetas = [
  ...parseCsvFile("etfs.csv", { required: false }),
  ...parseCsvFile("etfsmore.csv"),
];
const metaByCode = new Map();
for (const meta of etfMetas) {
  if (meta.code && !metaByCode.has(meta.code)) metaByCode.set(meta.code, meta);
}

const existingProducts = new Map(
  parseCsvFile("etf_products.csv", { required: false }).map((row) => [row.code, row]),
);
const indicesByCode = new Map(parseCsvFile("indices.csv").map((row) => [row.index_code, row]));
const trackingRows = parseCsvFile("index_tracking_etfs.csv");
const bars = [
  ...parseCsvFile("bars.csv"),
  ...parseCsvFile("barsmore.csv", { required: false }),
];
const fundBars = parseCsvFile("fund_bars.csv", { required: false });
const seenIndex = new Set();
const rows = [];

for (const tracking of trackingRows) {
  const code = tracking.etf_code;
  const productType = (tracking.product_type || "etf").trim() || "etf";
  const isOtc = productType === "otc_fund";
  const index = indicesByCode.get(tracking.index_code);
  const meta = metaByCode.get(code);
  const existing = existingProducts.get(code) ?? {};
  const trackingName = tracking.note ? tracking.note.split("；")[0].trim() : "";
  const trackingNoteRemainder = tracking.note ? tracking.note.split("；").slice(1).join("；").trim() : "";
  let f10 = { sourceUrl: "", data: null, note: "" };
  try {
    f10 = await fetchFundF10(code, productType);
  } catch (err) {
    f10 = {
      sourceUrl: `https://fundf10.eastmoney.com/jbgk_${code}.html`,
      data: null,
      note: `F10 获取失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const nameSource =
    meta?.name ? "meta"
    : f10.data?.shortName ? "f10"
    : trackingName ? "tracking_note"
    : existing.name ? "existing"
    : "code";
  const name = meta?.name || f10.data?.shortName || trackingName || existing.name || code;
  const firstTradeDate = isOtc ? earliestDate(fundBars, "fund_code", code) : earliestDate(bars, "etf_code", code);
  const isPrimary = !seenIndex.has(tracking.index_code);
  seenIndex.add(tracking.index_code);
  const status = firstTradeDate ? "ok" : "missing";
  const noteParts = [];
  if (trackingNoteRemainder) noteParts.push(trackingNoteRemainder);
  if (nameSource === "tracking_note") noteParts.push("名称来自 index_tracking_etfs.csv note");
  if (!isPrimary && !noteParts.includes("产品落地参考，不作为盘中默认监控")) {
    noteParts.push("产品落地参考，不作为盘中默认监控");
  }
  if (!index) noteParts.push("待核实：index_code 未在 indices.csv 找到");
  if (!f10.data?.totalFeePct && tracking.fee_pct) noteParts.push("total_fee_pct 来自 index_tracking_etfs.csv fee_pct");
  if (f10.note) noteParts.push(f10.note);
  if (f10.data?.trackingTarget && f10.data.trackingTarget !== index?.name) {
    noteParts.push(`F10 跟踪标的：${f10.data.trackingTarget}`);
  }

  rows.push({
    code,
    name,
    product_group: isOtc ? "otc_fund" : indexGroup(index),
    index_code: tracking.index_code,
    index_name: index?.name ?? "",
    exchange: exchangeFor(code, isOtc ? "otc_fund" : "etf"),
    issuer: f10.data?.issuer || issuerFromName(name),
    listed_date: tracking.listed_date || f10.data?.listedDate || existing.listed_date || "",
    first_trade_date: firstTradeDate,
    aum_cny: f10.data?.aumCny || existing.aum_cny || "",
    management_fee_pct: f10.data?.managementFeePct || existing.management_fee_pct || "",
    custody_fee_pct: f10.data?.custodyFeePct || existing.custody_fee_pct || "",
    total_fee_pct: f10.data?.totalFeePct || tracking.fee_pct || existing.total_fee_pct || "",
    avg_daily_turnover_cny: existing.avg_daily_turnover_cny || "",
    latest_premium_discount_pct: existing.latest_premium_discount_pct || "",
    tracking_error_pct: existing.tracking_error_pct || "",
    is_primary: isPrimary ? "true" : "false",
    source_url: f10.sourceUrl || existing.source_url || "",
    updated_at: TODAY,
    data_status: status,
    note: noteParts.join("；"),
  });
}

const output = [FIELDS.join(","), ...rows.map((row) => FIELDS.map((field) => escapeCsv(row[field])).join(","))].join("\n") + "\n";
writeFileSync(join(DATA_DIR, "etf_products.csv"), output, "utf-8");

const f10Count = rows.filter((row) => row.aum_cny || row.management_fee_pct || row.custody_fee_pct).length;
console.log(`wrote ${rows.length} rows to public/data/etf_products.csv`);
console.log(`F10 fields updated for ${f10Count} rows`);
