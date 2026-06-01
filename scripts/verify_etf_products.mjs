import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

function parseCsv(path) {
  const text = readFileSync(path, "utf-8")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = text.split("\n").filter((line) => line.trim());
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((header, i) => {
      row[header] = cols[i] ?? "";
    });
    return row;
  });
}

/** 指数研究列表展示；000300 仅作详情页基准 */
const INDEX_CODES_SKIP_PRIMARY = new Set(["000300"]);

const indexRows = parseCsv("public/data/indices.csv");
const indices = new Set(indexRows.map((row) => row.index_code));
const products = parseCsv("public/data/etf_products.csv");
const tracking = parseCsv("public/data/index_tracking_etfs.csv");
const fundBars = parseCsv("public/data/fund_bars.csv");
const bars = [
  ...parseCsv("public/data/bars.csv"),
  ...parseCsv("public/data/barsmore.csv"),
];

assert(products.length > 0, "etf_products.csv should contain rows");
assert(tracking.length > 0, "index_tracking_etfs.csv should contain rows");

for (const product of products) {
  assert(product.code, "each product should have code");
  assert(product.index_code, `${product.code} should have index_code`);
  assert(
    indices.has(product.index_code) || product.data_status === "needs_review",
    `${product.code} index_code ${product.index_code} should link to indices.csv or be marked needs_review`,
  );
}

assert.equal(
  products.find((row) => row.index_code === "H30269" && row.is_primary === "true")
    ?.code,
  "512890",
);
assert.equal(
  products.find((row) => row.index_code === "931157" && row.is_primary === "true")
    ?.code,
  "007751",
);

for (const code of ["159201", "159232", "159399"]) {
  assert.equal(
    products.find((row) => row.code === code)?.product_group,
    "cash_creation",
  );
}

for (const indexCode of new Set(products.map((row) => row.index_code))) {
  const primaryRows = products.filter(
    (row) => row.index_code === indexCode && row.is_primary === "true",
  );
  assert.equal(
    primaryRows.length,
    1,
    `${indexCode} should have exactly one primary product`,
  );
}

const primaryByIndex = new Map(
  products
    .filter((row) => row.is_primary === "true")
    .map((row) => [row.index_code, row]),
);
const barCodes = new Set(bars.map((row) => row.etf_code));
const fundCodes = new Set(fundBars.map((row) => row.fund_code));
const trackingByIndex = new Map();
for (const row of tracking) {
  if (!trackingByIndex.has(row.index_code)) {
    trackingByIndex.set(row.index_code, row);
  }
}

for (const index of indexRows) {
  const code = index.index_code;
  if (INDEX_CODES_SKIP_PRIMARY.has(code)) continue;

  const primary = primaryByIndex.get(code);
  assert(primary, `${code} (${index.name}) 缺少 etf_products 主跟踪产品`);

  const track = trackingByIndex.get(code);
  assert(track, `${code} 缺少 index_tracking_etfs 首行映射`);
  assert.equal(
    track.etf_code,
    primary.code,
    `${code} tracking 首产品与 etf_products 主产品不一致`,
  );

  const hasBars = barCodes.has(primary.code) || fundCodes.has(primary.code);
  assert(
    hasBars || primary.data_status === "missing",
    `${code} 主产品 ${primary.code} 无 bars/fund_bars 但 data_status=${primary.data_status}`,
  );
}

assert.equal(
  tracking.find((row) => row.index_code === "931157" && row.etf_code === "007751")
    ?.product_type,
  "otc_fund",
  "931157/007751 须在 index_tracking_etfs 标记 otc_fund",
);

for (const row of tracking) {
  assert(
    indices.has(row.index_code),
    `tracking ${row.etf_code} 指向未知指数 ${row.index_code}`,
  );
  assert(
    products.some(
      (product) =>
        product.index_code === row.index_code && product.code === row.etf_code,
    ),
    `tracking ${row.index_code}/${row.etf_code} 未出现在 etf_products.csv`,
  );
}

console.log(
  `verified ${products.length} product rows, ${tracking.length} tracking rows, ${primaryByIndex.size} index primaries`,
);
