/**
 * 红利观察池：按指数选 3–5 只代表产品（收益/回撤/波动 + 高相关去重）；
 * 评估 etf_params.csv 已注册参数的训练/验证超额与波段适配度。
 *
 *   npx tsx scripts/analyze_dividend_pool.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { buildCsvBundle, parseFundBarsCsv } from "../src/data/csvLoader";
import { parseCsv, rowsToObjects } from "../src/lib/csv";
import { parseEtfProductsCsv } from "../src/lib/etfProducts";
import {
  buildCustomBaselineDraft,
  scoreCustomParamBaseline,
  type ScoredParamRow,
} from "../src/lib/paramBacktest";
import type { EtfDefinition, EtfParams, OhlcBar } from "../src/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");
const DATA = join(REPO, "public/data");
const OUT = join(__dirname, "output/dividend_pool");

function readData(name: string): string {
  return readFileSync(join(DATA, name), "utf8");
}

function loadBundle() {
  const merge: Parameters<typeof buildCsvBundle>[4] = {};
  try {
    merge.etfsMore = readData("etfsmore.csv");
  } catch {
    /* */
  }
  try {
    merge.barsMore = readData("barsmore.csv");
  } catch {
    /* */
  }
  try {
    merge.fundBars = readData("fund_bars.csv");
  } catch {
    /* */
  }
  const hasMerge = Boolean(merge.etfsMore || merge.barsMore || merge.fundBars);
  return buildCsvBundle(
    readData("etfs.csv"),
    readData("bars.csv"),
    readData("bonds.csv"),
    readData("etf_params.csv"),
    hasMerge ? merge : undefined,
  );
}

type Metrics = {
  code: string;
  name: string;
  indexCode: string;
  category?: string;
  primaryEtfCode?: string;
  primaryEtfName?: string;
  isPrimary: boolean;
  barCount: number;
  start: string;
  end: string;
  totalReturnPct: number;
  annReturnPct: number;
  volPct: number;
  maxDdPct: number;
  score: number;
};

type PickResult<T extends Metrics> = {
  picked: T[];
  skippedHighlyCorrelated: {
    candidate: T;
    kept: T;
    corr: number;
  }[];
};

function dailyReturns(bars: OhlcBar[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const p0 = bars[i - 1]!.close;
    const p1 = bars[i]!.close;
    if (p0 > 0 && p1 > 0) out.push(p1 / p0 - 1);
  }
  return out;
}

function metricsFromSeries(
  code: string,
  name: string,
  bars: OhlcBar[],
  windowYears = 5,
): Metrics | null {
  if (!bars || bars.length < 120) return null;
  const end = bars[bars.length - 1]!.date;
  const cut = new Date(end);
  cut.setFullYear(cut.getFullYear() - windowYears);
  const cutStr = cut.toISOString().slice(0, 10);
  let slice = bars.filter((b) => b.date >= cutStr);
  if (slice.length < 120) slice = bars;
  const closes = slice.map((b) => b.close);
  const rets = dailyReturns(slice);
  if (rets.length < 60) return null;
  const totalReturnPct = ((closes[closes.length - 1]! / closes[0]!) - 1) * 100;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const var_ =
    rets.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  const volPct = Math.sqrt(var_) * Math.sqrt(252) * 100;
  let peak = closes[0]!;
  let maxDd = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    maxDd = Math.max(maxDd, (peak - c) / peak);
  }
  const maxDdPct = maxDd * 100;
  const years = (slice.length - 1) / 252;
  const annReturnPct =
    years > 0
      ? (Math.pow(closes[closes.length - 1]! / closes[0]!, 1 / years) - 1) * 100
      : 0;
  const score =
    annReturnPct * 0.45 - maxDdPct * 0.35 - volPct * 0.2;
  return {
    code,
    name,
    indexCode: "—",
    isPrimary: false,
    barCount: slice.length,
    start: slice[0]!.date,
    end: slice[slice.length - 1]!.date,
    totalReturnPct,
    annReturnPct,
    volPct,
    maxDdPct,
    score,
  };
}

