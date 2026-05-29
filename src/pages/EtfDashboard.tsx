import { useEffect, useMemo, useState } from "react";
import { IntradayQuoteBar } from "../components/IntradayQuoteBar";
import { PageBreadcrumb } from "../components/PageBreadcrumb";
import { useLiveQuote } from "../hooks/useLiveQuote";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  Brush,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_THEME as CHART } from "../lib/chartTheme";
import { useDataSource } from "../context/DataSourceContext";
import { useStrategyRegistry } from "../context/StrategyRegistryContext";
import { buildTrades } from "../lib/backtest";
import {
  buildPriceIndicatorRows,
  mergeTradeMarkers,
} from "../lib/backtestChartSeries";
import { computeWindowedBacktest } from "../lib/backtestRange";
import {
  attachNavToRounds,
  buildRoundTrips,
  computeBacktestSummary,
  findOpenBuy,
  formatAvgHoldFlatPairDisplay,
  type BacktestSummary,
} from "../lib/backtestSummary";
import { strategyPercentileContext } from "../lib/indicatorPercentile";
import { EtfRegisteredParamsList } from "../components/EtfRegisteredParamsList";
import { EtfMonitorStrategyPanel } from "../components/EtfMonitorStrategyPanel";
import { EtfPageErrorBoundary } from "../components/EtfPageErrorBoundary";
import {
  getDeskMonitorParamVariants,
  getProductParamVariants,
} from "../lib/paramVariants";
import { getHiddenMonitorKeys } from "../lib/etfMonitorStrategyPref";
import { formatAumCny, formatPct, formatSignedPct } from "../lib/formatDisplay";
import {
  ETF_MIN_BACKTEST_YEARS,
  etfProductStrategyEligible,
  etfProductStrategyIneligibleReason,
  etfListingStartDate,
  isCashCreationEtf,
} from "../lib/etfListingAge";
import { resolvePreviousClose } from "../lib/liveQuote";
import {
  ETF_PRODUCT_GROUP_LABELS,
  productDataStatusLabel,
  type EtfProductRecord,
} from "../lib/etfProducts";
import { variantMonitorCompact } from "../lib/strategyLabels";
import {
  computeSignals,
  latestSignal,
  mergeIntraday1345,
  usesBollStrategy,
  usesMaCustomStrategy,
  usesRsiStrategy,
} from "../lib/strategy";
import type { EtfParams, OhlcBar, TradePoint } from "../types";

type TabId = "backtest" | "intraday" | "methodology";

function tabFromSearchParam(raw: string | null): TabId | null {
  if (raw === "backtest" || raw === "intraday" || raw === "methodology")
    return raw;
  if (raw === "ledger") return "backtest";
  return null;
}

const MIN_WINDOW_BARS = 25;
const EMPTY_BARS: OhlcBar[] = [];

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

/** 对比策略买卖点颜色（与当前绿/红三角区分） */
const COMPARE_MARKER_COLORS = [
  { buy: "#ea580c", sell: "#9a3412" },
  { buy: "#7c3aed", sell: "#4c1d95" },
  { buy: "#0ea5e9", sell: "#0c4a6e" },
] as const;

/** 多策略时：买卖点相对收盘价的纵向错位比例（买向上、卖向下），避免叠在同一点 */
const MARK_STAGGER_BASE = 0.0028;
const MARK_STAGGER_STEP = 0.0045;

function legendElide(s: string, max = 28): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function barsUpToDate(bars: OhlcBar[], date: string): OhlcBar[] {
  const i = bars.findIndex((b) => b.date === date);
  if (i >= 0) return bars.slice(0, i + 1);
  return bars.filter((b) => b.date <= date);
}

