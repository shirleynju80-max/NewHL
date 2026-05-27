/**
 * 校验 pickTopFullAndValRows（类内 Top N = 全样本位 + 验证位）。
 * 用法：npx tsx scripts/verify_param_top2.mjs [etf_code]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const code = process.argv[2] ?? "513910";
const root = process.cwd();
const barsText = readFileSync(join(root, "public/data/bars.csv"), "utf8");
const bars = [];
for (const line of barsText.split("\n")) {
  if (!line.startsWith(`${code},`)) continue;
  const p = line.split(",");
  bars.push({
    date: p[1],
    open: +p[2],
    high: +p[3],
    low: +p[4],
    close: +p[5],
  });
}
bars.sort((a, b) => a.date.localeCompare(b.date));
if (bars.length < 80) {
  console.error(`FAIL: ${code} 仅 ${bars.length} 根 K 线`);
  process.exit(1);
}

const { gridSearchTopParams } = await import("../src/lib/paramBacktest.ts");

const topK = 2;
const out = gridSearchTopParams(bars, topK);
const families = [
  ["rsi", out.rsi],
  ["boll", out.boll],
  ["maCross", out.maCross],
  ["maCustom", out.maCustom],
];

let failed = 0;
for (const [name, picked] of families) {
  if (picked.length > topK) {
    console.error(`FAIL ${name}: 入选 ${picked.length} > topK ${topK}`);
    failed++;
    continue;
  }
  const fullSlots = topK - Math.floor(topK / 2);
  const valSlots = Math.floor(topK / 2);
  const fullCount = picked.filter((r) => r.pickSlots.includes("full")).length;
  const valCount = picked.filter((r) => r.pickSlots.includes("val")).length;
  if (fullCount > fullSlots || valCount > valSlots) {
    console.error(
      `FAIL ${name}: 全样本位 ${fullCount}/${fullSlots} 验证位 ${valCount}/${valSlots}`,
    );
    failed++;
  }
  for (const r of picked) {
    if (!r.pickSlots.length) {
      console.error(`FAIL ${name}: ${r.label} 无 pickSlots`);
      failed++;
    }
  }
  console.log(
    `OK ${name} (${picked.length}):`,
    picked
      .map(
        (r) =>
          `${r.label} [${r.pickSlots.join("+")}] full=${r.excessReturnPct.toFixed(2)} val=${r.excessValPct?.toFixed(2) ?? "—"}`,
      )
      .join(" | "),
  );
}

const boll605 = out.boll.find((r) => r.label.includes("60/2.5"));
if (boll605 && !boll605.pickSlots.includes("full")) {
  console.error(`FAIL boll: 60/2.5 应在全样本位，实际 slots=${boll605.pickSlots}`);
  failed++;
} else if (boll605) {
  console.log(`OK boll 60/2.5 在 Top2 且带全样本位`);
} else {
  console.log(
    `WARN boll: 60/2.5 未入选 Top2（网格或样本变化），当前:`,
    out.boll.map((r) => r.label).join(", "),
  );
}

if (failed) process.exit(1);
console.log(`\n全部通过 · ${code} · ${bars.length} 根 K 线`);