function metricsFromBars(
  etf: EtfDefinition,
  windowYears = 5,
): Metrics | null {
  const m = metricsFromSeries(etf.meta.code, etf.meta.name, etf.bars, windowYears);
  if (!m) return null;
  m.indexCode = etf.meta.index_code ?? "—";
  m.isPrimary = Boolean(etf.meta.is_primary);
  return m;
}

function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 30) return null;
  const ax = a.slice(-n);
  const bx = b.slice(-n);
  const ma = ax.reduce((s, x) => s + x, 0) / n;
  const mb = bx.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = ax[i]! - ma;
    const xb = bx[i]! - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const den = Math.sqrt(da * db);
  return den > 1e-12 ? num / den : null;
}

function alignedReturns(
  a: OhlcBar[],
  b: OhlcBar[],
): { ra: number[]; rb: number[] } | null {
  const mapB = new Map(b.map((x) => [x.date, x.close]));
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < a.length; i++) {
    const d = a[i]!.date;
    const p0a = a[i - 1]!.close;
    const p1a = a[i]!.close;
    const p1b = mapB.get(d);
    const p0b = mapB.get(a[i - 1]!.date);
    if (!p1b || !p0b || p0a <= 0 || p0b <= 0 || p1a <= 0 || p1b <= 0)
      continue;
    ra.push(p1a / p0a - 1);
    rb.push(p1b / p0b - 1);
  }
  return ra.length >= 60 ? { ra, rb } : null;
}

function selectRepresentatives(
  items: Metrics[],
  barsByCode: Map<string, OhlcBar[]>,
  minPick = 3,
  maxPick = 5,
  corrThreshold = 0.88,
): PickResult<Metrics> {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const picked: Metrics[] = [];
  const skippedHighlyCorrelated: PickResult<Metrics>["skippedHighlyCorrelated"] =
    [];
  for (const m of sorted) {
    if (picked.length >= maxPick) break;
    const barsA = barsByCode.get(m.code);
    if (!barsA) continue;
    let tooCorr = false;
    for (const p of picked) {
      const barsB = barsByCode.get(p.code);
      if (!barsB) continue;
      const al = alignedReturns(barsA, barsB);
      if (!al) continue;
      const c = pearson(al.ra, al.rb);
      if (c != null && c >= corrThreshold) {
        tooCorr = true;
        skippedHighlyCorrelated.push({ candidate: m, kept: p, corr: c });
        break;
      }
    }
    if (!tooCorr) picked.push(m);
  }
  while (picked.length < minPick && picked.length < sorted.length) {
    const next = sorted.find((s) => !picked.includes(s));
    if (!next) break;
    picked.push(next);
  }
  return { picked, skippedHighlyCorrelated };
}

function rowsFromCsv(name: string): Record<string, string>[] {
  const table = parseCsv(readData(name));
  if (table.length < 2) return [];
  return rowsToObjects(table[0]!, table.slice(1));
}

function loadDividendIndexMetrics(
  products: ReturnType<typeof parseEtfProductsCsv>,
): { metrics: Metrics[]; barsByCode: Map<string, OhlcBar[]> } {
  const dividendProducts = products.filter((p) =>
    ["shareholder_return_cn", "shareholder_return_hk", "otc_fund"].includes(
      p.product_group,
    ),
  );
  const primaryByIndex = new Map(
    dividendProducts
      .filter((p) => p.is_primary)
      .map((p) => [p.index_code, p]),
  );
  const dividendIndexCodes = new Set(dividendProducts.map((p) => p.index_code));
  const indexMeta = new Map(rowsFromCsv("indices.csv").map((r) => [r.index_code, r]));
  const byIndex = new Map<string, OhlcBar[]>();
  for (const row of rowsFromCsv("index_bars.csv")) {
    const code = (row.index_code ?? "").trim();
    if (!dividendIndexCodes.has(code)) continue;
    const close = Number(row.tri_close || row.price_close);
    if (!code || !row.date || !Number.isFinite(close) || close <= 0) continue;
    const bar: OhlcBar = {
      date: row.date,
      open: close,
      high: close,
      low: close,
      close,
    };
    const list = byIndex.get(code) ?? [];
    list.push(bar);
    byIndex.set(code, list);
  }
  const out: Metrics[] = [];
  for (const [code, bars] of byIndex) {
    bars.sort((a, b) => a.date.localeCompare(b.date));
    const meta = indexMeta.get(code);
    const primary = primaryByIndex.get(code);
    const m = metricsFromSeries(code, meta?.name || primary?.index_name || code, bars);
    if (!m) continue;
    m.indexCode = code;
    m.category = meta?.category || primary?.product_group;
    m.primaryEtfCode = primary?.code;
    m.primaryEtfName = primary?.name;
    out.push(m);
  }
  return { metrics: out, barsByCode: byIndex };
}

