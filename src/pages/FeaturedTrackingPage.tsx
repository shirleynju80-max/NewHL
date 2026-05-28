import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { useDataSource } from "../context/DataSourceContext";
import { useStrategyRegistry } from "../context/StrategyRegistryContext";
import { buildTrades } from "../lib/backtest";
import {
  attachNavToRounds,
  buildRoundTrips,
  computeBacktestSummary,
  formatAvgHoldFlatPairDisplay,
  type BacktestSummary,
} from "../lib/backtestSummary";
import type { EtfProductRecord } from "../lib/etfProducts";
import { formatPct, formatSignedPct } from "../lib/formatDisplay";
import { etfProductStrategyEligible } from "../lib/etfListingAge";
import { strategyPercentileContext } from "../lib/indicatorPercentile";
import {
  fetchLiveQuote,
  formatQuoteSourceLabel,
  type LiveQuote,
} from "../lib/liveQuote";
import { getProductParamVariants } from "../lib/paramVariants";
import { computeSignals, mergeIntraday1345, usesBollStrategy } from "../lib/strategy";
import { strategyKindLabel, variantMonitorCompact } from "../lib/strategyLabels";
import {
  metricOhlcForIndexRow,
  SP_INDEX_ETF_PROXY_FOOTNOTE,
} from "../lib/indexEtfProxy";
import type {
  EtfDefinition,
  IndexDefinition,
  OhlcBar,
  ParamStrategyVariant,
} from "../types";

type FocusItem = {
  dimension: "cash" | "dividend";
  indexCode: string;
  reason: string;
};

const FOCUS_ITEMS: FocusItem[] = [
  {
    dimension: "cash",
    indexCode: "980092",
    reason: "现金创造代表，适合作为长期定投观察与质量底仓候选。",
  },
  {
    dimension: "dividend",
    indexCode: "HSSCSOY.HI",
    reason: "港股通中国央企红利代表，补充港股央企现金回报敞口。",
  },
  {
    dimension: "dividend",
    indexCode: "HSI114",
    reason: "恒生港股通高股息低波动代表，偏防御与现金回报。",
  },
  {
    dimension: "dividend",
    indexCode: "930955",
    reason: "A 股红利低波 100 代表，替代高度相关的中证红利/上证红利观察位。",
  },
  {
    dimension: "dividend",
    indexCode: "SPCLLHCP.SPI",
    reason: "标普中国 A 股大盘红利低波 50，保留不同编制商与大盘风格口径。",
  },
  {
    dimension: "dividend",
    indexCode: "931157",
    reason: "沪港深红利成长低波动，兼顾红利释放与成长质量。",
  },
];

const WINDOWS = [
  { id: "y1", label: "近1年", years: 1 },
  { id: "y3", label: "近3年", years: 3 },
  { id: "y5", label: "近5年", years: 5 },
  { id: "y10", label: "近10年", years: 10 },
] as const;

type WindowId = (typeof WINDOWS)[number]["id"];

type MatrixSortKey =
  | "indexCode"
  | "dimension"
  | `${WindowId}_ret`
  | `${WindowId}_dd`
  | `${WindowId}_vol`;

type WindowMetric = {
  annualReturnPct: number | null;
  maxDrawdownPct: number | null;
  annualVolPct: number | null;
  start: string;
  end: string;
};

type StrategyRow = {
  etf: EtfDefinition;
  product: EtfProductRecord;
  variant: ParamStrategyVariant;
  summary: BacktestSummary;
  strategyAnnualPct: number | null;
  latestPrice: number;
  prevClose: number;
  quoteSource: LiveQuote["source"] | null;
  signalPct: number | null;
  zoneLabel: string;
  metricLine: string;
  isBollinger: boolean;
  currentState: string;
};

function metricToSortValue(v: number | null | undefined): number {
  return v == null || Number.isNaN(v) ? Number.NaN : v;
}

function compareSortValues(a: number, b: number, dir: "asc" | "desc"): number {
  const aMissing = Number.isNaN(a);
  const bMissing = Number.isNaN(b);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return dir === "asc" ? a - b : b - a;
}

function dimensionLabel(dimension: FocusItem["dimension"]): string {
  return dimension === "cash" ? "现金创造" : "股东回报";
}

