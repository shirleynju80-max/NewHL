/**
 * 离线网格回测：按 dividend_market_scope 筛选标的，使用 DEFAULT_PARAM_SEARCH，
 * 每类策略输出 Top N（默认 5），与「策略回测与注册」页逻辑一致。
 *
 * 用法（项目根目录）：
 *   npx tsx scripts/backtest_grid/run_scope_top5.ts --scope A股红利
 *   npx tsx scripts/backtest_grid/run_scope_top5.ts --scope A股红利 --code 510880
 *   npx tsx scripts/backtest_grid/run_scope_top5.ts --scope A股红利 --top 5
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { buildCsvBundle } from "../../src/data/csvLoader";
import {
  DEFAULT_PARAM_SEARCH,
  gridSearchTopParams,
  type GridSearchOutcome,
  type ScoredParamRow,
} from "../../src/lib/paramBacktest";
import type { DividendMarketScope, EtfDefinition } from "../../src/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "../..");
const DATA = join(REPO, "public/data");
const OUT_BASE = join(__dirname, "output");

function readData(name: string): string {
  return readFileSync(join(DATA, name), "utf8");
}

function parseArgs(argv: string[]) {
  let scope: DividendMarketScope = "A股红利";
  let code: string | undefined;
  let top = 5;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scope" && argv[i + 1]) scope = argv[++i] as DividendMarketScope;
    else if (a === "--code" && argv[i + 1]) code = argv[++i];
    else if (a === "--top" && argv[i + 1]) top = Math.max(1, Number(argv[++i]) || 5);
  }
  return { scope, code, top };
}

function loadBundle() {
  const merge: Parameters<typeof buildCsvBundle>[4] = {};
  try {
    merge.etfsMore = readData("etfsmore.csv");
  } catch {
    /* optional */
  }
  try {
    merge.barsMore = readData("barsmore.csv");
  } catch {
    /* optional */
  }
  try {
    merge.fundBars = readData("fund_bars.csv");
  } catch {
    /* optional */
  }
  const hasMerge = Boolean(merge.etfsMore || merge.barsMore || merge.fundBars);
  return buildCsvBundle(
    readData("etfs.csv"),
    readData("bars.csv"),
    readData("bonds.csv"),
    readData("etf_params.csv"),
    hasMerge ? merge : undefined
  );
}

function fmtRow(r: ScoredParamRow, i: number): string {
  const ev = r.excessValPct != null ? `${r.excessValPct.toFixed(2)}%` : "—";
  const et = r.excessTrainPct != null ? `${r.excessTrainPct.toFixed(2)}%` : "—";
  return [
    `${i + 1}. ${r.label}`,
    `   策略 ${r.strategyId} | 累计 ${r.cumReturnPct.toFixed(2)}% | 超额(全) ${r.excessReturnPct.toFixed(2)}%`,
    `   验证超额 ${ev} | 训练超额 ${et} | 回撤 ${r.maxDrawdownPct.toFixed(2)}% | 轮次 ${r.roundCount} | 胜率 ${(r.winRate * 100).toFixed(1)}%`,
  ].join("\n");
}

function section(title: string, rows: ScoredParamRow[]): string {
  if (!rows.length) return `### ${title}\n（无有效组合）\n`;
  return `### ${title}\n${rows.map((r, i) => fmtRow(r, i)).join("\n")}\n`;
}