function longTermPreferred(items: Metrics[], minCount = 3): Metrics[] {
  const y5 = items.filter((x) => x.barCount >= 252 * 5 * 0.8);
  if (y5.length >= minCount) return y5;
  const y3 = items.filter((x) => x.barCount >= 252 * 3 * 0.8);
  if (y3.length >= minCount) return y3;
  return items;
}

function qualityPreferred(items: Metrics[], minCount = 3): Metrics[] {
  const filtered = items.filter((x) => x.score >= -10);
  return filtered.length >= minCount ? filtered : items;
}

function formatMetricRow(p: Metrics, extra = ""): string {
  return `| ${p.code} | ${p.name} | ${p.start}–${p.end} | ${p.annReturnPct.toFixed(1)} | ${p.maxDdPct.toFixed(1)} | ${p.volPct.toFixed(1)} | ${p.score.toFixed(2)} | ${extra} |`;
}

function parseEtfParamsRows(): {
  etf_code: string;
  strategy_id: string;
  param_version: string;
  note: string;
  row: Record<string, string>;
}[] {
  const text = readData("etf_params.csv");
  const lines = text.trim().split("\n");
  const headers = lines[0]!.split(",");
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return {
      etf_code: row.etf_code ?? "",
      strategy_id: row.strategy_id ?? "",
      param_version: row.param_version ?? "",
      note: row.note ?? "",
      row,
    };
  });
}

function rowToParams(row: Record<string, string>): EtfParams {
  const p: EtfParams = {
    etf_code: row.etf_code,
    strategy_id: row.strategy_id,
    param_version: row.param_version,
    report_date: row.report_date,
    backtest_start: row.backtest_start,
    backtest_end: row.backtest_end,
    data_source: row.data_source,
    price_type: row.price_type,
    cost_rate: Number(row.cost_rate) || 0.001,
  };
  if (row.rsi_window) {
    p.rsi_window = Number(row.rsi_window);
    p.rsi_oversold = Number(row.rsi_oversold);
    p.rsi_overbought = Number(row.rsi_overbought);
  }
  if (row.boll_window) {
    p.boll_window = Number(row.boll_window);
    p.boll_std = Number(row.boll_std);
  }
  return p;
}

