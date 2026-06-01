/**
 * 导出精选跟踪主跟踪 ETF：历史行情 + RSI/布林带策略回测与成交。
 *
 *   npx tsx scripts/export_featured_tracking.mts
 *
 * 输出：
 *   exports/featured_tracking_bars.csv
 *   exports/featured_tracking_strategies.csv
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { buildCsvBundle } from "../src/data/csvLoader";
import {
  attachNavToRounds,
  buildRoundTrips,
  computeBacktestSummary,
} from "../src/lib/backtestSummary";
import { buildTrades } from "../src/lib/backtest";
import { FEATURED_FOCUS_ITEMS } from "../src/lib/featuredTrackingFocus";
import { parseEtfProductRecordsCsv } from "../src/lib/etfProducts";
import { etfProductStrategyEligible } from "../src/lib/etfListingAge";
import { csvParamVariants } from "../src/lib/paramVariants";
import { strategyPercentileContext } from "../src/lib/indicatorPercentile";
import {
  computeSignals,
  usesBollStrategy,
  usesRsiStrategy,
} from "../src/lib/strategy";
import { strategyKindLabel } from "../src/lib/strategyLabels";
import type { EtfDefinition, EtfProductRecord, OhlcBar } from "../src/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");
const DATA = join(REPO, "public/data");
const OUT_DIR = join(REPO, "exports");

const FOCUS_INDEX_CODES = FEATURED_FOCUS_ITEMS.map((i) => i.indexCode);

function readData(name: string): string {
  return readFileSync(join(DATA, name), "utf8");
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
    hasMerge ? merge : undefined,
  );
}

function csvCell(v: string | number | boolean | null | undefined): string {
  if (v == null || v === "") return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(cols: (string | number | boolean | null | undefined)[]): string {
  return cols.map(csvCell).join(",");
}

type FocusPair = {
  indexCode: string;
  product: EtfProductRecord;
  etf: EtfDefinition | undefined;
};

function resolveFocusPairs(
  products: EtfProductRecord[],
  getEtf: (code: string) => EtfDefinition | undefined,
): FocusPair[] {
  const out: FocusPair[] = [];
  for (const indexCode of FOCUS_INDEX_CODES) {
    const product = products.find(
      (p) => p.indexCode === indexCode && p.isPrimary,
    );
    if (!product) {
      console.warn(`[warn] 未找到主跟踪 ETF：index=${indexCode}`);
      continue;
    }
    out.push({
      indexCode,
      product,
      etf: getEtf(product.code),
    });
  }
  return out;
}

function exportBars(pairs: FocusPair[]): string[] {
  const header = csvRow([
    "etf_code",
    "etf_name",
    "index_code",
    "index_name",
    "date",
    "open",
    "high",
    "low",
    "close",
  ]);
  const rows: string[] = [header];
  for (const { indexCode, product, etf } of pairs) {
    const bars = etf?.bars ?? [];
    for (const b of bars) {
      rows.push(
        csvRow([
          product.code,
          product.name,
          indexCode,
          product.indexName,
          b.date,
          b.open,
          b.high,
          b.low,
          b.close,
        ]),
      );
    }
  }
  return rows;
}

function latestSignalInfo(
  bars: OhlcBar[],
  strategyId: string,
  params: EtfDefinition["params"],
) {
  const signals = computeSignals(bars, params, strategyId);
  const lastIdx = bars.length - 1;
  const lastBar = bars[lastIdx];
  const ctx = strategyPercentileContext(bars, params, strategyId, bars);
  return {
    latestDate: lastBar?.date ?? "",
    latestClose: lastBar?.close ?? "",
    latestSignal: signals[lastIdx] ?? "HOLD",
    metricName: ctx?.metricName ?? "",
    metricValue: ctx?.metricValue ?? "",
    signalPercentile: ctx?.percentile ?? "",
  };
}

function exportStrategies(pairs: FocusPair[]): string[] {
  const header = csvRow([
    "record_type",
    "etf_code",
    "etf_name",
    "index_code",
    "index_name",
    "strategy_id",
    "strategy_kind",
    "param_version",
    "param_note",
    "strategy_eligible",
    "ineligible_reason",
    "bar_start",
    "bar_end",
    "bar_count",
    "strategy_return_pct",
    "buy_hold_return_pct",
    "excess_return_pct",
    "max_drawdown_pct",
    "annual_vol_pct",
    "win_rate",
    "round_count",
    "avg_hold_days",
    "avg_flat_days",
    "position",
    "latest_date",
    "latest_close",
    "latest_signal",
    "latest_metric_name",
    "latest_metric_value",
    "signal_percentile",
    "trade_date",
    "trade_side",
    "trade_price",
    "trade_reason",
    "trade_pnl_pct",
    "trade_hold_days",
    "round_no",
  ]);
  const rows: string[] = [header];

  for (const { indexCode, product, etf } of pairs) {
    if (!etf) {
      rows.push(
        csvRow([
          "summary",
          product.code,
          product.name,
          indexCode,
          product.indexName,
          "",
          "",
          "",
          "",
          false,
          "无本地行情定义",
          "",
          "",
          0,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ]),
      );
      continue;
    }

    const bars = etf.bars;
    const barStart = bars[0]?.date ?? "";
    const barEnd = bars[bars.length - 1]?.date ?? "";
    const eligible = etfProductStrategyEligible(etf, product);
    const ineligibleReason = !eligible
      ? product.productGroup === "cash_creation" || etf.meta.product_kind === "现金流类"
        ? "现金流类产品暂不提供策略参数"
        : bars.length < 80
          ? "行情不足80根"
          : "成立未满2年或不可回测"
      : "";

    const variants = csvParamVariants(etf).filter(
      (v) =>
        usesRsiStrategy(v.strategyId) || usesBollStrategy(v.strategyId),
    );

    if (!variants.length) {
      rows.push(
        csvRow([
          "summary",
          product.code,
          product.name,
          indexCode,
          product.indexName,
          "",
          "",
          "",
          "",
          eligible,
          ineligibleReason || "etf_params 未登记 RSI/布林带",
          barStart,
          barEnd,
          bars.length,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          barEnd,
          bars[bars.length - 1]?.close ?? "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ]),
      );
      continue;
    }

    for (const variant of variants) {
      if (!eligible || bars.length < 80) {
        rows.push(
          csvRow([
            "summary",
            product.code,
            product.name,
            indexCode,
            product.indexName,
            variant.strategyId,
            strategyKindLabel(variant.strategyId),
            variant.paramVersion,
            variant.label,
            false,
            ineligibleReason,
            barStart,
            barEnd,
            bars.length,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            barEnd,
            bars[bars.length - 1]?.close ?? "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
          ]),
        );
        continue;
      }

      const signals = computeSignals(
        bars,
        variant.params,
        variant.strategyId,
      );
      const trades = buildTrades(
        bars,
        signals,
        variant.paramVersion,
        variant.strategyId,
        variant.params,
      );
      const rounds = attachNavToRounds(buildRoundTrips(trades));
      const summary = computeBacktestSummary(bars, trades, rounds);
      const latest = latestSignalInfo(bars, variant.strategyId, variant.params);

      rows.push(
        csvRow([
          "summary",
          product.code,
          product.name,
          indexCode,
          product.indexName,
          variant.strategyId,
          strategyKindLabel(variant.strategyId),
          variant.paramVersion,
          variant.label,
          true,
          "",
          barStart,
          barEnd,
          bars.length,
          summary.strategyReturnPct,
          summary.buyHoldReturnPct,
          summary.excessReturnPct,
          summary.maxDrawdownPct,
          summary.annualVolPct,
          summary.winRate,
          summary.roundCount,
          summary.avgHoldDays,
          summary.avgFlatDays,
          summary.position,
          latest.latestDate,
          latest.latestClose,
          latest.latestSignal,
          latest.metricName,
          latest.metricValue,
          latest.signalPercentile,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ]),
      );

      for (const t of trades) {
        rows.push(
          csvRow([
            "trade",
            product.code,
            product.name,
            indexCode,
            product.indexName,
            variant.strategyId,
            strategyKindLabel(variant.strategyId),
            variant.paramVersion,
            variant.label,
            true,
            "",
            barStart,
            barEnd,
            bars.length,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            t.date,
            t.side,
            t.price,
            t.reason,
            t.pnlPct ?? "",
            t.holdDays ?? "",
            "",
          ]),
        );
      }

      for (const r of rounds) {
        rows.push(
          csvRow([
            "round",
            product.code,
            product.name,
            indexCode,
            product.indexName,
            variant.strategyId,
            strategyKindLabel(variant.strategyId),
            variant.paramVersion,
            variant.label,
            true,
            "",
            barStart,
            barEnd,
            bars.length,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            r.buyDate,
            "BUY",
            r.buyPrice,
            r.buyTrigger,
            "",
            "",
            r.round,
          ]),
        );
        rows.push(
          csvRow([
            "round",
            product.code,
            product.name,
            indexCode,
            product.indexName,
            variant.strategyId,
            strategyKindLabel(variant.strategyId),
            variant.paramVersion,
            variant.label,
            true,
            "",
            barStart,
            barEnd,
            bars.length,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            r.sellDate,
            "SELL",
            r.sellPrice,
            r.sellTrigger,
            r.pnlPct,
            r.holdDays,
            r.round,
          ]),
        );
      }
    }
  }

  return rows;
}

function main() {
  const { definitions } = loadBundle();
  const products = parseEtfProductRecordsCsv(readData("etf_products.csv"));
  const getEtf = (code: string) =>
    definitions.find((e) => e.meta.code === code);

  const pairs = resolveFocusPairs(products, getEtf);
  mkdirSync(OUT_DIR, { recursive: true });

  const barsPath = join(OUT_DIR, "featured_tracking_bars.csv");
  const stratPath = join(OUT_DIR, "featured_tracking_strategies.csv");
  const barRows = exportBars(pairs);
  const stratRows = exportStrategies(pairs);

  writeFileSync(barsPath, `${barRows.join("\n")}\n`, "utf8");
  writeFileSync(stratPath, `${stratRows.join("\n")}\n`, "utf8");

  const barCountByEtf = pairs.map((p) => ({
    code: p.product.code,
    bars: p.etf?.bars.length ?? 0,
  }));
  console.log(`已写入 ${barsPath}（${barRows.length - 1} 行行情）`);
  console.log(`已写入 ${stratPath}（${stratRows.length - 1} 行策略/成交）`);
  console.log("各 ETF 行情根数：");
  for (const { code, bars } of barCountByEtf) {
    console.log(`  ${code}: ${bars}`);
  }
}

main();
