/**
 * 将 index_tracking_etfs + etf_products 中有、但 etfs/etfsmore 中缺的场内 ETF
 * 补一行 etfsmore 元数据（名称、策略占位），避免前端出现「仅 bars 有数据」占位名。
 *
 *   node scripts/sync_etfsmore_missing.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA = join(process.cwd(), "public", "data");
const TEMPLATE = {
  strategy_id: "rsi_mean_reversion",
  param_version: "v20260520",
  product_kind: "ETF",
  dividend_market_scope: "",
  div_yield_nominal_pct: "0",
  div_yield_source: "估算",
};

function parseCsv(path) {
  const text = readFileSync(path, "utf-8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cols = line.split(",");
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i]?.trim() ?? "";
    });
    return row;
  });
  return { headers, rows };
}

function isListedEtf(code) {
  return /^(50|51|52|53|56|58|15|16|18)\d{4}$/.test(code);
}

const etfs = [
  ...parseCsv(join(DATA, "etfs.csv")).rows,
  ...parseCsv(join(DATA, "etfsmore.csv")).rows,
];
const known = new Set(etfs.map((r) => r.code).filter(Boolean));
const tracking = parseCsv(join(DATA, "index_tracking_etfs.csv")).rows;
const products = new Map(
  parseCsv(join(DATA, "etf_products.csv")).rows.map((r) => [r.code, r]),
);
const indices = new Map(
  parseCsv(join(DATA, "indices.csv")).rows.map((r) => [r.index_code, r]),
);

const additions = [];
for (const row of tracking) {
  const code = row.etf_code?.trim();
  if (!code || known.has(code) || !isListedEtf(code)) continue;
  const product = products.get(code);
  const index = indices.get(row.index_code);
  const scope =
    index?.category === "A股红利"
      ? "A股红利"
      : index?.category === "港股红利"
        ? "港股红利"
        : index?.category === "现金流"
          ? "现金流类"
          : "";
  const name =
    product?.name ||
    row.note?.split("；")[0]?.trim() ||
    code;
  additions.push({
    code,
    name,
    ...TEMPLATE,
    dividend_market_scope: scope,
    product_kind: scope === "现金流类" ? "现金流类" : TEMPLATE.product_kind,
  });
  known.add(code);
}

if (additions.length === 0) {
  console.log("etfsmore: 无缺失标的");
  process.exit(0);
}

const etfsmorePath = join(DATA, "etfsmore.csv");
const existing = readFileSync(etfsmorePath, "utf-8").replace(/\n?$/, "\n");
const header =
  "code,name,strategy_id,param_version,product_kind,dividend_market_scope,div_yield_nominal_pct,div_yield_source\n";
const lines = additions.map(
  (r) =>
    `${r.code},${r.name},${r.strategy_id},${r.param_version},${r.product_kind},${r.dividend_market_scope},${r.div_yield_nominal_pct},${r.div_yield_source}`,
);
writeFileSync(etfsmorePath, existing + lines.join("\n") + "\n", "utf-8");
console.log(`etfsmore: 追加 ${additions.length} 行 → ${additions.map((r) => r.code).join(", ")}`);