function evalRegistered(
  definitions: EtfDefinition[],
): {
  row: (typeof parseEtfParamsRows)[0] extends () => infer R
    ? R extends (infer U)[]
      ? U
      : never
    : never;
  scored: ScoredParamRow;
}[] {
  const byCode = new Map(definitions.map((d) => [d.meta.code, d]));
  const out: { row: ReturnType<typeof parseEtfParamsRows>[0]; scored: ScoredParamRow }[] =
    [];
  for (const pr of parseEtfParamsRows()) {
    const etf = byCode.get(pr.etf_code);
    if (!etf?.bars?.length) continue;
    const params = rowToParams(pr.row);
    const cadence = /周|1w|weekly/i.test(pr.note) ? "1w" : "1d";
    const kind = pr.strategy_id.includes("rsi") ? "rsi" : "boll";
    const draft = buildCustomBaselineDraft(kind, {
      rsiMode: cadence === "1w" ? "1w" : "1d",
      rsiPeriod: params.rsi_window ?? 14,
      rsiOversold: params.rsi_oversold ?? 30,
      rsiOverbought: params.rsi_overbought ?? 70,
      bollMode: cadence === "1w" ? "1w" : "1d",
      bollPeriod: params.boll_window ?? 20,
      bollStd: params.boll_std ?? 2,
      maFast: 5,
      maSlow: 20,
    });
    const scored = scoreCustomParamBaseline(
      etf.bars,
      draft.params,
      draft.strategyId,
      pr.param_version,
      { trainRatio: 0.7 },
      kind,
      cadence === "1w" ? "1w" : "1d",
    );
    if (scored) out.push({ row: pr, scored });
  }
  return out;
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const { definitions } = loadBundle();
  const products = parseEtfProductsCsv(readData("etf_products.csv"));
  const dividendProducts = products.filter((p) =>
    ["shareholder_return_cn", "shareholder_return_hk", "otc_fund"].includes(
      p.product_group,
    ),
  );
  const defByCode = new Map(definitions.map((d) => [d.meta.code, d]));

  const barsByCode = new Map<string, OhlcBar[]>();
  for (const d of definitions) {
    if (d.bars?.length) barsByCode.set(d.meta.code, d.bars);
  }

  const byIndex = new Map<string, Metrics[]>();
  for (const p of dividendProducts) {
    const etf = defByCode.get(p.code);
    if (!etf?.bars?.length) continue;
    const m = metricsFromBars(etf);
    if (!m) continue;
    m.indexCode = p.index_code;
    m.isPrimary = p.is_primary;
    const list = byIndex.get(p.index_code) ?? [];
    list.push(m);
    byIndex.set(p.index_code, list);
  }

  const { metrics: indexMetrics, barsByCode: indexBarsByCode } =
    loadDividendIndexMetrics(products);
  const indexUniverse = qualityPreferred(longTermPreferred(indexMetrics, 3), 3);
  const indexPickResult = selectRepresentatives(
    indexUniverse,
    indexBarsByCode,
    3,
    5,
    0.9,
  );
  const representativeIndexCodes = new Set(
    indexPickResult.picked.map((p) => p.code),
  );
  const indexRepresentativeProducts = indexPickResult.picked
    .map((p) => p.primaryEtfCode)
    .filter((x): x is string => Boolean(x));
  const indexPicks = new Map<string, Metrics[]>();
  const lines: string[] = [
    "# 红利代表池（指数 3–5 + 主 ETF 3–5）",
    "",
    `生成：${new Date().toISOString()}`,
    "",
    "口径：优先使用近 5 年；样本不足则用全样本。综合分 = 年化收益×45% - 最大回撤×35% - 年波动×20%。相关性阈值：指数 0.90、ETF 0.88；高相关只保留综合分更高者。",
    "",
    "## 代表指数池",
    "",
    "| 指数 | 名称 | 区间 | 年化% | 回撤% | 波动% | 综合分 | 主产品 |",
    "|------|------|------|-------|-------|-------|--------|--------|",
    ...indexPickResult.picked.map((p) =>
      formatMetricRow(
        p,
        p.primaryEtfCode ? `${p.primaryEtfCode} ${p.primaryEtfName ?? ""}` : "—",
      ),
    ),
    "",
    "### 因高相关暂不重复纳入的指数",
    "",
    indexPickResult.skippedHighlyCorrelated.length
      ? "| 候选 | 保留 | 相关系数 |\n|------|------|----------|\n" +
        indexPickResult.skippedHighlyCorrelated
          .slice(0, 8)
          .map(
            (r) =>
              `| ${r.candidate.code} ${r.candidate.name} | ${r.kept.code} ${r.kept.name} | ${r.corr.toFixed(2)} |`,
          )
          .join("\n")
      : "无。",
    "",
  ];

  for (const [idx, items] of [...byIndex.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const picked = selectRepresentatives(items, barsByCode).picked;
    indexPicks.set(idx, picked);
    lines.push(`## ${idx} 产品候选（组内展示）`);
    lines.push("");
    lines.push(
      "| 代码 | 主监控 | 年化% | 回撤% | 波动% | 综合分 |",
      "|------|--------|-------|-------|-------|--------|",
    );
    for (const p of picked) {
      lines.push(
        `| ${p.code} | ${p.isPrimary ? "是" : ""} | ${p.annReturnPct.toFixed(1)} | ${p.maxDdPct.toFixed(1)} | ${p.volPct.toFixed(1)} | ${p.score.toFixed(2)} |`,
      );
    }
    lines.push("");
  }

  const primaryCodes = new Set(
    dividendProducts.filter((p) => p.is_primary).map((p) => p.code),
  );
  lines.push("## 主 ETF 代表（已注册策略的 14 只）", "");
  const primaryMetrics: Metrics[] = [];
  for (const p of dividendProducts) {
    if (!primaryCodes.has(p.code)) continue;
    const etf = defByCode.get(p.code);
    if (!etf) continue;
    const m = metricsFromBars(etf);
    if (!m) continue;
    m.indexCode = p.index_code;
    m.isPrimary = true;
    primaryMetrics.push(m);
  }
  const primaryUniverse = qualityPreferred(longTermPreferred(primaryMetrics, 3), 3);
  const primaryPickResult = selectRepresentatives(
    primaryUniverse,
    barsByCode,
    3,
    Math.min(5, primaryUniverse.length),
  );
  const primaryPicked = primaryPickResult.picked;
  lines.push(
    "| ETF | 名称 | 区间 | 年化% | 回撤% | 波动% | 综合分 | 跟踪指数 |",
    "|-----|------|------|-------|-------|-------|--------|----------|",
    ...primaryPicked.map((p) => formatMetricRow(p, p.indexCode)),
    "",
    "### 因高相关暂不重复纳入的主 ETF",
    "",
    primaryPickResult.skippedHighlyCorrelated.length
      ? "| 候选 | 保留 | 相关系数 |\n|------|------|----------|\n" +
        primaryPickResult.skippedHighlyCorrelated
          .slice(0, 8)
          .map(
            (r) =>
              `| ${r.candidate.code} ${r.candidate.name} | ${r.kept.code} ${r.kept.name} | ${r.corr.toFixed(2)} |`,
          )
          .join("\n")
      : "无。",
  );
  lines.push("");

  writeFileSync(join(OUT, "representatives_by_index.md"), lines.join("\n"));

  const repCodes = new Set<string>([
    ...indexRepresentativeProducts,
    ...primaryPicked.map((p) => p.code),
  ]);

  const registered = evalRegistered(definitions);
  const defByRegisteredCode = new Map(definitions.map((d) => [d.meta.code, d]));
  const SIG_EXCESS = 8;
  const SWING_MIN_ROUNDS_PER_YEAR = 2;
  const SWING_MIN_WIN_RATE = 0.6;

  const strong = registered.filter(
    (r) =>
      (r.scored.excessTrainPct ?? -999) >= SIG_EXCESS &&
      (r.scored.excessValPct ?? -999) >= SIG_EXCESS,
  );
  const swing = registered.filter(
    (r) => {
      const bars = defByRegisteredCode.get(r.row.etf_code)?.bars ?? [];
      const years = bars.length > 1 ? (bars.length - 1) / 252 : 0;
      const roundsPerYear = years > 0 ? r.scored.roundCount / years : 0;
      return (
        roundsPerYear >= SWING_MIN_ROUNDS_PER_YEAR &&
        (r.scored.winRate ?? 0) >= SWING_MIN_WIN_RATE &&
        r.scored.excessReturnPct > 0
      );
    },
  );

  const regLines = [
    "# 已注册策略评估（v20260526）",
    "",
    `训练/验证「显著超额」阈值：相对买入持有超额 ≥ ${SIG_EXCESS}%（各段）`,
    `波段参考：平均每年买卖轮次 ≥ ${SWING_MIN_ROUNDS_PER_YEAR}，胜率≥${(SWING_MIN_WIN_RATE * 100).toFixed(0)}%，全样本超额>0`,
    "",
    "## 训练+验证均显著超额",
    "",
    "| ETF | 策略 | 全样本超额% | 训练% | 验证% | 轮次 | 胜率% |",
    "|-----|------|------------|-------|-------|------|-------|",
    ...strong.map(
      (r) =>
        `| ${r.row.etf_code} | ${r.row.strategy_id.replace("_mean_reversion", "")} | ${r.scored.excessReturnPct.toFixed(1)} | ${r.scored.excessTrainPct?.toFixed(1) ?? "—"} | ${r.scored.excessValPct?.toFixed(1) ?? "—"} | ${r.scored.roundCount} | ${(r.scored.winRate * 100).toFixed(0)} |`,
    ),
    "",
    "## 适合波段观察",
    "",
    "| ETF | 策略 | 年均轮次 | 胜率% | 全样本超额% | 平均持仓日 |",
    "|-----|------|----------|-------|------------|------------|",
    ...swing.map(
      (r) => {
        const bars = defByRegisteredCode.get(r.row.etf_code)?.bars ?? [];
        const years = bars.length > 1 ? (bars.length - 1) / 252 : 0;
        const roundsPerYear = years > 0 ? r.scored.roundCount / years : 0;
        return `| ${r.row.etf_code} | ${r.row.strategy_id.replace("_mean_reversion", "")} | ${roundsPerYear.toFixed(1)} | ${(r.scored.winRate * 100).toFixed(0)} | ${r.scored.excessReturnPct.toFixed(1)} | ${r.scored.avgHoldDays.toFixed(1)} |`;
      },
    ),
    "",
    "## 全量",
    "",
    "| ETF | 策略 | 全样本超额% | 训练% | 验证% | 回撤% | 轮次 |",
    "|-----|------|------------|-------|-------|-------|------|",
    ...registered.map(
      (r) =>
        `| ${r.row.etf_code} | ${r.row.strategy_id.replace("_mean_reversion", "")} | ${r.scored.excessReturnPct.toFixed(1)} | ${r.scored.excessTrainPct?.toFixed(1) ?? "—"} | ${r.scored.excessValPct?.toFixed(1) ?? "—"} | ${r.scored.maxDrawdownPct.toFixed(1)} | ${r.scored.roundCount} |`,
    ),
  ];
  writeFileSync(join(OUT, "registered_params_eval.md"), regLines.join("\n"));

  const fundText = readData("fund_bars.csv");
  const fundMap = parseFundBarsCsv(fundText);
  const f007 = fundMap.get("007751");
  let navNote = "";
  let fund007751NavCompare: Record<string, unknown> | undefined;
  if (f007?.length) {
    const sample = f007[0]!;
    const last = f007[f007.length - 1]!;
    navNote = `007751: ${f007.length} 日; 首 ${sample.date} close=${sample.close} (loader 用 nav_forward_adjusted 优先); 末 ${last.date}`;

    function parseFundBarsNavUnitOnly(text: string): Map<string, OhlcBar[]> {
      const rows = text.trim().split("\n");
      if (rows.length < 2) return new Map();
      const headers = rows[0]!.split(",");
      const map = new Map<string, OhlcBar[]>();
      for (const line of rows.slice(1)) {
        const cols = line.split(",");
        const row: Record<string, string> = {};
        headers.forEach((h, i) => {
          row[h] = cols[i] ?? "";
        });
        const code = (row.fund_code ?? "").trim();
        const date = row.date?.trim();
        const nav = row.nav_unit?.trim();
        if (!code || !date || !nav) continue;
        const c = Number(nav);
        const bar: OhlcBar = { date, open: c, high: c, low: c, close: c };
        if (!map.has(code)) map.set(code, []);
        map.get(code)!.push(bar);
      }
      for (const bars of map.values()) {
        bars.sort((a, b) => a.date.localeCompare(b.date));
      }
      return map;
    }

    const unitOnly = parseFundBarsNavUnitOnly(fundText).get("007751");
    const rsiRow = parseEtfParamsRows().find(
      (r) => r.etf_code === "007751" && r.strategy_id.includes("rsi"),
    );
    if (unitOnly?.length && rsiRow) {
      const params = rowToParams(rsiRow.row);
      const draft = buildCustomBaselineDraft("rsi", {
        rsiMode: "1d",
        rsiPeriod: params.rsi_window ?? 21,
        rsiOversold: params.rsi_oversold ?? 35,
        rsiOverbought: params.rsi_overbought ?? 70,
        bollMode: "1d",
        bollPeriod: 20,
        bollStd: 2,
        maFast: 5,
        maSlow: 20,
      });
      const fwd = scoreCustomParamBaseline(
        f007,
        draft.params,
        draft.strategyId,
        rsiRow.param_version,
        { trainRatio: 0.7 },
        "rsi",
        "1d",
      );
      const raw = scoreCustomParamBaseline(
        unitOnly,
        draft.params,
        draft.strategyId,
        rsiRow.param_version,
        { trainRatio: 0.7 },
        "rsi",
        "1d",
      );
      fund007751NavCompare = {
        registeredRsi: rsiRow.param_version,
        forwardAdjusted: fwd
          ? {
              excessReturnPct: fwd.excessReturnPct,
              excessTrainPct: fwd.excessTrainPct,
              excessValPct: fwd.excessValPct,
              roundCount: fwd.roundCount,
            }
          : null,
        navUnitOnly: raw
          ? {
              excessReturnPct: raw.excessReturnPct,
              excessTrainPct: raw.excessTrainPct,
              excessValPct: raw.excessValPct,
              roundCount: raw.roundCount,
            }
          : null,
        note: "生产 loader 优先 nav_forward_adjusted；nav_unit 仅作口径对照",
      };
    }
  }

  const json = {
    generatedAt: new Date().toISOString(),
    representativeCodes: [...repCodes].sort(),
    representativeIndexCodes: [...representativeIndexCodes].sort(),
    indexRepresentatives: indexPickResult.picked.map((p) => ({
      index: p.code,
      name: p.name,
      primaryEtf: p.primaryEtfCode,
      annReturnPct: p.annReturnPct,
      maxDrawdownPct: p.maxDdPct,
      volatilityPct: p.volPct,
    })),
    byIndex: Object.fromEntries(
      indexPickResult.picked.map((p) => [
        p.code,
        p.primaryEtfCode ? [p.primaryEtfCode] : [],
      ]),
    ),
    primaryRepresentativeCodes: primaryPicked.map((p) => p.code),
    strongDualExcess: strong.map((r) => ({
      etf: r.row.etf_code,
      strategy: r.row.strategy_id,
      version: r.row.param_version,
      excessReturn: r.scored.excessReturnPct,
      excessTrain: r.scored.excessTrainPct,
      excessVal: r.scored.excessValPct,
      roundCount: r.scored.roundCount,
      winRate: r.scored.winRate,
      avgHoldDays: r.scored.avgHoldDays,
    })),
    swingCandidates: swing.map((r) => ({
      etf: r.row.etf_code,
      strategy: r.row.strategy_id,
      rounds: r.scored.roundCount,
      roundsPerYear:
        (defByRegisteredCode.get(r.row.etf_code)?.bars.length ?? 0) > 1
          ? r.scored.roundCount /
            (((defByRegisteredCode.get(r.row.etf_code)?.bars.length ?? 1) - 1) /
              252)
          : 0,
      winRate: r.scored.winRate,
      excessReturn: r.scored.excessReturnPct,
      avgHoldDays: r.scored.avgHoldDays,
    })),
    fund007751: navNote,
    fund007751NavCompare,
  };
  const publicJson = join(DATA, "dividend_representative_pool.json");
  writeFileSync(publicJson, JSON.stringify(json, null, 2));
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(json, null, 2));

  console.log("代表产品代码:", [...repCodes].sort().join(", "));
  console.log("双段显著超额:", strong.length, "条");
  console.log("波段候选:", swing.length, "条");
  console.log(navNote);
  if (fund007751NavCompare) {
    console.log("007751 RSI 口径对照:", JSON.stringify(fund007751NavCompare, null, 2));
  }
  console.log(`\n输出目录: ${OUT}`);
}

main();