function outcomeToMarkdown(etf: EtfDefinition, result: GridSearchOutcome): string {
  const def = etf.meta;
  const lines: string[] = [
    `# ${def.code} ${def.name}`,
    "",
    `- 市场：${def.dividend_market_scope ?? "—"}`,
    `- 数据源默认策略：\`${def.strategy_id}\` · \`${def.param_version}\``,
    `- 样本：${result.meta.startDate} → ${result.meta.endDate}（${result.meta.barCount} 日）`,
    `- 买入持有：${result.meta.buyHoldReturnPct.toFixed(2)}% | 年化 ${result.meta.buyHoldAnnualPct.toFixed(2)}% | 回撤 ${result.meta.buyHoldMaxDrawdownPct.toFixed(2)}%`,
    `- 切分：训练 ${result.split.trainStartDate}–${result.split.trainEndDate}（${result.split.trainBarCount} 日）| 验证 ${result.split.valStartDate}–${result.split.valEndDate}（${result.split.valBarCount} 日）`,
    `- 可信度：${result.split.credibility}`,
    ...(result.split.notes.length ? result.split.notes.map((n) => `- 注：${n}`) : []),
    "",
    result.globalRobustBest
      ? `**☆ 验证集最优（全网格）**：${result.globalRobustBest.label}（验证超额 ${result.globalRobustBest.excessValPct?.toFixed(2)}%）`
      : "**☆ 验证集最优**：—",
    result.globalFullBest
      ? `**★ 全样本最优（全网格）**：${result.globalFullBest.label}（全样本超额 ${result.globalFullBest.excessReturnPct.toFixed(2)}%）`
      : "**★ 全样本最优**：—",
    "",
    section("MA 金叉", result.maCross),
    section("MA 自定义", result.maCustom),
    section("RSI", result.rsi),
    section("BOLL", result.boll),
  ];
  return lines.join("\n");
}

function runOne(etf: EtfDefinition, top: number): GridSearchOutcome {
  const bars = etf.bars;
  if (!bars || bars.length < 40) {
    throw new Error(`${etf.meta.code} 日 K 不足 40 根（当前 ${bars?.length ?? 0}）`);
  }
  return gridSearchTopParams(bars, top, DEFAULT_PARAM_SEARCH, { trainRatio: 0.7 });
}

function main() {
  const { scope, code, top } = parseArgs(process.argv.slice(2));
  const { definitions } = loadBundle();
  let targets = definitions.filter((d) => d.meta.dividend_market_scope === scope);
  if (code) targets = targets.filter((d) => d.meta.code === code);
  targets.sort((a, b) => a.meta.code.localeCompare(b.meta.code));

  if (!targets.length) {
    console.error(`未找到 scope=${scope}${code ? ` code=${code}` : ""} 的标的`);
    process.exit(1);
  }

  const outDir = join(OUT_BASE, scope);
  mkdirSync(outDir, { recursive: true });

  console.log(`网格范围：DEFAULT_PARAM_SEARCH（与注册页默认一致）`);
  console.log(`市场：${scope} | 标的数：${targets.length} | 每类 Top ${top}\n`);

  const summaryRows: string[] = [`# ${scope} 网格回测汇总`, "", `生成时间：${new Date().toISOString()}`, ""];

  for (const etf of targets) {
    const c = etf.meta.code;
    process.stdout.write(`[${scope}] ${c} ${etf.meta.name} … `);
    try {
      const result = runOne(etf, top);
      const md = outcomeToMarkdown(etf, result);
      const jsonPath = join(outDir, `${c}.json`);
      const mdPath = join(outDir, `${c}.md`);
      writeFileSync(jsonPath, JSON.stringify({ etf: { code: c, name: etf.meta.name, strategy_id: etf.meta.strategy_id, param_version: etf.meta.param_version }, result }, null, 2));
      writeFileSync(mdPath, md);
      const robust = result.globalRobustBest?.label ?? "—";
      const full = result.globalFullBest?.label ?? "—";
      summaryRows.push(`## ${c} ${etf.meta.name}`, `- 样本 ${result.meta.barCount} 日 | BH ${result.meta.buyHoldReturnPct.toFixed(1)}%`, `- ☆验证最优：${robust}`, `- ★全样本最优：${full}`, `- 明细：\`${mdPath}\``, "");
      console.log("ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      summaryRows.push(`## ${c} ${etf.meta.name}`, `- **失败**：${msg}`, "");
      console.log(`FAIL: ${msg}`);
    }
  }

  const summaryPath = join(outDir, "_SUMMARY.md");
  writeFileSync(summaryPath, summaryRows.join("\n"));
  console.log(`\n汇总：${summaryPath}`);
}

main();