function StrategyHoverTooltip({
  active,
  payload,
  strategyLabel,
  bars,
  params,
  strategyId,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: Record<string, unknown> }>;
  strategyLabel: string;
  bars: OhlcBar[];
  params: EtfParams | undefined;
  strategyId: string | undefined;
}) {
  if (!active || !payload?.length) return null;
  let date: string | undefined;
  let price: number | undefined;
  for (const p of payload) {
    const row = p.payload as { date?: string; price?: number } | undefined;
    if (row?.date) date = row.date;
    if (typeof row?.price === "number") price = row.price;
  }
  if (!date) return null;
  const ctx =
    params && strategyId && bars.length >= 3
      ? strategyPercentileContext(barsUpToDate(bars, date), params, strategyId)
      : null;
  const position = ctx
    ? `${zoneLabelFromPercentile(ctx.percentile)} · ${formatPct(ctx.percentile)}`
    : "—";
  return (
    <div
      className="rounded-xl border px-3 py-2 text-[11px] shadow-md"
      style={{
        background: CHART.tooltip.background,
        borderColor: CHART.tooltip.border,
        color: CHART.tooltip.color,
      }}
    >
      <dl className="space-y-1 fin-muted-text">
        <div className="flex justify-between gap-4">
          <dt>日期</dt>
          <dd className="font-mono text-[var(--fin-text)]">{date}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>收盘价</dt>
          <dd className="font-mono text-[var(--fin-text)]">
            {typeof price === "number" ? price.toFixed(4) : "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>当前策略</dt>
          <dd className="max-w-[10rem] truncate text-right text-[var(--fin-text)]">
            {strategyLabel}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>策略位置</dt>
          <dd className="font-mono text-[var(--fin-text)]">{position}</dd>
        </div>
      </dl>
    </div>
  );
}

function CompareBuyMarker({
  cx,
  cy,
  fill,
}: {
  cx?: number;
  cy?: number;
  fill: string;
}) {
  if (cx == null || cy == null) return null;
  return (
    <rect
      x={cx - 4.5}
      y={cy - 4.5}
      width={9}
      height={9}
      transform={`rotate(45 ${cx} ${cy})`}
      fill={fill}
      stroke="#fff"
      strokeWidth={1}
    />
  );
}

function CompareSellMarker({
  cx,
  cy,
  fill,
}: {
  cx?: number;
  cy?: number;
  fill: string;
}) {
  if (cx == null || cy == null) return null;
  return (
    <circle cx={cx} cy={cy} r={5} fill={fill} stroke="#fff" strokeWidth={1} />
  );
}

function clampWindowIndices(
  n: number,
  start: number,
  end: number,
): { i0: number; i1: number } {
  if (n <= 0) return { i0: 0, i1: 0 };
  const span = Math.min(MIN_WINDOW_BARS, n);
  let i1 = Math.min(n - 1, Math.max(end, start));
  let i0 = Math.max(0, Math.min(start, i1));
  if (i1 - i0 + 1 < span) {
    i1 = Math.min(n - 1, i0 + span - 1);
    i0 = Math.max(0, i1 - span + 1);
  }
  return { i0, i1 };
}

export function EtfDashboardPage() {
  const { code } = useParams<{ code: string }>();
  return (
    <EtfPageErrorBoundary etfCode={code}>
      <EtfDashboardPageInner />
    </EtfPageErrorBoundary>
  );
}

function EtfDashboardPageInner() {
  const { code } = useParams<{ code: string }>();
  const { getEtf, getIndex, indexTracking, etfProducts, getLatestExDividendDate } =
    useDataSource();
  const [chartsReady, setChartsReady] = useState(false);
  useEffect(() => {
    setChartsReady(false);
    const id = requestAnimationFrame(() => setChartsReady(true));
    return () => cancelAnimationFrame(id);
  }, [code]);
  const { entries: registeredStrategies, removeEntry } = useStrategyRegistry();
  const etf = code ? getEtf(code) : undefined;

  const productRecord = useMemo((): EtfProductRecord | undefined => {
    if (!etf) return undefined;
    return etfProducts.find((p) => p.code === etf.meta.code);
  }, [etf, etfProducts]);

  const latestExDividendDate = useMemo(
    () => (etf?.meta.code ? getLatestExDividendDate(etf.meta.code) : null),
    [etf?.meta.code, getLatestExDividendDate],
  );

  const trackingIndexCode = useMemo(() => {
    if (!etf?.meta.code) return null;
    if (productRecord?.indexCode) return productRecord.indexCode;
    return (
      indexTracking.find((row) => row.etf_code === etf.meta.code)?.index_code ??
      null
    );
  }, [indexTracking, etf?.meta.code, productRecord?.indexCode]);
  const trackingIndexName = useMemo(
    () =>
      trackingIndexCode
        ? (getIndex(trackingIndexCode)?.meta.name ?? null)
        : null,
    [getIndex, trackingIndexCode],
  );

  const strategyEligible = useMemo(
    () => (etf ? etfProductStrategyEligible(etf, productRecord) : false),
    [etf, productRecord],
  );
  const strategyIneligibleReason = useMemo(
    () =>
      etf && !strategyEligible
        ? etfProductStrategyIneligibleReason(etf, productRecord)
        : null,
    [etf, strategyEligible, productRecord],
  );
  const isCashflow = useMemo(
    () => (etf ? isCashCreationEtf(etf, productRecord) : false),
    [etf, productRecord],
  );

  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<TabId>("backtest");

  useEffect(() => {
    const fromUrl = tabFromSearchParam(searchParams.get("tab"));
    if (!strategyEligible) {
      setTab("methodology");
      return;
    }
    if (fromUrl) {
      setTab(fromUrl);
      return;
    }
    setTab("backtest");
  }, [etf?.meta.code, strategyEligible, searchParams]);

  const [monitorPrefTick, setMonitorPrefTick] = useState(0);

  const allParamVariants = useMemo(
    () =>
      etf
        ? getProductParamVariants(etf, productRecord, registeredStrategies)
        : [],
    [etf, productRecord, registeredStrategies],
  );

  const builtinMonitorVariants = useMemo(
    () => (etf ? getDeskMonitorParamVariants(etf, productRecord) : []),
    [etf, productRecord],
  );

  const variants = useMemo(() => {
    if (!etf) return [];
    const hidden = getHiddenMonitorKeys(etf.meta.code);
    return allParamVariants.filter((v) => !hidden.has(v.key));
  }, [etf?.meta.code, allParamVariants, monitorPrefTick]);

  const visibleVariantKeySig = useMemo(
    () => variants.map((v) => v.key).join("\u0001"),
    [variants],
  );

  const [variantKey, setVariantKey] = useState("");
  useEffect(() => {
    if (!etf) return;
    setVariantKey((prev) => {
      if (prev && variants.some((v) => v.key === prev)) return prev;
      return variants[0]?.key ?? "";
    });
  }, [etf?.meta.code, visibleVariantKeySig]);

  const activeVariant = useMemo(() => {
    if (!variants.length) return undefined;
    return variants.find((x) => x.key === variantKey) ?? variants[0];
  }, [variants, variantKey]);

  /** 价格图对比策略（最多 3 条，与当前策略互斥） */
  const [compareKeys, setCompareKeys] = useState<string[]>([]);
  useEffect(() => {
    if (!activeVariant) return;
    setCompareKeys((keys) => keys.filter((k) => k !== activeVariant.key));
  }, [activeVariant?.key]);

  const closeSignals = useMemo(
    () =>
      etf && activeVariant
        ? computeSignals(
            etf.bars,
            activeVariant.params,
            activeVariant.strategyId,
          )
        : [],
    [etf, activeVariant],
  );
  const fullTrades = useMemo(
    () =>
      etf && activeVariant
        ? buildTrades(
            etf.bars,
            closeSignals,
            activeVariant.paramVersion,
            activeVariant.strategyId,
            activeVariant.params,
          )
        : [],
    [etf, activeVariant, closeSignals],
  );

  const barCount = etf?.bars.length ?? 0;
  const [winStartIdx, setWinStartIdx] = useState(0);
  /** 初次渲染在 clamp 中视为「直到最后一根」，避免闪一下过短窗口 */
  const [winEndIdx, setWinEndIdx] = useState(Number.MAX_SAFE_INTEGER);
  useEffect(() => {
    if (!etf?.bars.length) return;
    const n = etf.bars.length;
    setWinStartIdx(0);
    setWinEndIdx(Math.max(0, n - 1));
  }, [etf?.meta.code, etf?.bars.length, activeVariant?.key]);

  const { i0, i1 } = useMemo(
    () => clampWindowIndices(barCount, winStartIdx, winEndIdx),
    [barCount, winStartIdx, winEndIdx],
  );

  const winBt = useMemo(() => {
    if (!etf || !activeVariant || !barCount) return null;
    return computeWindowedBacktest(
      etf.bars,
      activeVariant.params,
      activeVariant.strategyId,
      activeVariant.paramVersion,
      i0,
      i1,
    );
  }, [etf, activeVariant, barCount, i0, i1]);

  const backtestTrades = winBt?.tradesWin ?? [];
  const rawRounds = useMemo(
    () => buildRoundTrips(backtestTrades),
    [backtestTrades],
  );
  const rounds = useMemo(() => attachNavToRounds(rawRounds), [rawRounds]);
  const openInWindow = useMemo(
    () => findOpenBuy(backtestTrades),
    [backtestTrades],
  );
  const floatOpenPct = useMemo(() => {
    if (!openInWindow || !winBt?.barsWin.length) return null;
    const last = winBt.barsWin[winBt.barsWin.length - 1]!.close;
    return (
      Math.round(((last - openInWindow.price) / openInWindow.price) * 10000) /
      100
    );
  }, [openInWindow, winBt]);
  const openHoldDays = useMemo(() => {
    if (!openInWindow || !winBt?.barsWin.length) return null;
    const buyIdx = winBt.barsWin.findIndex((b) => b.date === openInWindow.date);
    if (buyIdx < 0) return null;
    return winBt.barsWin.length - 1 - buyIdx;
  }, [openInWindow, winBt]);
  const backSummary = useMemo(
    () =>
      etf && winBt
        ? computeBacktestSummary(winBt.barsWin, backtestTrades, rounds)
        : null,
    [etf, winBt, backtestTrades, rounds],
  );

  const chartRows = useMemo(
    () =>
      etf && activeVariant && winBt
        ? buildPriceIndicatorRows(
            etf.bars,
            activeVariant.params,
            activeVariant.strategyId,
            winBt.i0,
            winBt.i1,
          )
        : [],
    [etf, activeVariant, winBt],
  );

  const rsiMode = Boolean(
    activeVariant && usesRsiStrategy(activeVariant.strategyId),
  );
  const maCustomMode = Boolean(
    activeVariant && usesMaCustomStrategy(activeVariant.strategyId),
  );
  const bollMode = Boolean(
    activeVariant && usesBollStrategy(activeVariant.strategyId),
  );
  const rsiOb = chartRows[0]?.rsiOverbought;
  const rsiOs = chartRows[0]?.rsiOversold;

  const chartMerged = useMemo(
    () => mergeTradeMarkers(chartRows, backtestTrades),
    [chartRows, backtestTrades],
  );

  const brushData = useMemo(
    () =>
      (etf?.bars ?? []).map((b) => ({
        date: b.date,
        preview: Number(b.close.toFixed(4)),
      })),
    [etf],
  );

  const latestGlobalPosition = useMemo(
    () => (findOpenBuy(fullTrades) ? "持仓" : "空仓"),
    [fullTrades],
  );

  const compareProfiles = useMemo(() => {
    if (!etf || !winBt || !activeVariant) return [];
    const barsWin = winBt.barsWin;
    if (!barsWin.length) return [];
    const out: {
      key: string;
      label: string;
      trades: TradePoint[];
      summary: BacktestSummary;
    }[] = [];
    for (const key of compareKeys.slice(0, 3)) {
      if (key === activeVariant.key) continue;
      const v = variants.find((x) => x.key === key);
      if (!v) continue;
      const sig = computeSignals(barsWin, v.params, v.strategyId);
      const trades = buildTrades(
        barsWin,
        sig,
        v.paramVersion,
        v.strategyId,
        v.params,
      );
      const rds = attachNavToRounds(buildRoundTrips(trades));
      out.push({
        key,
        label: variantMonitorCompact(v),
        trades,
        summary: computeBacktestSummary(barsWin, trades, rds),
      });
    }
    return out;
  }, [etf, winBt, activeVariant, compareKeys, variants]);

  const primaryLegendShort = activeVariant
    ? variantMonitorCompact(activeVariant)
    : "";

  const priceChartRows = useMemo(() => {
    const buySets = compareProfiles.map(
      (p) =>
        new Set(p.trades.filter((t) => t.side === "BUY").map((t) => t.date)),
    );
    const sellSets = compareProfiles.map(
      (p) =>
        new Set(p.trades.filter((t) => t.side === "SELL").map((t) => t.date)),
    );
    const stagger = compareProfiles.length > 0;
    return chartMerged.map((row) => {
      const p = row.price;
      const o: Record<string, unknown> = {
        date: row.date,
        price: p,
      };
      if (stagger) {
        o.buyMarkY =
          row.buyMark != null ? p * (1 + MARK_STAGGER_BASE) : undefined;
        o.sellMarkY =
          row.sellMark != null ? p * (1 - MARK_STAGGER_BASE) : undefined;
        for (let i = 0; i < compareProfiles.length; i++) {
          const f = MARK_STAGGER_BASE + (i + 1) * MARK_STAGGER_STEP;
          o[`buyCmp${i}Y`] = buySets[i]!.has(row.date)
            ? p * (1 + f)
            : undefined;
          o[`sellCmp${i}Y`] = sellSets[i]!.has(row.date)
            ? p * (1 - f)
            : undefined;
        }
      } else {
        o.buyMarkY = row.buyMark;
        o.sellMarkY = row.sellMark;
        for (let i = 0; i < compareProfiles.length; i++) {
          o[`buyCmp${i}Y`] = buySets[i]!.has(row.date) ? p : undefined;
          o[`sellCmp${i}Y`] = sellSets[i]!.has(row.date) ? p : undefined;
        }
      }
      return o;
    });
  }, [chartMerged, compareProfiles]);

  /** 与下方 Brush 共用：左轴宽 + 占位，各子图对齐 */
  const chartLayout = useMemo(() => {
    const axisL = 52;
    return {
      axisL,
      marginPrice: { top: 8, bottom: 22, left: 8, right: 12 } as const,
      marginStrategy: { top: 8, bottom: 22, left: 8, right: 12 } as const,
      marginBrush: { top: 2, bottom: 2, left: 8 + axisL, right: 12 } as const,
    };
  }, []);

  const intradayActive = tab === "intraday";
  const liveQuote = useLiveQuote(
    etf?.meta.code,
    etf?.bars ?? EMPTY_BARS,
    intradayActive,
  );
  const lastClose = etf?.bars.length
    ? resolvePreviousClose(etf.bars, liveQuote.quote)
    : 1;
  const snapClose = liveQuote.price ?? lastClose;

  const mergedForIntra = useMemo(() => {
    if (!etf?.bars.length) return [];
    return mergeIntraday1345(etf.bars, snapClose);
  }, [etf, snapClose]);

  const intradayRows = useMemo(() => {
    if (!etf?.bars.length) return [];
    return variants.map((v) => {
      const sigs = computeSignals(mergedForIntra, v.params, v.strategyId);
      const sig = latestSignal(sigs);
      let pctCtx = null;
      try {
        pctCtx = strategyPercentileContext(
          etf.bars,
          v.params,
          v.strategyId,
          mergedForIntra,
        );
      } catch {
        pctCtx = null;
      }
      return {
        v,
        sig,
        pctCtx,
        zoneLabel: zoneLabelFromPercentile(pctCtx?.percentile),
      };
    });
  }, [etf, variants, mergedForIntra]);

  const variantZoneRows = useMemo(() => {
    if (!etf?.bars.length) return [];
    return variants.map((v) => {
      let pctCtx = null;
      try {
        pctCtx = strategyPercentileContext(etf.bars, v.params, v.strategyId);
      } catch {
        pctCtx = null;
      }
      return {
        v,
        pctCtx,
        zoneLabel: zoneLabelFromPercentile(pctCtx?.percentile),
      };
    });
  }, [etf, variants]);

  const windowLabel =
    winBt && winBt.barsWin.length > 0
      ? `${winBt.barsWin[0].date} ~ ${winBt.barsWin[winBt.barsWin.length - 1].date}（${winBt.barsWin.length} 个交易日）`
      : "";

  const tabs: { id: TabId; label: string; hide?: boolean }[] = [
    { id: "backtest", label: "策略回测", hide: !strategyEligible },
    { id: "intraday", label: "盘中信号", hide: !strategyEligible },
    { id: "methodology", label: "指数研究入口" },
  ];

  if (!etf) {
    return (
      <div className="fin-panel p-12 text-center">
        <p className="fin-muted-text">未找到标的</p>
        <Link to="/" className="mt-4 inline-block text-sm fin-link">
          返回配置总览
        </Link>
      </div>
    );
  }

  return (
    <div className="ft-page space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <PageBreadcrumb
            items={[
              { label: "配置总览", to: "/" },
              { label: "产品选择", to: "/products" },
              { label: etf.meta.code },
            ]}
          />
          <p className="mt-2 text-xs font-medium text-[var(--fin-dim)]">
            产品执行
          </p>
          <h2 className="fin-page-title mt-1">{etf.meta.name}</h2>
          <p className="mt-1 font-mono text-sm fin-muted-text">
            {etf.meta.code}
          </p>
          <p className="mt-2 text-sm fin-muted-text">
            {productRecord?.isPrimary === false ? (
              <span className="fin-muted-text">参考产品 · </span>
            ) : (
              <span className="font-medium text-[var(--fin-text)]">
                主跟踪 ·{" "}
              </span>
            )}
            {strategyEligible
              ? "盘中信号与策略回测基于本产品行情；指数股息率、利差与绩效请点下方链接。"
              : "此处为产品信息；策略回测与盘中信号因上市年限或产品类型暂未开放。"}
          </p>
          {trackingIndexCode ? (
            <Link
              to={`/indices/${encodeURIComponent(trackingIndexCode)}`}
              className="mt-2 inline-block text-sm fin-link"
            >
              查看指数研究 → {trackingIndexCode}
              {trackingIndexName ? ` · ${trackingIndexName}` : ""}
            </Link>
          ) : null}
        </div>
        <div className="fin-panel px-5 py-3 text-sm max-w-md space-y-2">
          {productRecord ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs border-b border-fin-border pb-2">
              <dt className="text-[var(--fin-dim)]">产品分组</dt>
              <dd className="font-medium text-[var(--fin-text)]">
                {ETF_PRODUCT_GROUP_LABELS[productRecord.productGroup]?.title ??
                  productRecord.productGroup}
              </dd>
              <dt className="text-[var(--fin-dim)]">首交易日</dt>
              <dd className="font-mono text-[var(--fin-text)]">
                {etfListingStartDate(etf, productRecord) ?? "—"}
                {!strategyEligible && !isCashflow ? (
                  <span className="ml-1 text-[var(--fin-amber)]">
                    · 未满{ETF_MIN_BACKTEST_YEARS}年
                  </span>
                ) : null}
                {isCashflow ? (
                  <span className="ml-1 text-[var(--fin-amber)]">
                    · 现金流类
                  </span>
                ) : null}
              </dd>
              <dt className="text-[var(--fin-dim)]">最近分红（除息）</dt>
              <dd className="font-mono text-[var(--fin-text)]">
                {latestExDividendDate ?? "—"}
              </dd>
              <dt className="text-[var(--fin-dim)]">数据状态</dt>
              <dd className="text-[var(--fin-text)]">
                {productDataStatusLabel(productRecord.dataStatus)}
              </dd>
              <dt className="text-[var(--fin-dim)]">规模</dt>
              <dd className="font-mono text-[var(--fin-text)]">
                {formatAumCny(productRecord.aumCny)}
              </dd>
              <dt className="text-[var(--fin-dim)]">综合费率</dt>
              <dd className="font-mono text-[var(--fin-text)]">
                {productRecord.totalFeePct != null
                  ? formatPct(productRecord.totalFeePct)
                  : "—"}
              </dd>
              <dt className="text-[var(--fin-dim)]">跟踪角色</dt>
              <dd
                className={
                  productRecord.isPrimary
                    ? "font-medium text-[var(--fin-text)]"
                    : "fin-muted-text"
                }
              >
                {productRecord.isPrimary ? "主跟踪产品" : "参考产品"}
              </dd>
            </dl>
          ) : null}
          {strategyEligible ? (
            <>
              <div className="border-b border-fin-border pb-2">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <p className="text-xs text-[var(--fin-dim)]">
                    监控策略 · 买卖区间趋势
                  </p>
                  <Link to="/monitor" className="text-[10px] fin-link">
                    盘中监控 →
                  </Link>
                </div>
                {variantZoneRows.length === 0 ? (
                  <p className="mt-2 text-xs fin-muted-text">暂无监控策略</p>
                ) : (
                  <ul className="mt-1.5 max-h-40 space-y-1.5 overflow-y-auto">
                    {variantZoneRows.map(({ v, pctCtx, zoneLabel }) => (
                      <li
                        key={v.key}
                        className={`rounded-lg border border-fin-border px-2 py-1.5 ${
                          v.key === activeVariant?.key
                            ? "ring-1 ring-[var(--fin-blue)]/50"
                            : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span
                            className="min-w-0 text-[11px] font-medium leading-snug text-[var(--fin-text)]"
                            title={variantMonitorCompact(v)}
                          >
                            {variantMonitorCompact(v)}
                          </span>
                          <span className={`shrink-0 ${zoneClass(zoneLabel)}`}>
                            {zoneLabel}
                          </span>
                        </div>
                        {pctCtx ? (
                          <p className="mt-0.5 text-[10px] leading-snug fin-muted-text">
                            {pctCtx.metricName} {pctCtx.metricValue} · 分位{" "}
                            <span className="font-mono font-semibold text-[var(--fin-text)]">
                              {formatPct(pctCtx.percentile)}
                            </span>
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : strategyIneligibleReason ? (
            <p className="text-xs leading-relaxed fin-muted-text">
              {strategyIneligibleReason}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-fin-border pb-2">
        {tabs
          .filter((t) => !t.hide)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                tab === t.id
                  ? "fin-chip-filter-active"
                  : "fin-chip-filter fin-muted-text"
              }`}
            >
              {t.label}
            </button>
          ))}
      </div>

      {!strategyEligible && strategyIneligibleReason ? (
        <div className="fin-alert-warn--compact px-4 py-3 text-sm">
          {strategyIneligibleReason}
          {trackingIndexCode ? (
            <>
              {" "}
              可前往
              <Link
                to={`/indices/${encodeURIComponent(trackingIndexCode)}`}
                className="mx-1 fin-link"
              >
                指数详情
              </Link>
              查看指数全收益与股息率研究。
            </>
          ) : null}
        </div>
      ) : null}

      {tab === "backtest" && strategyEligible && (
        <section className="space-y-6">
          {trackingIndexCode ? (
            <div className="rounded-2xl border border-fin-border px-4 py-3 text-sm text-[var(--fin-text)]">
              <strong className="font-medium">指数研究</strong>
              （股息率、股债利差、指数绩效）在指数详情页，
              <Link
                to={`/indices/${encodeURIComponent(trackingIndexCode)}`}
                className="ml-2 fin-link"
              >
                打开 {trackingIndexCode} 指数详情 →
              </Link>
            </div>
          ) : null}
          <EtfMonitorStrategyPanel
            etfCode={etf.meta.code}
            allVariants={allParamVariants}
            builtinVariants={builtinMonitorVariants}
            visibleVariants={variants}
            activeKey={activeVariant?.key}
            onPrefChange={() => setMonitorPrefTick((t) => t + 1)}
            onRemoveRegistered={removeEntry}
            onActiveKeyChange={setVariantKey}
          />

          {variants.length > 0 && (
            <div className="fin-panel p-5">
              <p className="mb-3 text-xs fin-muted-text">
                切换当前回测策略；列表以「当前监控策略」为准。
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-medium uppercase tracking-wide text-[var(--fin-dim)]">
                  策略参数
                </label>
                <Link
                  to={`/registry?etf=${encodeURIComponent(etf.meta.code)}`}
                  className="text-xs fin-link"
                >
                  策略研究 →
                </Link>
              </div>
              <select
                className="mt-2 w-full max-w-xl rounded-xl border border-fin-border bg-transparent px-3 py-2 text-sm font-medium text-[var(--fin-text)]"
                value={activeVariant?.key ?? ""}
                onChange={(e) => setVariantKey(e.target.value)}
              >
                {variants.map((v) => (
                  <option key={v.key} value={v.key}>
                    {variantMonitorCompact(v)}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs fin-muted-text">
                切换后回测与下图按该方案更新；汇总统计随下方所选时间段变化。
              </p>
            </div>
          )}

          {backSummary && winBt && (
            <div className="fin-panel p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide fin-muted-text">
                策略汇总
              </h3>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                <Stat
                  compact
                  label="策略收益"
                  value={formatPct(backSummary.strategyReturnPct)}
                />
                <Stat
                  compact
                  label="基准"
                  value={formatPct(backSummary.buyHoldReturnPct)}
                />
                <Stat
                  compact
                  label="超额"
                  value={formatPct(backSummary.excessReturnPct)}
                />
                <Stat
                  compact
                  label="最大回撤"
                  value={formatPct(backSummary.maxDrawdownPct)}
                />
                <Stat
                  compact
                  label="年化波动"
                  value={formatPct(backSummary.annualVolPct)}
                />
                <Stat
                  compact
                  label="胜率"
                  value={formatPct(backSummary.winRate * 100)}
                />
                <Stat
                  compact
                  label="轮次"
                  value={String(backSummary.roundCount)}
                />
                <Stat
                  compact
                  label="已平买/卖"
                  value={`${backSummary.pairedBuyCount}/${backSummary.pairedSellCount}`}
                />
                <Stat
                  compact
                  label="未平买"
                  value={backSummary.pendingBuyCount > 0 ? "持有" : "无"}
                />
                <Stat
                  compact
                  label="流水"
                  value={`${backSummary.rawBuyCount}/${backSummary.rawSellCount}`}
                />
                <Stat
                  compact
                  label="均持/空仓天"
                  value={formatAvgHoldFlatPairDisplay(
                    backSummary.roundCount,
                    backSummary.avgHoldDays,
                    backSummary.avgFlatDays,
                  )}
                />
                <Stat
                  compact
                  label="时段末/全历史"
                  value={`${backSummary.position}/${latestGlobalPosition}`}
                />
              </div>
            </div>
          )}

          <div className="fin-panel p-5 space-y-3">
            <h3 className="text-sm font-semibold text-[var(--fin-text)]">
              价格与买卖点 · 策略指标
            </h3>
            {!chartsReady ? (
              <p className="text-xs fin-muted-text py-8 text-center">
                图表加载中…
              </p>
            ) : null}
            {chartsReady && variants.length > 1 && activeVariant ? (
              <div className="rounded-lg border border-fin-border px-3 py-2">
                <p className="text-xs font-medium text-[var(--fin-text)]">
                  对比策略（可选，最多 3 个）
                </p>
                <p className="mt-0.5 text-[10px] leading-snug fin-muted-text">
                  仅在<strong>上方价格图</strong>
                  叠加买卖点（与下方所选时间段一致）；多选时标记会略错开，避免叠在一起。
                </p>
                <div className="mt-2 flex max-h-28 flex-wrap gap-x-3 gap-y-1.5 overflow-y-auto">
                  {variants
                    .filter((v) => v.key !== activeVariant.key)
                    .map((v) => {
                      const on = compareKeys.includes(v.key);
                      const atCap = compareKeys.length >= 3 && !on;
                      return (
                        <label
                          key={v.key}
                          className={`inline-flex cursor-pointer items-center gap-1.5 text-[11px] ${atCap ? "cursor-not-allowed opacity-40" : ""}`}
                        >
                          <input
                            type="checkbox"
                            className="rounded border-fin-border text-[var(--fin-blue)] accent-[var(--fin-blue)]"
                            checked={on}
                            disabled={atCap}
                            onChange={() => {
                              setCompareKeys((prev) => {
                                if (prev.includes(v.key))
                                  return prev.filter((k) => k !== v.key);
                                if (prev.length >= 3) return prev;
                                return [...prev, v.key];
                              });
                            }}
                          />
                          <span className="text-[var(--fin-text)]">
                            {variantMonitorCompact(v)}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>
            ) : null}
            {chartsReady ? (
              <div className="flex flex-col gap-2">
                <div className="min-h-0 rounded-xl border border-fin-border px-2 py-2">
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart
                      syncId="etfbt"
                      data={priceChartRows}
                      margin={chartLayout.marginPrice}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={CHART.gridDash}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: CHART.axisTick }}
                        minTickGap={28}
                      />
                      <YAxis
                        yAxisId="left"
                        domain={["auto", "auto"]}
                        tick={{ fontSize: 11, fill: CHART.axisTick }}
                        width={chartLayout.axisL}
                      />
                      <Tooltip
                        content={(tooltipProps) => (
                          <StrategyHoverTooltip
                            {...tooltipProps}
                            strategyLabel={
                              activeVariant
                                ? variantMonitorCompact(activeVariant)
                                : "—"
                            }
                            bars={etf.bars}
                            params={activeVariant?.params}
                            strategyId={activeVariant?.strategyId}
                          />
                        )}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
                        iconSize={8}
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="price"
                        stroke="#4f46e5"
                        dot={false}
                        strokeWidth={2}
                        name="收盘"
                        isAnimationActive={false}
                      />
                      <Scatter
                        yAxisId="left"
                        name={
                          compareProfiles.length > 0
                            ? `买｜${legendElide(primaryLegendShort)}`
                            : "买"
                        }
                        dataKey="buyMarkY"
                        fill="#059669"
                        shape={(p: { cx?: number; cy?: number }) => (
                          <BuyMarker cx={p.cx} cy={p.cy} />
                        )}
                      />
                      <Scatter
                        yAxisId="left"
                        name={
                          compareProfiles.length > 0
                            ? `卖｜${legendElide(primaryLegendShort)}`
                            : "卖"
                        }
                        dataKey="sellMarkY"
                        fill="#b91c1c"
                        shape={(p: { cx?: number; cy?: number }) => (
                          <SellMarker cx={p.cx} cy={p.cy} />
                        )}
                      />
                      {compareProfiles.map((cp, i) => {
                        const col =
                          COMPARE_MARKER_COLORS[i] ?? COMPARE_MARKER_COLORS[0]!;
                        return (
                          <Scatter
                            key={`cmp-buy-${cp.key}`}
                            yAxisId="left"
                            name={`买｜${legendElide(cp.label)}`}
                            dataKey={`buyCmp${i}Y`}
                            fill={col.buy}
                            shape={(p: { cx?: number; cy?: number }) => (
                              <CompareBuyMarker
                                cx={p.cx}
                                cy={p.cy}
                                fill={col.buy}
                              />
                            )}
                          />
                        );
                      })}
                      {compareProfiles.map((cp, i) => {
                        const col =
                          COMPARE_MARKER_COLORS[i] ?? COMPARE_MARKER_COLORS[0]!;
                        return (
                          <Scatter
                            key={`cmp-sell-${cp.key}`}
                            yAxisId="left"
                            name={`卖｜${legendElide(cp.label)}`}
                            dataKey={`sellCmp${i}Y`}
                            fill={col.sell}
                            shape={(p: { cx?: number; cy?: number }) => (
                              <CompareSellMarker
                                cx={p.cx}
                                cy={p.cy}
                                fill={col.sell}
                              />
                            )}
                          />
                        );
                      })}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="min-h-0 rounded-xl border border-fin-border px-2 py-2">
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart
                      syncId="etfbt"
                      data={chartMerged}
                      margin={chartLayout.marginStrategy}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={CHART.gridDash}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: CHART.axisTick }}
                        minTickGap={28}
                      />
                      <YAxis
                        domain={rsiMode ? [0, 100] : ["auto", "auto"]}
                        tick={{ fontSize: 11, fill: CHART.axisTick }}
                        width={chartLayout.axisL}
                      />
                      <Tooltip
                        content={(tooltipProps) => (
                          <StrategyHoverTooltip
                            {...tooltipProps}
                            strategyLabel={
                              activeVariant
                                ? variantMonitorCompact(activeVariant)
                                : "—"
                            }
                            bars={etf.bars}
                            params={activeVariant?.params}
                            strategyId={activeVariant?.strategyId}
                          />
                        )}
                      />
                      <Legend />
                      {rsiMode && rsiOb != null && rsiOs != null && (
                        <>
                          <ReferenceLine
                            y={rsiOb}
                            stroke="#fca5a5"
                            strokeDasharray="5 5"
                            label={{
                              value: `超买 ${rsiOb}`,
                              fill: "#b91c1c",
                              fontSize: 10,
                            }}
                          />
                          <ReferenceLine
                            y={rsiOs}
                            stroke="#86efac"
                            strokeDasharray="5 5"
                            label={{
                              value: `超卖 ${rsiOs}`,
                              fill: "#047857",
                              fontSize: 10,
                            }}
                          />
                          <Line
                            type="monotone"
                            dataKey="rsi"
                            stroke="#7c3aed"
                            dot={false}
                            strokeWidth={2}
                            name="RSI"
                            connectNulls
                            isAnimationActive={false}
                          />
                        </>
                      )}
                      {bollMode && (
                        <>
                          <Line
                            type="monotone"
                            dataKey="price"
                            stroke="#18181b"
                            dot={false}
                            strokeWidth={1.5}
                            name="收盘"
                            isAnimationActive={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="bbUpper"
                            stroke="#94a3b8"
                            dot={false}
                            strokeWidth={1}
                            name="布林上"
                            connectNulls
                            isAnimationActive={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="bbMid"
                            stroke="#cbd5e1"
                            strokeDasharray="4 4"
                            dot={false}
                            strokeWidth={1}
                            name="布林中"
                            connectNulls
                            isAnimationActive={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="bbLower"
                            stroke="#94a3b8"
                            dot={false}
                            strokeWidth={1}
                            name="布林下"
                            connectNulls
                            isAnimationActive={false}
                          />
                          <Scatter
                            name="买"
                            dataKey="buyMark"
                            fill="#059669"
                            shape={(p: { cx?: number; cy?: number }) => (
                              <BuyMarker cx={p.cx} cy={p.cy} />
                            )}
                          />
                          <Scatter
                            name="卖"
                            dataKey="sellMark"
                            fill="#b91c1c"
                            shape={(p: { cx?: number; cy?: number }) => (
                              <SellMarker cx={p.cx} cy={p.cy} />
                            )}
                          />
                        </>
                      )}
                      {!rsiMode && !bollMode && (
                        <>
                          {maCustomMode && (
                            <Line
                              type="monotone"
                              dataKey="price"
                              stroke="#a1a1aa"
                              dot={false}
                              strokeWidth={1}
                              name="收盘"
                              isAnimationActive={false}
                            />
                          )}
                          <Line
                            type="monotone"
                            dataKey="maFast"
                            stroke="#f59e0b"
                            dot={false}
                            strokeWidth={1.5}
                            name={maCustomMode ? "MA（自定义）" : "MA 快"}
                            connectNulls
                            isAnimationActive={false}
                          />
                          {!maCustomMode && (
                            <Line
                              type="monotone"
                              dataKey="maSlow"
                              stroke="#64748b"
                              dot={false}
                              strokeWidth={1.5}
                              name="MA 慢"
                              connectNulls
                              isAnimationActive={false}
                            />
                          )}
                        </>
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                {barCount > MIN_WINDOW_BARS && brushData.length > 0 && (
                  <div className="rounded-xl border border-fin-border px-2 py-2">
                    <p className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wide text-[var(--fin-dim)]">
                      选择时间段 · 拖动两端或平移滑块
                    </p>
                    {windowLabel ? (
                      <p className="mb-2 px-1 text-[11px] font-mono fin-muted-text">
                        当前：{windowLabel}
                      </p>
                    ) : null}
                    <ResponsiveContainer width="100%" height={56}>
                      <ComposedChart
                        syncId="etfbt"
                        data={brushData}
                        margin={chartLayout.marginBrush}
                      >
                        <XAxis dataKey="date" hide />
                        <YAxis hide domain={["auto", "auto"]} />
                        <Line
                          type="monotone"
                          dataKey="preview"
                          stroke="#a1a1aa"
                          strokeWidth={1}
                          dot={false}
                          isAnimationActive={false}
                        />
                        <Brush
                          dataKey="date"
                          height={22}
                          stroke="#6366f1"
                          fill="rgb(238 242 255)"
                          travellerWidth={9}
                          startIndex={i0}
                          endIndex={i1}
                          onChange={(e: {
                            startIndex?: number;
                            endIndex?: number;
                          }) => {
                            const s = e.startIndex ?? 0;
                            const en = e.endIndex ?? barCount - 1;
                            const c = clampWindowIndices(barCount, s, en);
                            setWinStartIdx((prev) =>
                              prev === c.i0 ? prev : c.i0,
                            );
                            setWinEndIdx((prev) =>
                              prev === c.i1 ? prev : c.i1,
                            );
                          }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {barCount > 0 && barCount <= MIN_WINDOW_BARS && (
                  <p className="text-xs fin-muted-text">
                    历史数据过短，暂无法选择时间段（至少需要 {MIN_WINDOW_BARS}{" "}
                    个交易日）。
                  </p>
                )}
              </div>
            ) : null}
          </div>
          <div className="fin-panel overflow-hidden">
            <div className="border-b border-fin-border px-6 py-3">
              <h3 className="text-sm font-semibold text-[var(--fin-text)]">
                明细数据
              </h3>
              <p className="mt-1 text-xs fin-muted-text">
                已平仓轮次 +
                窗口内买入后尚未卖出的持有；买入价/卖出价为对应交易日收盘价，与上方价格图一致。同一轮内多次买入信号不新开仓、不刷新成本，策略收益与持仓天数均自本轮<strong>首次</strong>买入日至卖出日计。已平仓行按
                <strong>买入日升序</strong>排列；MA 自定义的
                <strong>卖触发</strong>
                列按持仓内逐日规则与信号一致，标出本笔首次触发的「止盈」「回撤」或「止盈+回撤（同日）」。
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="fin-table-head text-xs">
                  <tr>
                    <th className="px-4 py-3">类型</th>
                    <th className="px-4 py-3">买入日</th>
                    <th className="px-4 py-3">卖出日</th>
                    <th className="px-4 py-3">买入价</th>
                    <th className="px-4 py-3">卖出价</th>
                    <th className="px-4 py-3">买触发</th>
                    <th className="px-4 py-3">卖触发</th>
                    <th className="px-4 py-3">收益 %</th>
                    <th className="px-4 py-3">持仓天数</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-fin-border">
                  {rounds.length === 0 && !openInWindow ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-4 py-8 text-center fin-muted-text"
                      >
                        暂无已平仓轮次或持仓记录
                      </td>
                    </tr>
                  ) : (
                    <>
                      {[...rounds]
                        .sort((a, b) => a.buyDate.localeCompare(b.buyDate))
                        .map((r) => (
                          <tr
                            key={r.round}
                            className="fin-row-hover"
                          >
                            <td className="px-4 py-2.5 font-mono fin-muted-text">
                              第 {r.round} 轮
                            </td>
                            <td className="px-4 py-2.5 font-mono fin-muted-text">
                              {r.buyDate}
                            </td>
                            <td className="px-4 py-2.5 font-mono fin-muted-text">
                              {r.sellDate}
                            </td>
                            <td className="px-4 py-2.5">
                              {r.buyPrice.toFixed(4)}
                            </td>
                            <td className="px-4 py-2.5">
                              {r.sellPrice.toFixed(4)}
                            </td>
                            <td
                              className="px-4 py-2.5 fin-muted-text max-w-[160px] truncate"
                              title={r.buyTrigger}
                            >
                              {r.buyTrigger}
                            </td>
                            <td
                              className="px-4 py-2.5 fin-muted-text max-w-[160px] truncate"
                              title={r.sellTrigger}
                            >
                              {r.sellTrigger}
                            </td>
                            <td className="px-4 py-2.5 font-medium">
                              {formatPct(r.pnlPct)}
                            </td>
                            <td className="px-4 py-2.5">{r.holdDays}</td>
                          </tr>
                        ))}
                      {openInWindow && (
                        <tr className="fin-subtle-highlight">
                          <td className="px-4 py-2.5 font-medium text-[var(--fin-muted)]">
                            持有
                          </td>
                          <td className="px-4 py-2.5 font-mono fin-muted-text">
                            {openInWindow.date}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[var(--fin-dim)]">
                            —
                          </td>
                          <td className="px-4 py-2.5">
                            {openInWindow.price.toFixed(4)}
                          </td>
                          <td className="px-4 py-2.5">—</td>
                          <td
                            className="px-4 py-2.5 fin-muted-text max-w-[160px] truncate"
                            title={openInWindow.reason}
                          >
                            {openInWindow.reason}
                          </td>
                          <td className="px-4 py-2.5 text-[var(--fin-dim)]">
                            —
                          </td>
                          <td className="px-4 py-2.5 font-medium text-[var(--fin-muted)]">
                            {formatSignedPct(floatOpenPct)}
                          </td>
                          <td className="px-4 py-2.5">{openHoldDays ?? "—"}</td>
                        </tr>
                      )}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {tab === "intraday" && strategyEligible && (
        <section className="space-y-4">
          <div className="fin-panel space-y-4 p-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--fin-text)]">
                盘中信号
              </h3>
              <p className="mt-1 text-xs text-fin-muted leading-relaxed">
                用最新价格更新当日收盘估算，对下表各监控策略重算信号与分位（非历史经验分位）。
              </p>
            </div>
            <IntradayQuoteBar
              quote={liveQuote.quote}
              loading={liveQuote.loading}
              lastClose={lastClose}
              bars={etf.bars}
            />
            <EtfRegisteredParamsList etf={etf} compact className="pb-1" />
            {!variants.length ? (
              <p className="text-xs fin-muted-text">无可用策略参数。</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-fin-border">
                <table className="min-w-full text-left text-xs">
                  <thead className="fin-table-head">
                    <tr>
                      <th className="px-2 py-1.5 font-normal">策略</th>
                      <th className="px-2 py-1.5 font-normal">信号</th>
                      <th className="px-2 py-1.5 font-normal">分位</th>
                      <th className="px-2 py-1.5 font-normal">指标</th>
                      <th className="px-2 py-1.5 font-normal">区间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-fin-border">
                    {intradayRows.map(({ v, sig, pctCtx, zoneLabel }) => (
                      <tr key={v.key} className="fin-row-hover">
                        <td
                          className="px-2 py-1.5 font-medium text-[var(--fin-text)] max-w-[14rem] truncate"
                          title={variantMonitorCompact(v)}
                        >
                          {variantMonitorCompact(v)}
                        </td>
                        <td className="px-2 py-1.5">
                          {sig === "BUY" ? (
                            <span className="fin-zone-chip fin-zone-chip--buy">
                              买
                            </span>
                          ) : sig === "SELL" ? (
                            <span className="fin-zone-chip fin-zone-chip--sell">
                              卖
                            </span>
                          ) : (
                            <span className="fin-zone-chip fin-zone-chip--neutral">
                              观望
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-[var(--fin-text)]">
                          {pctCtx != null ? formatPct(pctCtx.percentile) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-[10px] fin-muted-text">
                          {pctCtx ? (
                            <>
                              {pctCtx.metricName} ={" "}
                              <span className="font-mono">
                                {pctCtx.metricValue}
                              </span>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td
                          className="px-2 py-1.5 text-[10px]"
                          title={pctCtx?.hint ?? "—"}
                        >
                          <span className={zoneClass(zoneLabel)}>
                            {zoneLabel}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs fin-muted-text">
              区间：分位 ≤20% 为临近买，20%–80% 为中性，≥80% 为临近卖。
            </p>
          </div>
        </section>
      )}

      {tab === "methodology" && (
        <section className="fin-panel p-8 text-sm fin-muted-text leading-relaxed space-y-4">
          <h3 className="text-lg font-semibold text-[var(--fin-text)]">
            指数研究入口
          </h3>
          <p>
            编制说明、指数全收益曲线、股息率与股债利差分位等内容，请前往对应指数详情页查看。
          </p>
          {trackingIndexCode ? (
            <Link
              to={`/indices/${encodeURIComponent(trackingIndexCode)}`}
              className="fin-btn-primary inline-flex rounded-full px-4 py-2"
            >
              前往 {trackingIndexCode}
              {trackingIndexName ? ` · ${trackingIndexName}` : ""} 指数详情
            </Link>
          ) : (
            <p className="fin-muted-text">
              暂未关联跟踪指数，可在首页「产品落地」或指数列表中查找对应指数。
            </p>
          )}
          <p className="text-xs text-[var(--fin-dim)] border-t border-fin-border pt-4">
            本产品页中的回测与图表基于<strong>ETF 历史收盘价</strong>
            ，不代表指数实时点位。
          </p>
        </section>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  compact,
}: {
  label: string;
  value: string;
  hint?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="rounded-lg border border-fin-border px-2.5 py-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--fin-dim)]">
          {label}
        </p>
        <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-[var(--fin-text)]">
          {value}
        </p>
        {hint ? (
          <p className="mt-0.5 text-[9px] leading-snug text-[var(--fin-dim)]">
            {hint}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="fin-panel p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--fin-dim)]">
        {label}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[10px] leading-snug text-[var(--fin-dim)]">
          {hint}
        </p>
      ) : null}
      <p className="mt-2 text-xl font-semibold text-[var(--fin-text)]">
        {value}
      </p>
    </div>
  );
}

function BuyMarker({ cx, cy }: { cx?: number; cy?: number }) {
  if (cx == null || cy == null) return null;
  return (
    <path
      d={`M ${cx} ${cy - 7} L ${cx - 6} ${cy + 5} L ${cx + 6} ${cy + 5} Z`}
      fill="#059669"
      stroke="#ecfdf5"
      strokeWidth={1}
    />
  );
}

function SellMarker({ cx, cy }: { cx?: number; cy?: number }) {
  if (cx == null || cy == null) return null;
  return (
    <path
      d={`M ${cx} ${cy + 7} L ${cx - 6} ${cy - 5} L ${cx + 6} ${cy - 5} Z`}
      fill="#b91c1c"
      stroke="#fef2f2"
      strokeWidth={1}
    />
  );
}
