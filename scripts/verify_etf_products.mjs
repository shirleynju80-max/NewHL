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
  const text = readFileSync(path, "utf-8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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

const indices = new Set(parseCsv("public/data/indices.csv").map((row) => row.index_code));
const products = parseCsv("public/data/etf_products.csv");

assert(products.length > 0, "etf_products.csv should contain rows");

for (const product of products) {
  assert(product.code, "each product should have code");
  assert(product.index_code, `${product.code} should have index_code`);
  assert(
    indices.has(product.index_code) || product.data_status === "needs_review",
    `${product.code} index_code ${product.index_code} should link to indices.csv or be marked needs_review`
  );
}

assert.equal(products.find((row) => row.index_code === "H30269" && row.is_primary === "true")?.code, "512890");
assert.equal(products.find((row) => row.index_code === "931157" && row.is_primary === "true")?.code, "007751");

for (const code of ["159201", "159232", "159399"]) {
  assert.equal(products.find((row) => row.code === code)?.product_group, "cash_creation");
}

for (const indexCode of new Set(products.map((row) => row.index_code))) {
  const primaryRows = products.filter((row) => row.index_code === indexCode && row.is_primary === "true");
  assert.equal(primaryRows.length, 1, `${indexCode} should have exactly one primary product`);
}

console.log(`verified ${products.length} ETF product rows`);