function metricForWindow(bars: OhlcBar[], years: number): WindowMetric {
  if (bars.length < 2) {
    return { annualReturnPct: null, maxDrawdownPct: null, annualVolPct: null, start: "—", end: "—" };
  }
  const end = bars[bars.length - 1]!.date;
  const cut = new Date(end);
  cut.setFullYear(cut.getFullYear() - years);
  const cutStr = cut.toISOString().slice(0, 10);
  const slice = bars.filter((b) => b.date >= cutStr);
  if (slice.length < 40) {
    return { annualReturnPct: null, maxDrawdownPct: null, annualVolPct: null, start: "—", end };
  }
  const first = slice[0]!;
  const last = slice[slice.length - 1]!;
  const nYears = (slice.length - 1) / 252;
  const annualReturnPct =
    nYears > 0 ? (Math.pow(last.close / first.close, 1 / nYears) - 1) * 100 : null;
  let peak = first.close;
  let maxDd = 0;
  for (const b of slice) {
    peak = Math.max(peak, b.close);
    if (peak > 0) maxDd = Math.max(maxDd, (peak - b.close) / peak);
  }
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const p = slice[i - 1]!.close;
    const c = slice[i]!.close;
    if (p > 0 && c > 0) rets.push(c / p - 1);
  }
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const variance =
    rets.length > 1
      ? rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1)
      : 0;
  return {
    annualReturnPct,
    maxDrawdownPct: maxDd * 100,
    annualVolPct: Math.sqrt(variance) * Math.sqrt(252) * 100,
    start: first.date,
    end: last.date,
  };
}

function zoneLabelFromPercentile(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return "—";
  if (p <= 20) return "临近买";
  if (p >= 80) return "临近卖";
  return "中性";
}

function zoneClass(label: string): string {
  if (label === "临近买") return "fin-zone-chip fin-zone-chip--buy";
  if (label === "临近卖") return "fin-zone-chip fin-zone-chip--sell";
  return "fin-zone-chip fin-zone-chip--neutral";
}

function strategyStyle(summary: BacktestSummary): string {
  if (summary.roundCount < 2 || summary.excessReturnPct <= 3) return "长期持有";
  if (summary.excessReturnPct >= 20 && summary.roundCount >= 3) return "择时高超额";
  if (summary.avgHoldDays > 0 && summary.avgHoldDays <= 30) return "短波段";
  return "长波段";
}

function strategyRowsForEtf(
  etf: EtfDefinition | undefined,
  product: EtfProductRecord | undefined,
  entries: ReturnType<typeof useStrategyRegistry>["entries"],
  quote: LiveQuote | undefined,
): StrategyRow[] {
  if (!etf || !product || etf.bars.length < 80) return [];
  if (!etfProductStrategyEligible(etf, product)) return [];
  const prevClose = etf.bars[etf.bars.length - 1]?.close ?? 0;
  const snap = quote?.price ?? prevClose;
  const merged = snap ? mergeIntraday1345(etf.bars, snap) : etf.bars;
  return getProductParamVariants(etf, product, entries)
    .map((variant) => {
      const signals = computeSignals(etf.bars, variant.params, variant.strategyId);
      const trades = buildTrades(
        etf.bars,
        signals,
        variant.paramVersion,
        variant.strategyId,
        variant.params,
      );
      const rounds = attachNavToRounds(buildRoundTrips(trades));
      const summary = computeBacktestSummary(etf.bars, trades, rounds);
      const nYears = (etf.bars.length - 1) / 252;
      const strategyAnnualPct =
        nYears > 0
          ? (Math.pow(1 + summary.strategyReturnPct / 100, 1 / nYears) - 1) * 100
          : null;
      const intradayCtx = strategyPercentileContext(
        etf.bars,
        variant.params,
        variant.strategyId,
        merged,
      );
      const intradaySignals = computeSignals(
        merged,
        variant.params,
        variant.strategyId,
      );
      const lastSig = intradaySignals[intradaySignals.length - 1] ?? "HOLD";
      const isBollinger = usesBollStrategy(variant.strategyId);
      return {
        etf,
        product,
        variant,
        summary,
        strategyAnnualPct,
        latestPrice: snap,
        prevClose,
        quoteSource: quote?.source ?? null,
        signalPct: intradayCtx?.percentile ?? null,
        zoneLabel: zoneLabelFromPercentile(intradayCtx?.percentile),
        metricLine:
          intradayCtx != null
            ? `${intradayCtx.metricName}=${intradayCtx.metricValue}`
            : "—",
        isBollinger,
        currentState:
          lastSig === "BUY"
            ? "买入触发"
            : lastSig === "SELL"
              ? "卖出触发"
              : intradayCtx?.zone === "buy_hint"
                ? "买入侧观察"
                : intradayCtx?.zone === "sell_hint"
                  ? "卖出侧观察"
                  : summary.position,
      };
    })
    .sort((a, b) => b.summary.excessReturnPct - a.summary.excessReturnPct);
}

