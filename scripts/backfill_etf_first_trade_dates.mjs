/**
 * 补齐 etf_products.csv 中缺失的 first_trade_date / data_status。
 * 优先级：本地 bars → 东方财富日 K 首根 → 天天基金 F10 成立日期 → listed_date。
 *
 * 用法：node scripts/backfill_etf_first_trade_dates.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, "public", "data");
const TODAY = new Date().toISOString().slice(0, 10);
const HIS_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get";

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
  const text = readFileSync(join(DATA_DIR, name), "utf-8")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length < 2) return { headers: parseCsvLine(lines[0] ?? ""), rows: [] };
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((header, i) => {
      row[header.trim()] = cols[i]?.trim() ?? "";
    });
    return row;
  });
  return { headers, rows };
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
    .replace(/\s+/g, " ")
    .trim();
}

function tableValueByHeader(html, header) {
  const re = new RegExp(`<th[^>]*>\\s*${header}\\s*<\\/th>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, "i");
  const m = html.match(re);
  return m ? stripHtml(m[1]) : "";
}

function normalizeDate(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(/(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})/);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function isYmd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function secidFor(code) {
  if (!/^\d{6}$/.test(code)) return null;
  if (/^(50|51|52|53|56|58)/.test(code)) return `1.${code}`;
  if (/^(15|16|18)/.test(code)) return `0.${code}`;
  return null;
}

function earliestDate(rows, codeField, code) {
  const dates = rows
    .filter((row) => row[codeField] === code && row.date)
    .map((row) => row.date)
    .sort();
  return dates[0] ?? "";
}

function isOtcProduct(row) {
  return row.exchange === "OTC" || row.product_group === "otc_fund";
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://quote.eastmoney.com/",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function fetchFirstTradeFromKline(code) {
  const secid = secidFor(code);
  if (!secid) return "";
  const params = new URLSearchParams({
    secid,
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58",
    klt: "101",
    fqt: "1",
    beg: "20000101",
    end: TODAY.replace(/-/g, ""),
    lmt: "120000",
  });
  const json = JSON.parse(await fetchText(`${HIS_URL}?${params}`));
  const klines = json.data?.klines ?? [];
  if (!klines.length) return "";
  return String(klines[0]).split(",")[0] ?? "";
}

async function fetchSetupDateFromF10(code) {
  const html = await fetchText(`https://fundf10.eastmoney.com/jbgk_${code}.html`);
  return normalizeDate(tableValueByHeader(html, "成立日期/规模"));
}

function appendNote(row, fragment) {
  const note = row.note?.trim() ?? "";
  if (!fragment || note.includes(fragment)) return note;
  return note ? `${note}；${fragment}` : fragment;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const { rows: products } = parseCsvFile("etf_products.csv");
const bars = [...parseCsvFile("bars.csv").rows, ...parseCsvFile("barsmore.csv").rows];
const fundBars = parseCsvFile("fund_bars.csv").rows;

let filledFromBars = 0;
let filledFromKline = 0;
let filledFromF10 = 0;
let filledFromListed = 0;
let stillMissing = 0;

for (const row of products) {
  if (row.first_trade_date?.trim()) continue;

  const code = row.code;
  const otc = isOtcProduct(row);
  let date = otc ? earliestDate(fundBars, "fund_code", code) : earliestDate(bars, "etf_code", code);
  let source = "";

  if (date) {
    source = "bars";
    filledFromBars += 1;
  } else if (!otc) {
    try {
      date = await fetchFirstTradeFromKline(code);
      await sleep(280);
      if (date) {
        source = "kline";
        filledFromKline += 1;
      }
    } catch {
      /* 网络不可用时继续 F10 / listed_date */
    }
  }

  if (!date && !otc) {
    try {
      date = await fetchSetupDateFromF10(code);
      await sleep(280);
      if (date) {
        source = "f10";
        filledFromF10 += 1;
      }
    } catch {
      /* ignore */
    }
  }

  if (!date) {
    const listed = row.listed_date?.trim() ?? "";
    if (isYmd(listed) && listed <= TODAY) {
      date = listed;
      source = "listed_date";
      filledFromListed += 1;
    }
  }

  if (!date) {
    stillMissing += 1;
    continue;
  }

  row.first_trade_date = date;
  row.updated_at = TODAY;
  if (source === "bars" || source === "kline") {
    row.data_status = "ok";
    if (source === "kline") {
      row.note = appendNote(row, "first_trade_date 来自东方财富日 K 首根");
    }
  } else {
    row.data_status = "partial";
    row.note = appendNote(
      row,
      source === "f10"
        ? "first_trade_date 取自 F10 成立日期，待本地行情校验"
        : "first_trade_date 取自 listed_date，待本地行情校验"
    );
  }
  if (!row.listed_date?.trim() && (source === "f10" || source === "listed_date")) {
    row.listed_date = date;
  }
}

const output = [FIELDS.join(","), ...products.map((row) => FIELDS.map((field) => escapeCsv(row[field])).join(","))].join(
  "\n"
) + "\n";
writeFileSync(join(DATA_DIR, "etf_products.csv"), output, "utf-8");

const withDate = products.filter((r) => r.first_trade_date?.trim()).length;
console.log(`etf_products.csv: ${withDate}/${products.length} 行已有 first_trade_date`);
console.log(
  `本次补齐：bars=${filledFromBars} kline=${filledFromKline} f10=${filledFromF10} listed_date=${filledFromListed} 仍缺失=${stillMissing}`
);
if (stillMissing) {
  console.log(
    "仍缺失代码:",
    products
      .filter((r) => !r.first_trade_date?.trim())
      .map((r) => r.code)
      .join(", ")
  );
}
