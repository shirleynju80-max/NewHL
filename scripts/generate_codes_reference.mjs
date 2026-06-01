import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA = join(process.cwd(), "public", "data");
const OUT = join(DATA, "CODES_REFERENCE.txt");

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

function parseCsv(name) {
  const path = join(DATA, name);
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

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function formatList(codes) {
  if (!codes.length) return "  （无）";
  const lines = [];
  for (let i = 0; i < codes.length; i += 8) {
    lines.push(`  ${codes.slice(i, i + 8).join(", ")}`);
  }
  return lines.join("\n");
}

const barsMain = parseCsv("bars.csv");
const barsMore = parseCsv("barsmore.csv");
const fundBars = parseCsv("fund_bars.csv");
const etfsMain = parseCsv("etfs.csv");
const etfsMore = parseCsv("etfsmore.csv");
const tracking = parseCsv("index_tracking_etfs.csv");
const products = parseCsv("etf_products.csv");
const indices = parseCsv("indices.csv");

const mainBarCodes = uniqueSorted(barsMain.map((r) => r.etf_code));
const moreBarCodes = uniqueSorted(barsMore.map((r) => r.etf_code));
const mergedBarCodes = uniqueSorted([
  ...barsMain.map((r) => r.etf_code),
  ...barsMore.map((r) => r.etf_code),
]);
const fundCodes = uniqueSorted(fundBars.map((r) => r.fund_code));
const etfMetaCodes = uniqueSorted([
  ...etfsMain.map((r) => r.code),
  ...etfsMore.map((r) => r.code),
]);
const otcTracking = tracking.filter(
  (r) => (r.product_type || "").toLowerCase() === "otc_fund",
);
const primaries = products.filter((r) => r.is_primary === "true");

const today = new Date().toISOString().slice(0, 10);
const text = `本文件说明当前仓库 public/data 下 CSV 中的产品代码（与运行时 bars+etfs 合并规则一致）。
由 scripts/generate_codes_reference.mjs 生成；生成日期 ${today}。本地若手改 CSV，请重新运行 npm run data:codes-reference。

【bars.csv】etf_code（${mainBarCodes.length}）
${formatList(mainBarCodes)}

【barsmore.csv】etf_code（${moreBarCodes.length}，含与主表重叠）
${formatList(moreBarCodes)}

【bars ∪ barsmore 合并后】场内 ETF 行情代码（${mergedBarCodes.length}）
${formatList(mergedBarCodes)}
  说明：同一 etf_code + 同一 date 以 barsmore 为准。

【fund_bars.csv】场外基金 fund_code（${fundCodes.length}）
${formatList(fundCodes)}
  说明：开放式基金净值；加载时并入 ETF 看板（/etf/:code）。

【etfs.csv ∪ etfsmore.csv】策略/元数据 code（${etfMetaCodes.length}）
${formatList(etfMetaCodes)}

【index_tracking_etfs.csv】映射（${tracking.length} 行，${indices.length} 只指数）
  场外 OTC：${otcTracking.map((r) => `${r.index_code}→${r.etf_code}`).join("；") || "无"}

【etf_products.csv】主跟踪 is_primary=true（${primaries.length}）
${formatList(primaries.map((r) => r.code))}

【indices.csv】指数代码（${indices.length}）
${formatList(indices.map((r) => r.index_code))}
`;

writeFileSync(OUT, text, "utf-8");
console.log(`wrote ${OUT}`);