type EtfStrategyGroup = {
  focusRow: FocusRow;
  strategies: StrategyRow[];
};

function buildStrategyGroups(
  rows: FocusRow[],
  entries: ReturnType<typeof useStrategyRegistry>["entries"],
  quotes: Record<string, LiveQuote>,
): EtfStrategyGroup[] {
  return rows
    .map((focusRow) => ({
      focusRow,
      strategies: strategyRowsForEtf(
        focusRow.etf,
        focusRow.product,
        entries,
        focusRow.product ? quotes[focusRow.product.code] : undefined,
      ),
    }))
    .filter((g) => g.strategies.length > 0);
}

type FocusRow = {
  item: FocusItem;
  index: IndexDefinition | undefined;
  product: EtfProductRecord | undefined;
  etf: EtfDefinition | undefined;
};

type IndexMatrixRow = {
  indexCode: string;
  indexName: string;
  productCode?: string;
  productName?: string;
  dimension: string;
  dimensionOrder: number;
  usesEtfProxy: boolean;
  proxyEtfCode?: string;
  metrics: Record<WindowId, WindowMetric>;
};

function buildIndexMatrixRows(focusRows: FocusRow[]): IndexMatrixRow[] {
  return focusRows.map((row) => {
    const source = metricOhlcForIndexRow(
      row.item.indexCode,
      row.index?.bars,
      row.etf,
    );
    const metrics = Object.fromEntries(
      WINDOWS.map((w) => [w.id, metricForWindow(source.bars, w.years)]),
    ) as Record<WindowId, WindowMetric>;
    return {
      indexCode: row.item.indexCode,
      indexName: row.index?.meta.name ?? row.item.indexCode,
      productCode: row.product?.code,
      productName: row.product?.name ?? row.etf?.meta.name,
      dimension: dimensionLabel(row.item.dimension),
      dimensionOrder: row.item.dimension === "cash" ? 0 : 1,
      usesEtfProxy: source.usesEtfProxy,
      proxyEtfCode: source.proxyEtfCode,
      metrics,
    };
  });
}

