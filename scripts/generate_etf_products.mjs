import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, "public", "data");
const UPDATED_AT = "2026-05-21";

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

function parseCsvFile(name) {
  const text = readFileSync(join(DATA_DIR, name), "utf-8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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

const etfMetas = [...parseCsvFile("etfs.csv"), ...parseCsvFile("etfsmore.csv")];
const metaByCode = new Map();
for (const meta of etfMetas) {
  if (meta.code && !metaByCode.has(meta.code)) metaByCode.set(meta.code, meta);
}

const indicesByCode = new Map(parseCsvFile("indices.csv").map((row) => [row.index_code, row]));
const trackingRows = parseCsvFile("index_tracking_etfs.csv");
const bars = [...parseCsvFile("bars.csv"), ...parseCsvFile("barsmore.csv")];
const fundBars = parseCsvFile("fund_bars.csv");
const seenIndex = new Set();

const rows = trackingRows.map((tracking) => {
  const code = tracking.etf_code;
  const productType = (tracking.product_type || "etf").trim() || "etf";
  const isOtc = productType === "otc_fund";
  const index = indicesByCode.get(tracking.index_code);
  const meta = metaByCode.get(code);
  const trackingName = tracking.note ? tracking.note.split("；")[0].trim() : "";
  const trackingNoteRemainder = tracking.note ? tracking.note.split("；").slice(1).join("；").trim() : "";
  const name = meta?.name || trackingName || code;
  const firstTradeDate = isOtc ? earliestDate(fundBars, "fund_code", code) : earliestDate(bars, "etf_code", code);
  const isPrimary = !seenIndex.has(tracking.index_code);
  seenIndex.add(tracking.index_code);
  const status = firstTradeDate ? (firstTradeDate === UPDATED_AT ? "partial" : "ok") : "missing";
  const noteParts = [];
  if (trackingNoteRemainder) noteParts.push(trackingNoteRemainder);
  if (!meta?.name && tracking.note) noteParts.push("名称来自 index_tracking_etfs.csv note");
  if (!isPrimary && !noteParts.some((part) => part.includes("不作为盘中默认监控"))) {
    noteParts.push("产品落地参考，不作为盘中默认监控");
  }
  if (!index) noteParts.push("待核实：index_code 未在 indices.csv 找到");
  if (tracking.fee_pct) noteParts.push("total_fee_pct 来自 index_tracking_etfs.csv fee_pct");
  return {
    code,
    name,
    product_group: isOtc ? "otc_fund" : indexGroup(index),
    index_code: tracking.index_code,
    index_name: index?.name ?? "",
    exchange: exchangeFor(code, isOtc ? "otc_fund" : "etf"),
    issuer: issuerFromName(name),
    listed_date: tracking.listed_date || "",
    first_trade_date: firstTradeDate,
    aum_cny: "",
    management_fee_pct: "",
    custody_fee_pct: "",
    total_fee_pct: tracking.fee_pct || "",
    avg_daily_turnover_cny: "",
    latest_premium_discount_pct: "",
    tracking_error_pct: "",
    is_primary: isPrimary ? "true" : "false",
    source_url: "",
    updated_at: UPDATED_AT,
    data_status: status,
    note: noteParts.join("；"),
  };
});

const output = [FIELDS.join(","), ...rows.map((row) => FIELDS.map((field) => escapeCsv(row[field])).join(","))].join("\n") + "\n";
writeFileSync(join(DATA_DIR, "etf_products.csv"), output, "utf-8");
console.log(`wrote ${rows.length} rows to public/data/etf_products.csv`);
