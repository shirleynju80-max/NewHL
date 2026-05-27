/**
 * 校验 513910 均持仓/空仓天数：打印买卖日与 gap 计算。
 * 用法：npx tsx scripts/debug_hold_flat_513910.mjs [period] [os] [ob]
 * 默认 RSI 日 24/35/75（与策略研究网格一致）
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseBarsCsv } from "../src/data/csvLoader.ts";
import { buildTrades } from "../src/lib/backtest.ts";
import {
  attachNavToRounds,
  avgFlatDays,
  buildRoundTrips,
  computeBacktestSummary,
} from "../src/lib/backtestSummary.ts";
import { shellParamsRsi } from "../src/lib/paramBacktest.ts";
import { closesFromBars, rsi } from "../src/lib/indicators.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "../public/data");

function rsiSignalsFromSeries(series, ob, os) {
  const sig = series.map(() => "HOLD");
  for (let i = 1; i < series.length; i++) {
    const r = series[i];
    const pr = series[i - 1];
    if (r == null || pr == null) continue;
    if (pr >= os && r < os) sig[i] = "BUY";
    else if (pr <= ob && r > ob) sig[i] = "SELL";
  }
  return sig;
}

function barIndexByDate(bars, date) {
  return bars.findIndex((b) => b.date === date);
}

const period = Number(process.argv[2]) || 24;
const os = Number(process.argv[3]) || 35;
const ob = Number(process.argv[4]) || 75;

const barsText = readFileSync(join(DATA, "bars.csv"), "utf8");
const barsMap = parseBarsCsv(barsText);
const bars = [...(barsMap.get("513910") ?? [])].sort((a, b) =>
  a.date.localeCompare(b.date),
);
if (bars.length < 40) {
  console.error("513910 K线不足");
  process.exit(1);
}

const label = `RSI日 p${period} OS${os}/OB${ob}`;
const params = shellParamsRsi(period, ob, os);
const cl = closesFromBars(bars);
const ser = rsi(cl, period);
const signals = rsiSignalsFromSeries(ser, ob, os);
const trades = buildTrades(
  bars,
  signals,
  `debug-rsi-${period}`,
  "str_rsi_mean_cn",
  params,
);
const rounds = attachNavToRounds(buildRoundTrips(trades));
const summary = computeBacktestSummary(bars, trades, rounds);

console.log(`\n=== 513910 ${label} ===`);
console.log(`K线: ${bars[0]?.date} → ${bars[bars.length - 1]?.date}（${bars.length} 根）`);
console.log(
  `汇总: 轮次 ${summary.roundCount} | 均持仓 ${summary.avgHoldDays} 日 | 均空仓 ${summary.avgFlatDays} 日`,
);
console.log(`原始买卖: 买 ${summary.rawBuyCount} / 卖 ${summary.rawSellCount}\n`);

console.log("--- 成交流水（含未配对买）---");
for (const t of trades) {
  const extra =
    t.side === "SELL"
      ? ` holdDays=${t.holdDays} pnl=${t.pnlPct}%`
      : "";
  console.log(`  ${t.date} ${t.side.padEnd(4)} ${t.price.toFixed(4)} ${t.reason}${extra}`);
}

console.log("\n--- 完整买卖对（round）---");
for (const r of rounds) {
  const bi = barIndexByDate(bars, r.buyDate);
  const si = barIndexByDate(bars, r.sellDate);
  const idxHold = si - bi;
  console.log(
    `  #${r.round} 买 ${r.buyDate}[${bi}] → 卖 ${r.sellDate}[${si}] | holdDays(成交)=${r.holdDays} | 索引差=${idxHold}`,
  );
}

if (rounds.length >= 2) {
  console.log("\n--- 空仓间隔（卖→下一买，仅 d>0 计入均空仓）---");
  const gaps = [];
  for (let i = 1; i < rounds.length; i++) {
    const ia = barIndexByDate(bars, rounds[i - 1].sellDate);
    const ib = barIndexByDate(bars, rounds[i].buyDate);
    const d = ib - ia - 1;
    gaps.push(d);
    const mark = d > 0 ? "计入" : "跳过(d≤0)";
    console.log(
      `  卖 ${rounds[i - 1].sellDate}[${ia}] → 买 ${rounds[i].buyDate}[${ib}] | gap=${d} | ${mark}`,
    );
  }
  const used = gaps.filter((d) => d > 0);
  console.log(
    `\n  gaps=${JSON.stringify(gaps)} | 计入均值=${used.length ? (used.reduce((a, b) => a + b, 0) / used.length).toFixed(2) : 0} | avgFlatDays=${summary.avgFlatDays}`,
  );
} else {
  console.log("\n（轮次<2，avgFlatDays 固定为 0）");
}

console.log("\n口径说明:");
console.log("  holdDays = 卖日K线索引 − 买日K线索引（交易日根数差，非自然日）");
console.log("  avgHoldDays = 各轮 holdDays 算术平均");
console.log("  avgFlatDays = 相邻两轮之间 (下一买索引 − 上一卖索引 − 1)，仅 gap>0 求平均");
console.log("  不含：样本起点→首买、末卖→样本终点 的空仓时长\n");