function FeaturedIndexMatrix({ focusRows }: { focusRows: FocusRow[] }) {
  const [sort, setSort] = useState<{ key: MatrixSortKey; dir: "asc" | "desc" }>({
    key: "y5_ret",
    dir: "desc",
  });

  const matrixRows = useMemo(
    () => buildIndexMatrixRows(focusRows),
    [focusRows],
  );

  const sortedRows = useMemo(() => {
    const list = [...matrixRows];
    list.sort((a, b) => {
      if (sort.key === "indexCode") {
        const cmp = a.indexCode.localeCompare(b.indexCode, "zh-CN");
        return sort.dir === "asc" ? cmp : -cmp;
      }
      if (sort.key === "dimension") {
        const cmp = a.dimensionOrder - b.dimensionOrder;
        return sort.dir === "asc" ? cmp : -cmp;
      }
      const match = sort.key.match(/^(y\d+)_(ret|dd|vol)$/);
      if (!match) return 0;
      const winId = match[1] as WindowId;
      const field = match[2];
      const ma = a.metrics[winId];
      const mb = b.metrics[winId];
      const va =
        field === "ret"
          ? metricToSortValue(ma.annualReturnPct)
          : field === "dd"
            ? metricToSortValue(ma.maxDrawdownPct)
            : metricToSortValue(ma.annualVolPct);
      const vb =
        field === "ret"
          ? metricToSortValue(mb.annualReturnPct)
          : field === "dd"
            ? metricToSortValue(mb.maxDrawdownPct)
            : metricToSortValue(mb.annualVolPct);
      return compareSortValues(va, vb, sort.dir);
    });
    return list;
  }, [matrixRows, sort]);

  function onSort(key: MatrixSortKey) {
    setSort((prev) => {
      if (prev.key === key)
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      const defaultDir =
        key === "indexCode" || key === "dimension" || key.endsWith("_dd") || key.endsWith("_vol")
          ? "asc"
          : "desc";
      return { key, dir: defaultDir };
    });
  }

  function sortMark(key: MatrixSortKey) {
    if (sort.key !== key) return "";
    return sort.dir === "asc" ? " ↑" : " ↓";
  }

  function sortableTh(
    key: MatrixSortKey,
    label: string,
    className = "px-3 py-2 font-normal",
  ) {
    return (
      <th className={className}>
        <button
          type="button"
          className="fin-interactive hover:text-[var(--fin-blue)]"
          onClick={() => onSort(key)}
        >
          {label}
          {sortMark(key)}
        </button>
      </th>
    );
  }

  return (
    <section className="fin-panel overflow-hidden">
      <header className="border-b border-fin-border px-5 py-4">
        <h2 className="text-base font-semibold text-[var(--fin-text)]">
          指数表现矩阵
        </h2>
        <p className="mt-1 text-xs fin-muted-text">
          优先使用指数全收益序列；标普指数无本地序列时以主跟踪 ETF 收盘价代理。空值代表该指数历史长度不足以计算对应窗口。点击表头排序。
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-[1080px] w-full text-xs">
          <thead>
            <tr className="fin-table-head">
              {sortableTh("indexCode", "指数 / 主 ETF", "px-4 py-2 text-left font-normal")}
              {sortableTh("dimension", "维度", "px-3 py-2 text-left font-normal")}
              {WINDOWS.map((w) => (
                <th
                  key={w.id}
                  colSpan={3}
                  className="border-l border-fin-border px-3 py-2 text-center font-normal"
                >
                  {w.label}
                </th>
              ))}
            </tr>
            <tr className="fin-table-head border-t border-fin-border">
              <th className="px-4 py-2" aria-hidden />
              <th className="px-3 py-2" aria-hidden />
              {WINDOWS.flatMap((w) => [
                sortableTh(
                  `${w.id}_ret`,
                  "年化",
                  "border-l border-fin-border px-3 py-2 text-right font-normal",
                ),
                sortableTh(`${w.id}_dd`, "回撤", "px-3 py-2 text-right font-normal"),
                sortableTh(`${w.id}_vol`, "波动", "px-3 py-2 text-right font-normal"),
              ])}
            </tr>
          </thead>
          <tbody className="divide-y divide-fin-border">
            {sortedRows.map((row) => (
              <tr key={row.indexCode} className="fin-row-hover">
                <td className="px-4 py-3 align-top">
                  <Link
                    to={`/indices/${encodeURIComponent(row.indexCode)}`}
                    className="font-mono text-sm font-semibold fin-link"
                  >
                    {row.indexCode}
                  </Link>
                  <p className="mt-1 max-w-[18rem] leading-snug text-[var(--fin-text)]">
                    {row.indexName}
                  </p>
                  {row.productCode ? (
                    <p className="mt-2 text-[10px] fin-muted-text">
                      主 ETF{" "}
                      <Link
                        to={`/etf/${encodeURIComponent(row.productCode)}`}
                        className="font-mono fin-link"
                      >
                        {row.productCode}
                      </Link>
                    </p>
                  ) : null}
                  {row.usesEtfProxy && row.proxyEtfCode ? (
                    <p
                      className="featured-index-proxy-chip mt-1.5 inline-block"
                      title={`本地无指数全收益序列，使用主跟踪 ETF ${row.proxyEtfCode} 收盘价代理`}
                    >
                      ETF 代理 · {row.proxyEtfCode}
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-3 align-top text-[var(--fin-dim)]">
                  {row.dimension}
                </td>
                {WINDOWS.flatMap((w) => {
                  const m = row.metrics[w.id];
                  return [
                    <td
                      key={`${row.indexCode}-${w.id}-ret`}
                      className="border-l border-fin-border px-3 py-3 text-right align-top font-mono"
                    >
                      {formatPct(m.annualReturnPct)}
                    </td>,
                    <td
                      key={`${row.indexCode}-${w.id}-dd`}
                      className="px-3 py-3 text-right align-top font-mono"
                    >
                      {formatPct(m.maxDrawdownPct)}
                    </td>,
                    <td
                      key={`${row.indexCode}-${w.id}-vol`}
                      className="px-3 py-3 text-right align-top font-mono"
                    >
                      {formatPct(m.annualVolPct)}
                    </td>,
                  ];
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function FeaturedTrackingPage() {
  const { getEtf, getIndex, etfProducts } = useDataSource();
  const { entries } = useStrategyRegistry();
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});

  const focusRows = useMemo(
    () =>
      FOCUS_ITEMS.map((item) => {
        const product = etfProducts.find(
          (p) => p.indexCode === item.indexCode && p.isPrimary,
        );
        return {
          item,
          index: getIndex(item.indexCode),
          product,
          etf: product ? getEtf(product.code) : undefined,
        };
      }),
    [etfProducts, getEtf, getIndex],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      focusRows.map(async (row) => {
        if (!row.product || !row.etf?.bars.length) return null;
        const quote = await fetchLiveQuote(row.product.code, row.etf.bars);
        return quote ? [row.product.code, quote] as const : null;
      }),
    ).then((items) => {
      if (cancelled) return;
      setQuotes(Object.fromEntries(items.filter((x): x is [string, LiveQuote] => Boolean(x))));
    });
    return () => {
      cancelled = true;
    };
  }, [focusRows]);

  const strategyGroups = useMemo(
    () => buildStrategyGroups(focusRows, entries, quotes),
    [focusRows, entries, quotes],
  );

  return (
    <div className="ft-page space-y-6">
      <PageHeader
        kicker="执行层"
        title="精选跟踪"
        breadcrumbs={[{ label: "配置总览", to: "/" }, { label: "精选跟踪" }]}
        description="保留低相关性、高收益率和持有体验的代表指数和 ETF。"
      />

      <FeaturedActionSummary groups={strategyGroups} />

      <EtfStrategySection
        groups={strategyGroups}
      />

      <FeaturedIndexMatrix focusRows={focusRows} />

      <p className="text-xs leading-relaxed fin-muted-text">
        {SP_INDEX_ETF_PROXY_FOOTNOTE}
      </p>
    </div>
  );
}

function FeaturedActionSummary({ groups }: { groups: EtfStrategyGroup[] }) {
  const items = useMemo(() => {
    const labels = ["临近买", "中性", "临近卖"] as const;
    return labels.map((label) => {
      const matched = groups.flatMap((group) =>
        group.strategies
          .filter((s) => s.zoneLabel === label)
          .map((s) => ({
            code: group.focusRow.product?.code ?? s.etf.meta.code,
          })),
      );
      const codes = Array.from(new Set(matched.map((m) => m.code)));
      return { label, strategyCount: matched.length, etfCount: codes.length, codes };
    });
  }, [groups]);

  return (
    <section className="fin-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--fin-text)]">
            今日可操作摘要
          </h2>
          <p className="mt-1 text-xs fin-muted-text">
            按已登记 ETF 策略的盘中标尺归类；先看区间，再看下方明细。
          </p>
        </div>
        <Link to="/monitor" className="fin-btn-secondary rounded-full px-3 py-1.5 text-xs">
          打开盘中监控
        </Link>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-fin-border bg-fin-panel-muted/60 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className={zoneClass(item.label)}>{item.label}</span>
              <span className="font-mono text-lg font-semibold text-[var(--fin-text)]">
                {item.etfCount}
              </span>
            </div>
            <p className="mt-2 text-[11px] fin-muted-text">
              {item.codes.length
                ? `${item.strategyCount} 条策略 · ${item.codes.join("、")}`
                : "暂无策略进入该区间"}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function EtfStrategySection({
  groups,
}: {
  groups: EtfStrategyGroup[];
}) {

  return (
    <section className="fin-panel overflow-hidden">
      <header className="border-b border-fin-border px-5 py-4">
        <h2 className="text-base font-semibold text-[var(--fin-text)]">
          ETF 策略
        </h2>
        <p className="mt-1 text-xs fin-muted-text">
          按 ETF 分组展示已登记参数；组内按超额收益降序。回测口径与 ETF
          详情页一致；盘中信号使用实时价可用时的快照。现金流类产品满
          2 年并登记策略后会自动纳入。
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="featured-strategy-table min-w-[1180px] w-full text-xs">
          <thead>
            <tr className="fin-table-head">
              <th className="px-4 py-3 text-left font-normal">ETF / 指数</th>
              <th className="px-3 py-3 text-left font-normal">策略</th>
              <th className="px-3 py-3 text-right font-normal">策略收益</th>
              <th className="px-3 py-3 text-right font-normal">策略年化</th>
              <th className="px-3 py-3 text-right font-normal">买入持有</th>
              <th className="px-3 py-3 text-right font-normal">超额</th>
              <th className="px-3 py-3 text-right font-normal">胜率/轮次</th>
              <th className="px-3 py-3 text-left font-normal">均持/空仓</th>
              <th className="px-3 py-3 text-left font-normal">今日盘中信号</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const { item, product, etf } = group.focusRow;
              const rowSpan = group.strategies.length;
              return group.strategies.map((strategy, si) => (
                <tr
                  key={`${product?.code}-${strategy.variant.key}`}
                  className={
                    si === 0
                      ? "featured-etf-group-start fin-row-hover"
                      : "featured-etf-group-cont fin-row-hover"
                  }
                >
                  {si === 0 ? (
                    <td
                      rowSpan={rowSpan}
                      className="featured-etf-group-cell px-4 py-3 align-top"
                    >
                      <Link
                        to={`/etf/${encodeURIComponent(product?.code ?? "")}`}
                        className="font-mono text-sm font-semibold fin-link"
                      >
                        {product?.code ?? "—"}
                      </Link>
                      <p className="mt-1 max-w-[14rem] leading-snug text-[var(--fin-text)]">
                        {product?.name ?? etf?.meta.name ?? "—"}
                      </p>
                      <p className="mt-1 font-mono text-[10px] fin-muted-text">
                        {item.indexCode}
                      </p>
                      <p className="featured-etf-strategy-count mt-2">
                        {rowSpan} 套策略
                      </p>
                    </td>
                  ) : null}
                  <td className="px-3 py-3 align-top">
                    <span className="rounded border border-fin-border bg-fin-panel-muted px-2 py-1 text-[11px]">
                      {strategyStyle(strategy.summary)}
                    </span>
                    <p className="mt-1.5 max-w-[14rem] leading-snug">
                      {strategyKindLabel(strategy.variant.strategyId)} ·{" "}
                      {variantMonitorCompact(strategy.variant)}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-right align-top font-mono">
                    {formatPct(strategy.summary.strategyReturnPct)}
                  </td>
                  <td className="px-3 py-3 text-right align-top font-mono">
                    {formatPct(strategy.strategyAnnualPct)}
                  </td>
                  <td className="px-3 py-3 text-right align-top font-mono">
                    {formatPct(strategy.summary.buyHoldReturnPct)}
                  </td>
                  <td
                    className={`px-3 py-3 text-right align-top font-mono ${
                      strategy.summary.excessReturnPct >= 0
                        ? "text-emerald-300"
                        : "text-rose-300"
                    }`}
                  >
                    {formatSignedPct(strategy.summary.excessReturnPct)}
                  </td>
                  <td className="px-3 py-3 text-right align-top font-mono">
                    {formatPct(strategy.summary.winRate * 100, 0)} /{" "}
                    {strategy.summary.roundCount}
                  </td>
                  <td className="px-3 py-3 align-top font-mono">
                    {formatAvgHoldFlatPairDisplay(
                      strategy.summary.roundCount,
                      strategy.summary.avgHoldDays,
                      strategy.summary.avgFlatDays,
                    )}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <span className={zoneClass(strategy.zoneLabel)}>
                      {strategy.zoneLabel}
                    </span>
                    <p className="mt-1 font-mono text-[10px] fin-muted-text">
                      分位 {formatPct(strategy.signalPct, 1)}
                      {!strategy.isBollinger ? ` · ${strategy.metricLine}` : ""}
                    </p>
                    <p className="mt-1 text-[10px] fin-muted-text">
                      当前状态：{strategy.currentState}
                    </p>
                    <p className="mt-1 text-[10px] fin-muted-text">
                      最新价 {strategy.latestPrice.toFixed(4)} / 昨收 {strategy.prevClose.toFixed(4)}
                      {strategy.quoteSource
                        ? ` · ${formatQuoteSourceLabel(strategy.quoteSource)}`
                        : ""}
                    </p>
                  </td>
                </tr>
              ));
            })}
            {!groups.length ? (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center fin-muted-text">
                  暂无可评估策略（需满 2 年上市且已登记参数）。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
