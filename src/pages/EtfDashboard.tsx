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
import { useDataSource } from "../context/DataSourceContext";
import { useStrategyRegistry } from "../context/StrategyRegistryContext";
import { buildTrades } from "../lib/backtest";
import { buildPriceIndicatorRows, mergeTradeMarkers } from "../lib/backtestChartSeries";
import { computeWindowedBacktest } from "../lib/backtestRange";
import {
 attachNavToRounds,
 buildRoundTrips,
 computeBacktestSummary,
 findOpenBuy,
 type BacktestSummary,
} from "../lib/backtestSummary";
import { indicatorValueLabelAtDate, strategyPercentileContext } from "../lib/indicatorPercentile";
import { getParamVariants } from "../lib/paramVariants";
import { formatAumCny, formatPct, formatSignedPct } from "../lib/formatDisplay";
import {
 ETF_MIN_BACKTEST_YEARS,
 etfBacktestEligible,
 etfBacktestIneligibleReason,
 etfListingStartDate,
} from "../lib/etfListingAge";
import {
 ETF_PRODUCT_GROUP_LABELS,
 productDataStatusLabel,
 type EtfProductRecord,
} from "../lib/etfProducts";
import { variantMonitorCompact, variantOptionLabel } from "../lib/strategyLabels";
import {
 computeSignals,
 latestSignal,
 mergeIntraday1345,
 usesBollStrategy,
 usesMaCustomStrategy,
 usesRsiStrategy,
} from "../lib/strategy";
import type { TradePoint } from "../types";

type TabId = "backtest" | "intraday" | "ledger" | "methodology";

function tabFromSearchParam(raw: string | null): TabId | null {
 if (raw === "backtest" || raw === "intraday" || raw === "ledger" || raw === "methodology") return raw;
 return null;
}

const MIN_WINDOW_BARS = 25;

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

type CompareTooltipStrat = { key: string; label: string; summary: BacktestSummary };

function PriceStrategyCompareTooltip({
 active,
 payload,
 primaryLabel,
 primarySummary,
 compares,
}: {
 active?: boolean;
 payload?: ReadonlyArray<{ payload?: Record<string, unknown> }>;
 primaryLabel: string;
 primarySummary: BacktestSummary | null;
 compares: CompareTooltipStrat[];
}) {
 if (!active || !payload?.length) return null;
 const row = payload[0]?.payload as { date?: string; price?: number } | undefined;
 if (!row?.date) return null;
 const sumLines = (s: BacktestSummary) => (
 <ul className="mt-1 list-inside list-disc fin-muted-text">
 <li>策略收益 {formatPct(s.strategyReturnPct)}</li>
 <li>最大回撤 {formatPct(s.maxDrawdownPct)}</li>
 <li>胜率 {formatPct(s.winRate * 100)}</li>
 <li>完整轮次 {s.roundCount}</li>
 </ul>
 );
 return (
 <div className="max-w-[17rem] rounded-lg border border-fin-border bg-white px-3 py-2.5 text-[11px] shadow-lg">
 <p className="font-mono font-semibold text-[var(--fin-text)]">{row.date}</p>
 <p className="mt-0.5 fin-muted-text">
 收盘 {typeof row.price === "number" ? row.price.toFixed(4) : "—"}
 </p>
 <div className="mt-2 space-y-2 border-t border-fin-border pt-2">
 <div>
 <p className="font-semibold text-[var(--fin-blue)]">当前 · {primaryLabel}</p>
 {primarySummary ? sumLines(primarySummary) : <p className="mt-1 text-[var(--fin-dim)]">—</p>}
 </div>
 {compares.map((c, i) => (
 <div key={c.key}>
 <p className="font-semibold text-amber-950">对比{i + 1} · {c.label}</p>
 {sumLines(c.summary)}
 </div>
 ))}
 </div>
 <p className="mt-2 border-t border-fin-border pt-1.5 text-[10px] leading-snug fin-muted-text">
 上列为当前时间窗内回测摘要；买卖点形状：三角=当前，方块/圆=对比。多选时标记沿价格纵向略错位，便于区分。
 </p>
 </div>
 );
}

function CompareBuyMarker({ cx, cy, fill }: { cx?: number; cy?: number; fill: string }) {
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

function CompareSellMarker({ cx, cy, fill }: { cx?: number; cy?: number; fill: string }) {
 if (cx == null || cy == null) return null;
 return <circle cx={cx} cy={cy} r={5} fill={fill} stroke="#fff" strokeWidth={1} />;
}

function clampWindowIndices(n: number, start: number, end: number): { i0: number; i1: number } {
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
 const { getEtf, getIndex, indexTracking, etfProducts } = useDataSource();
 const { entries: registeredStrategies } = useStrategyRegistry();
 const etf = code ? getEtf(code) : undefined;

 const isCashflow = etf?.meta.product_kind === "现金流类";

 const productRecord = useMemo((): EtfProductRecord | undefined => {
 if (!etf) return undefined;
 return etfProducts.find((p) => p.code === etf.meta.code);
 }, [etf, etfProducts]);

 const trackingIndexCode = useMemo(() => {
 if (!etf?.meta.code) return null;
 if (productRecord?.indexCode) return productRecord.indexCode;
 return indexTracking.find((row) => row.etf_code === etf.meta.code)?.index_code ?? null;
 }, [indexTracking, etf?.meta.code, productRecord?.indexCode]);
 const trackingIndexName = useMemo(
 () => (trackingIndexCode ? getIndex(trackingIndexCode)?.meta.name ?? null : null),
 [getIndex, trackingIndexCode]
 );

 const backtestEligible = useMemo(
 () => (etf ? etfBacktestEligible(etf, productRecord) : false),
 [etf, productRecord]
 );
 const backtestIneligibleReason = useMemo(
 () => (etf && !backtestEligible ? etfBacktestIneligibleReason(etf, productRecord) : null),
 [etf, backtestEligible, productRecord]
 );

 const [searchParams] = useSearchParams();
 const [tab, setTab] = useState<TabId>("backtest");

 useEffect(() => {
 const fromUrl = tabFromSearchParam(searchParams.get("tab"));
 if (fromUrl === "intraday" || fromUrl === "ledger" || fromUrl === "methodology") {
 setTab(fromUrl);
 return;
 }
 if (fromUrl === "backtest" && backtestEligible) {
 setTab("backtest");
 return;
 }
 setTab(backtestEligible ? "backtest" : "intraday");
 }, [etf?.meta.code, backtestEligible, searchParams]);

 const variants = useMemo(
 () => (etf ? getParamVariants(etf, registeredStrategies) : []),
 [etf, registeredStrategies]
 );
 const [variantKey, setVariantKey] = useState("");
 useEffect(() => {
 if (!etf) return;
 const v = getParamVariants(etf, registeredStrategies);
 setVariantKey(v[0]?.key ?? "");
 }, [etf, registeredStrategies]);

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
 ? computeSignals(etf.bars, activeVariant.params, activeVariant.strategyId)
 : [],
 [etf, activeVariant]
 );
 const fullTrades = useMemo(
 () =>
 etf && activeVariant
 ? buildTrades(etf.bars, closeSignals, activeVariant.paramVersion, activeVariant.strategyId, activeVariant.params)
 : [],
 [etf, activeVariant, closeSignals]
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
 [barCount, winStartIdx, winEndIdx]
 );

 const winBt = useMemo(() => {
 if (!etf || !activeVariant || !barCount) return null;
 return computeWindowedBacktest(
 etf.bars,
 activeVariant.params,
 activeVariant.strategyId,
 activeVariant.paramVersion,
 i0,
 i1
 );
 }, [etf, activeVariant, barCount, i0, i1]);

 const backtestTrades = winBt?.tradesWin ?? [];
 const rawRounds = useMemo(() => buildRoundTrips(backtestTrades), [backtestTrades]);
 const rounds = useMemo(() => attachNavToRounds(rawRounds), [rawRounds]);
 const openInWindow = useMemo(() => findOpenBuy(backtestTrades), [backtestTrades]);
 const floatOpenPct = useMemo(() => {
 if (!openInWindow || !winBt?.barsWin.length) return null;
 const last = winBt.barsWin[winBt.barsWin.length - 1]!.close;
 return Math.round(((last - openInWindow.price) / openInWindow.price) * 10000) / 100;
 }, [openInWindow, winBt]);
 const openHoldDays = useMemo(() => {
 if (!openInWindow || !winBt?.barsWin.length) return null;
 const buyIdx = winBt.barsWin.findIndex((b) => b.date === openInWindow.date);
 if (buyIdx < 0) return null;
 return winBt.barsWin.length - 1 - buyIdx;
 }, [openInWindow, winBt]);
 const backSummary = useMemo(
 () =>
 etf && winBt ? computeBacktestSummary(winBt.barsWin, backtestTrades, rounds) : null,
 [etf, winBt, backtestTrades, rounds]
 );

 const chartRows = useMemo(
 () =>
 etf && activeVariant && winBt
 ? buildPriceIndicatorRows(
 etf.bars,
 activeVariant.params,
 activeVariant.strategyId,
 winBt.i0,
 winBt.i1
 )
 : [],
 [etf, activeVariant, winBt]
 );

 const rsiMode = Boolean(activeVariant && usesRsiStrategy(activeVariant.strategyId));
 const maCustomMode = Boolean(activeVariant && usesMaCustomStrategy(activeVariant.strategyId));
 const bollMode = Boolean(activeVariant && usesBollStrategy(activeVariant.strategyId));
 const rsiOb = chartRows[0]?.rsiOverbought;
 const rsiOs = chartRows[0]?.rsiOversold;

 const chartMerged = useMemo(
 () => mergeTradeMarkers(chartRows, backtestTrades),
 [chartRows, backtestTrades]
 );

 const brushData = useMemo(
 () => (etf?.bars ?? []).map((b) => ({ date: b.date, preview: Number(b.close.toFixed(4)) })),
 [etf]
 );

 const latestGlobalPosition = useMemo(() => (findOpenBuy(fullTrades) ? "持仓" : "空仓"), [fullTrades]);

 const fullRounds = useMemo(
 () => attachNavToRounds(buildRoundTrips(fullTrades)),
 [fullTrades]
 );
 const fullSummary = useMemo(
 () => (etf ? computeBacktestSummary(etf.bars, fullTrades, fullRounds) : null),
 [etf, fullTrades, fullRounds]
 );

 const compareProfiles = useMemo(() => {
 if (!etf || !winBt || !activeVariant) return [];
 const barsWin = winBt.barsWin;
 if (!barsWin.length) return [];
 const out: { key: string; label: string; trades: TradePoint[]; summary: BacktestSummary }[] = [];
 for (const key of compareKeys.slice(0, 3)) {
 if (key === activeVariant.key) continue;
 const v = variants.find((x) => x.key === key);
 if (!v) continue;
 const sig = computeSignals(barsWin, v.params, v.strategyId);
 const trades = buildTrades(barsWin, sig, v.paramVersion, v.strategyId, v.params);
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

 const primaryLegendShort = activeVariant ? variantMonitorCompact(activeVariant) : "";

 const priceChartRows = useMemo(() => {
 const buySets = compareProfiles.map((p) => new Set(p.trades.filter((t) => t.side === "BUY").map((t) => t.date)));
 const sellSets = compareProfiles.map((p) => new Set(p.trades.filter((t) => t.side === "SELL").map((t) => t.date)));
 const stagger = compareProfiles.length > 0;
 return chartMerged.map((row) => {
 const p = row.price;
 const o: Record<string, unknown> = {
 date: row.date,
 price: p,
 };
 if (stagger) {
 o.buyMarkY = row.buyMark != null ? p * (1 + MARK_STAGGER_BASE) : undefined;
 o.sellMarkY = row.sellMark != null ? p * (1 - MARK_STAGGER_BASE) : undefined;
 for (let i = 0; i < compareProfiles.length; i++) {
 const f = MARK_STAGGER_BASE + (i + 1) * MARK_STAGGER_STEP;
 o[`buyCmp${i}Y`] = buySets[i]!.has(row.date) ? p * (1 + f) : undefined;
 o[`sellCmp${i}Y`] = sellSets[i]!.has(row.date) ? p * (1 - f) : undefined;
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

 const lastClose = etf?.bars[etf.bars.length - 1]?.close ?? 1;
 const intradayActive = tab === "intraday";
 const liveQuote = useLiveQuote(etf?.meta.code, etf?.bars ?? [], intradayActive);
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
 const pctCtx = strategyPercentileContext(etf.bars, v.params, v.strategyId, mergedForIntra);
 const p = pctCtx?.percentile;
 let alert: string | null = null;
 if (p != null) {
 if (p <= 18) alert = "临近买";
 else if (p <= 32) alert = "靠近买区";
 else if (p >= 82) alert = "临近卖";
 else if (p >= 68) alert = "靠近卖区";
 }
 return { v, sig, pctCtx, alert };
 });
 }, [etf, variants, mergedForIntra]);

 const closeZoneHint = useMemo(
 () =>
 etf && activeVariant
 ? strategyPercentileContext(etf.bars, activeVariant.params, activeVariant.strategyId)
 : null,
 [etf, activeVariant]
 );

 const windowLabel =
 winBt && winBt.barsWin.length > 0
 ? `${winBt.barsWin[0].date} ~ ${winBt.barsWin[winBt.barsWin.length - 1].date}（${winBt.barsWin.length} 根 K 线）`
 : "";

 const tabs: { id: TabId; label: string; hide?: boolean }[] = [
 { id: "backtest", label: "策略回测", hide: !backtestEligible },
 { id: "intraday", label: "盘中信号" },
 { id: "ledger", label: "信号台账", hide: !backtestEligible },
 { id: "methodology", label: "指数研究入口" },
 ];

 if (!etf) {
 return (
 <div className="rounded-3xl border border-fin-border bg-white p-12 text-center shadow-sm">
 <p className="fin-muted-text">未找到标的</p>
 <Link to="/" className="mt-4 inline-block text-sm fin-link">
 返回配置总览
 </Link>
 </div>
 );
 }

 return (
 <div className="space-y-8">
 <div className="flex flex-wrap items-start justify-between gap-6">
 <div>
 <PageBreadcrumb
 items={[
 { label: "配置总览", to: "/" },
 { label: "产品选择", to: "/products" },
 { label: etf.meta.code },
 ]}
 />
 <p className="mt-2 text-xs font-medium text-[var(--fin-blue)]">产品执行</p>
 <h2 className="fin-page-title mt-1">{etf.meta.name}</h2>
 <p className="mt-1 font-mono text-sm fin-muted-text">{etf.meta.code}</p>
 <p className="mt-2 text-sm fin-muted-text">
 {productRecord?.isPrimary === false ?
 <span className="fin-muted-text">参考产品 · </span>
 : <span className="font-medium text-[var(--fin-blue)]">主跟踪 · </span>}
 盘中信号与策略回测基于 ETF 行情；指数研究请跳转下方链接。
 </p>
 {trackingIndexCode ?
 <Link
 to={`/indices/${encodeURIComponent(trackingIndexCode)}`}
 className="mt-2 inline-block text-sm fin-link"
 >
 查看指数研究 → {trackingIndexCode}
 {trackingIndexName ? ` · ${trackingIndexName}` : ""}
 </Link>
 : null}
 </div>
 <div className="rounded-2xl border border-fin-border bg-white px-5 py-4 text-sm shadow-sm max-w-md space-y-3">
 {productRecord ?
 <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs border-b border-fin-border pb-3">
 <dt className="text-[var(--fin-dim)]">产品分组</dt>
 <dd className="font-medium text-[var(--fin-text)]">
 {ETF_PRODUCT_GROUP_LABELS[productRecord.productGroup]?.title ?? productRecord.productGroup}
 </dd>
 <dt className="text-[var(--fin-dim)]">首交易日</dt>
 <dd className="font-mono text-[var(--fin-text)]">
 {etfListingStartDate(etf, productRecord) ?? "—"}
 {!backtestEligible ?
 <span className="ml-1 text-amber-700">· 未满{ETF_MIN_BACKTEST_YEARS}年</span>
 : null}
 </dd>
 <dt className="text-[var(--fin-dim)]">数据状态</dt>
 <dd className="text-[var(--fin-text)]">{productDataStatusLabel(productRecord.dataStatus)}</dd>
 <dt className="text-[var(--fin-dim)]">规模</dt>
 <dd className="font-mono text-[var(--fin-text)]">{formatAumCny(productRecord.aumCny)}</dd>
 <dt className="text-[var(--fin-dim)]">综合费率</dt>
 <dd className="font-mono text-[var(--fin-text)]">
 {productRecord.totalFeePct != null ? formatPct(productRecord.totalFeePct) : "—"}
 </dd>
 <dt className="text-[var(--fin-dim)]">跟踪角色</dt>
 <dd className={productRecord.isPrimary ? "font-medium text-[var(--fin-blue)]" : "fin-muted-text"}>
 {productRecord.isPrimary ? "主跟踪产品" : "参考产品"}
 </dd>
 </dl>
 : null}
 <div>
 <p className="text-xs text-[var(--fin-dim)]">临近买入 / 卖出区间提示</p>
 <p className="mt-1 text-base font-semibold leading-snug text-[var(--fin-text)]">
 {closeZoneHint?.hint ?? "—"}
 </p>
 {closeZoneHint && (
 <p className="mt-1 text-xs fin-muted-text">
 {closeZoneHint.metricName} = {closeZoneHint.metricValue} · 标尺{" "}
 <span className="font-mono font-semibold">{formatPct(closeZoneHint.percentile)}</span>
 <span className="text-[var(--fin-dim)]"> · 0 买侧 100 卖侧</span>
 </p>
 )}
 <p className="text-xs fin-muted-text mt-2 border-t border-fin-border pt-2">
 最新收盘（全序列）持仓状态：<span className="font-semibold text-[var(--fin-text)]">{latestGlobalPosition}</span>
 <span className="text-[var(--fin-dim)]"> · 与下方时间窗内「窗口末」可能不同</span>
 </p>
 </div>
 <Link
 to="/monitor"
 className="inline-block text-xs fin-link"
 >
 盘中信号（多标的）→
 </Link>
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
 tab === t.id ? "bg-zinc-900 text-white" : "fin-muted-text hover:bg-fin-panel-muted"
 }`}
 >
 {t.label}
 </button>
 ))}
 </div>

 {isCashflow && (
 <div className="rounded-3xl border border-amber-100 bg-amber-50/60 p-6 text-sm text-amber-950">
 <strong className="font-semibold">现金流类产品</strong>
 ：以下为占位说明。正式环境可接入分配率、现金流日历等字段。
 </div>
 )}

 {!backtestEligible && backtestIneligibleReason ?
 <div className="fin-panel border-amber-200/80 bg-[var(--fin-amber-soft)] px-4 py-3 text-sm text-amber-950">
 {backtestIneligibleReason} 请使用「盘中信号」
 {trackingIndexCode ?
 <>
 {" "}
 或
 <Link
 to={`/indices/${encodeURIComponent(trackingIndexCode)}`}
 className="mx-1 fin-link"
 >
 指数详情
 </Link>
 查看基日以来的指数序列
 </>
 : null}
 。
 </div>
 : null}

 {tab === "backtest" && backtestEligible && (
 <section className="space-y-6">
 {trackingIndexCode ?
 <div className="rounded-2xl border border-fin-border bg-[var(--fin-blue-soft)]/50 px-4 py-3 text-sm text-[var(--fin-text)]">
 <strong className="font-medium">指数研究</strong>（股息率、股债利差、指数绩效）在指数详情页维护，本页不重复展示指数大图表。
 <Link
 to={`/indices/${encodeURIComponent(trackingIndexCode)}`}
 className="ml-2 font-medium text-[var(--fin-blue)] hover:underline"
 >
 打开 {trackingIndexCode} 指数详情 →
 </Link>
 </div>
 : null}
 {variants.length > 0 && (
 <div className="rounded-3xl border border-fin-border bg-white p-5 shadow-sm">
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
 className="mt-2 w-full max-w-xl rounded-xl border border-fin-border bg-fin-panel-muted px-3 py-2 text-sm font-medium text-[var(--fin-text)]"
 value={activeVariant?.key ?? ""}
 onChange={(e) => setVariantKey(e.target.value)}
 >
 {variants.map((v) => (
 <option key={v.key} value={v.key}>
 {variantMonitorCompact(v)}
 </option>
 ))}
 </select>
 <p className="mt-1.5 text-xs fin-muted-text">切换后回测与下图按该方案重算；统计口径为下方时间窗。</p>
 </div>
 )}

 {backSummary && winBt && (
 <div className="rounded-2xl border border-fin-border bg-gradient-to-b from-zinc-50/80 to-white p-4 shadow-sm">
 <h3 className="text-xs font-semibold uppercase tracking-wide fin-muted-text">策略汇总</h3>
 <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
 <Stat compact label="策略收益" value={formatPct(backSummary.strategyReturnPct)} />
 <Stat compact label="基准" value={formatPct(backSummary.buyHoldReturnPct)} />
 <Stat compact label="超额" value={formatPct(backSummary.excessReturnPct)} />
 <Stat compact label="最大回撤" value={formatPct(backSummary.maxDrawdownPct)} />
 <Stat compact label="年化波动" value={formatPct(backSummary.annualVolPct)} />
 <Stat compact label="胜率" value={formatPct(backSummary.winRate * 100)} />
 <Stat compact label="轮次" value={String(backSummary.roundCount)} />
 <Stat compact label="已平买/卖" value={`${backSummary.pairedBuyCount}/${backSummary.pairedSellCount}`} />
 <Stat compact label="未平买" value={backSummary.pendingBuyCount > 0 ? "持有" : "无"} />
 <Stat compact label="流水" value={`${backSummary.rawBuyCount}/${backSummary.rawSellCount}`} />
 <Stat compact label="均持/空仓天" value={`${backSummary.avgHoldDays} / ${backSummary.avgFlatDays}`} />
 <Stat compact label="窗末/全序" value={`${backSummary.position}/${latestGlobalPosition}`} />
 </div>
 </div>
 )}

 {fullSummary && backSummary && winBt && (
 <details className="rounded-3xl border border-fin-border bg-fin-panel-muted/60 px-5 py-4 text-sm shadow-sm">
 <summary className="cursor-pointer list-none font-medium text-[var(--fin-text)] [&::-webkit-details-marker]:hidden">
 全序列 vs 当前窗口（审计对照）
 <span className="ml-2 text-xs font-normal fin-muted-text">点击展开</span>
 </summary>
 <p className="mt-3 text-xs leading-relaxed fin-muted-text">
 <strong>全序列</strong>：整段 K 线 + 当前参数组下的成交与权益曲线（不受 Brush 截取）。
 <strong>当前窗口</strong>：与上方「策略汇总」及 Brush 选区一致。
 </p>
 <div className="mt-3 overflow-x-auto rounded-xl border border-fin-border/80 bg-white">
 <table className="min-w-full text-left text-xs">
 <thead className="border-b border-fin-border bg-fin-panel-muted/90 font-semibold uppercase tracking-wide fin-muted-text">
 <tr>
 <th className="px-4 py-2.5">指标</th>
 <th className="px-4 py-2.5">全序列</th>
 <th className="px-4 py-2.5">当前窗口</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-zinc-100 fin-muted-text">
 <tr>
 <td className="px-4 py-2">K 线根数</td>
 <td className="px-4 py-2 font-mono">{etf.bars.length}</td>
 <td className="px-4 py-2 font-mono">{winBt.barsWin.length}</td>
 </tr>
 <tr>
 <td className="px-4 py-2">策略累计收益</td>
 <td className="px-4 py-2 font-mono">{formatPct(fullSummary.strategyReturnPct)}</td>
 <td className="px-4 py-2 font-mono">{formatPct(backSummary.strategyReturnPct)}</td>
 </tr>
 <tr>
 <td className="px-4 py-2">基准·买入持有</td>
 <td className="px-4 py-2 font-mono">{formatPct(fullSummary.buyHoldReturnPct)}</td>
 <td className="px-4 py-2 font-mono">{formatPct(backSummary.buyHoldReturnPct)}</td>
 </tr>
 <tr>
 <td className="px-4 py-2">最大回撤</td>
 <td className="px-4 py-2 font-mono">{formatPct(fullSummary.maxDrawdownPct)}</td>
 <td className="px-4 py-2 font-mono">{formatPct(backSummary.maxDrawdownPct)}</td>
 </tr>
 <tr>
 <td className="px-4 py-2">年化波动</td>
 <td className="px-4 py-2 font-mono">{fullSummary.annualVolPct}%</td>
 <td className="px-4 py-2 font-mono">{backSummary.annualVolPct}%</td>
 </tr>
 <tr>
 <td className="px-4 py-2">胜率</td>
 <td className="px-4 py-2 font-mono">{formatPct(fullSummary.winRate * 100)}</td>
 <td className="px-4 py-2 font-mono">{formatPct(backSummary.winRate * 100)}</td>
 </tr>
 <tr>
 <td className="px-4 py-2">完整买卖轮次</td>
 <td className="px-4 py-2 font-mono">{fullSummary.roundCount}</td>
 <td className="px-4 py-2 font-mono">{backSummary.roundCount}</td>
 </tr>
 <tr>
 <td className="px-4 py-2">流水（买 / 卖）</td>
 <td className="px-4 py-2 font-mono">
 {fullSummary.rawBuyCount} / {fullSummary.rawSellCount}
 </td>
 <td className="px-4 py-2 font-mono">
 {backSummary.rawBuyCount} / {backSummary.rawSellCount}
 </td>
 </tr>
 <tr>
 <td className="px-4 py-2">序列末持仓状态</td>
 <td className="px-4 py-2 font-mono">{fullSummary.position}</td>
 <td className="px-4 py-2 font-mono">{backSummary.position}</td>
 </tr>
 </tbody>
 </table>
 </div>
 </details>
 )}

 <div className="rounded-3xl border border-fin-border bg-white p-5 shadow-sm space-y-3">
 <h3 className="text-sm font-semibold text-[var(--fin-text)]">价格与买卖点 · 策略指标</h3>
 {variants.length > 1 && activeVariant ? (
 <div className="rounded-lg border border-fin-border bg-fin-panel-muted/90 px-3 py-2">
 <p className="text-xs font-medium text-[var(--fin-text)]">对比策略（可选，最多 3 个）</p>
 <p className="mt-0.5 text-[10px] leading-snug fin-muted-text">
 仅在<strong>上方价格图</strong>叠加买卖点（与下方 Brush 时间窗一致）；多选时买点<strong>略高于</strong>收盘、卖点<strong>略低于</strong>收盘并<strong>按策略分层错位</strong>，避免叠在同一点；浮窗内指标仍以<strong>真实收盘</strong>计算。
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
 className="rounded border-zinc-300 text-[var(--fin-blue)] accent-[var(--fin-blue)]"
 checked={on}
 disabled={atCap}
 onChange={() => {
 setCompareKeys((prev) => {
 if (prev.includes(v.key)) return prev.filter((k) => k !== v.key);
 if (prev.length >= 3) return prev;
 return [...prev, v.key];
 });
 }}
 />
 <span className="text-[var(--fin-text)]">{variantMonitorCompact(v)}</span>
 </label>
 );
 })}
 </div>
 </div>
 ) : null}
 <div className="flex flex-col gap-2">
 <div className="min-h-0 rounded-lg border border-fin-border/80 p-1">
 <ResponsiveContainer width="100%" height={260}>
 <ComposedChart
 syncId="etfbt"
 data={priceChartRows}
 margin={chartLayout.marginPrice}
 >
 <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
 <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={28} />
 <YAxis yAxisId="left" domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={chartLayout.axisL} />
 <Tooltip
 content={(tooltipProps) => (
 <PriceStrategyCompareTooltip
 {...tooltipProps}
 primaryLabel={activeVariant ? variantMonitorCompact(activeVariant) : "—"}
 primarySummary={backSummary}
 compares={compareProfiles.map((p) => ({
 key: p.key,
 label: p.label,
 summary: p.summary,
 }))}
 />
 )}
 />
 <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
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
 shape={(p: { cx?: number; cy?: number }) => <BuyMarker cx={p.cx} cy={p.cy} />}
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
 shape={(p: { cx?: number; cy?: number }) => <SellMarker cx={p.cx} cy={p.cy} />}
 />
 {compareProfiles.map((cp, i) => {
 const col = COMPARE_MARKER_COLORS[i] ?? COMPARE_MARKER_COLORS[0]!;
 return (
 <Scatter
 key={`cmp-buy-${cp.key}`}
 yAxisId="left"
 name={`买｜${legendElide(cp.label)}`}
 dataKey={`buyCmp${i}Y`}
 fill={col.buy}
 shape={(p: { cx?: number; cy?: number }) => (
 <CompareBuyMarker cx={p.cx} cy={p.cy} fill={col.buy} />
 )}
 />
 );
 })}
 {compareProfiles.map((cp, i) => {
 const col = COMPARE_MARKER_COLORS[i] ?? COMPARE_MARKER_COLORS[0]!;
 return (
 <Scatter
 key={`cmp-sell-${cp.key}`}
 yAxisId="left"
 name={`卖｜${legendElide(cp.label)}`}
 dataKey={`sellCmp${i}Y`}
 fill={col.sell}
 shape={(p: { cx?: number; cy?: number }) => (
 <CompareSellMarker cx={p.cx} cy={p.cy} fill={col.sell} />
 )}
 />
 );
 })}
 </ComposedChart>
 </ResponsiveContainer>
 </div>
 <div className="min-h-0 rounded-lg border border-fin-border/80 p-1">
 <ResponsiveContainer width="100%" height={260}>
 <ComposedChart syncId="etfbt" data={chartMerged} margin={chartLayout.marginStrategy}>
 <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
 <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={28} />
 <YAxis
 domain={rsiMode ? [0, 100] : ["auto", "auto"]}
 tick={{ fontSize: 11 }}
 width={chartLayout.axisL}
 />
 <Tooltip
 contentStyle={{ borderRadius: 12, border: "1px solid #e4e4e7" }}
 formatter={(value: number, name: string) => {
 if (value == null || Number.isNaN(value)) return [null, name];
 if (name === "RSI") return [Number(value).toFixed(2), name];
 return [typeof value === "number" ? Number(value).toFixed(4) : value, name];
 }}
 />
 <Legend />
 {rsiMode && rsiOb != null && rsiOs != null && (
 <>
 <ReferenceLine
 y={rsiOb}
 stroke="#fca5a5"
 strokeDasharray="5 5"
 label={{ value: `超买 ${rsiOb}`, fill: "#b91c1c", fontSize: 10 }}
 />
 <ReferenceLine
 y={rsiOs}
 stroke="#86efac"
 strokeDasharray="5 5"
 label={{ value: `超卖 ${rsiOs}`, fill: "#047857", fontSize: 10 }}
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
 shape={(p: { cx?: number; cy?: number }) => <BuyMarker cx={p.cx} cy={p.cy} />}
 />
 <Scatter
 name="卖"
 dataKey="sellMark"
 fill="#b91c1c"
 shape={(p: { cx?: number; cy?: number }) => <SellMarker cx={p.cx} cy={p.cy} />}
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
 </div>
 {barCount > MIN_WINDOW_BARS && brushData.length > 0 && (
 <div className="rounded-xl border border-fin-border bg-fin-panel-muted/80 px-2 py-2">
 <p className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wide text-[var(--fin-dim)]">
 时间窗 · 拖动 Brush 两端或平移
 </p>
 {windowLabel ? (
 <p className="mb-2 px-1 text-[11px] font-mono fin-muted-text">当前：{windowLabel}</p>
 ) : null}
 <ResponsiveContainer width="100%" height={56}>
 <ComposedChart syncId="etfbt" data={brushData} margin={chartLayout.marginBrush}>
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
 onChange={(e: { startIndex?: number; endIndex?: number }) => {
 const s = e.startIndex ?? 0;
 const en = e.endIndex ?? barCount - 1;
 const c = clampWindowIndices(barCount, s, en);
 setWinStartIdx(c.i0);
 setWinEndIdx(c.i1);
 }}
 />
 </ComposedChart>
 </ResponsiveContainer>
 </div>
 )}
 {barCount > 0 && barCount <= MIN_WINDOW_BARS && (
 <p className="text-xs fin-muted-text">当前序列过短，不展示时间窗 Brush（至少需多于 {MIN_WINDOW_BARS} 根 K 线）。</p>
 )}
 </div>
 <div className="rounded-3xl border border-fin-border bg-white overflow-hidden shadow-sm">
 <div className="border-b border-fin-border px-6 py-3">
 <h3 className="text-sm font-semibold text-[var(--fin-text)]">明细数据</h3>
 <p className="mt-1 text-xs fin-muted-text">
 已平仓轮次 + 窗口内买入后尚未卖出的持有；净值为策略复利。已平仓行按<strong>买入日升序</strong>排列；MA 自定义的<strong>卖触发</strong>列按持仓内逐日规则与信号一致，标出本笔首次触发的「止盈」「回撤」或「止盈+回撤（同日）」。
 </p>
 </div>
 <div className="overflow-x-auto">
 <table className="min-w-full text-left text-sm">
 <thead className="bg-fin-panel-muted text-xs font-semibold uppercase tracking-wide fin-muted-text">
 <tr>
 <th className="px-4 py-3">类型</th>
 <th className="px-4 py-3">买入日</th>
 <th className="px-4 py-3">卖出日</th>
 <th className="px-4 py-3">买入净值</th>
 <th className="px-4 py-3">卖出净值</th>
 <th className="px-4 py-3">买触发</th>
 <th className="px-4 py-3">卖触发</th>
 <th className="px-4 py-3">收益 %</th>
 <th className="px-4 py-3">持仓天数</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-zinc-100">
 {rounds.length === 0 && !openInWindow ? (
 <tr>
 <td colSpan={9} className="px-4 py-8 text-center fin-muted-text">
 暂无已平仓轮次或持仓记录
 </td>
 </tr>
 ) : (
 <>
 {[...rounds].sort((a, b) => a.buyDate.localeCompare(b.buyDate)).map((r) => (
 <tr key={r.round} className="hover:bg-fin-panel-muted/80">
 <td className="px-4 py-2.5 font-mono fin-muted-text">第 {r.round} 轮</td>
 <td className="px-4 py-2.5 font-mono fin-muted-text">{r.buyDate}</td>
 <td className="px-4 py-2.5 font-mono fin-muted-text">{r.sellDate}</td>
 <td className="px-4 py-2.5">{r.buyNav}</td>
 <td className="px-4 py-2.5">{r.sellNav}</td>
 <td className="px-4 py-2.5 fin-muted-text max-w-[160px] truncate" title={r.buyTrigger}>
 {r.buyTrigger}
 </td>
 <td className="px-4 py-2.5 fin-muted-text max-w-[160px] truncate" title={r.sellTrigger}>
 {r.sellTrigger}
 </td>
 <td className="px-4 py-2.5 font-medium">{formatPct(r.pnlPct)}</td>
 <td className="px-4 py-2.5">{r.holdDays}</td>
 </tr>
 ))}
 {openInWindow && (
 <tr className="bg-amber-50/50 hover:bg-amber-50/80">
 <td className="px-4 py-2.5 font-medium text-amber-900">持有</td>
 <td className="px-4 py-2.5 font-mono fin-muted-text">{openInWindow.date}</td>
 <td className="px-4 py-2.5 font-mono text-[var(--fin-dim)]">—</td>
 <td className="px-4 py-2.5">
 {rounds.length ? rounds[rounds.length - 1]!.sellNav : 1}
 </td>
 <td className="px-4 py-2.5">—</td>
 <td className="px-4 py-2.5 fin-muted-text max-w-[160px] truncate" title={openInWindow.reason}>
 {openInWindow.reason}
 </td>
 <td className="px-4 py-2.5 text-[var(--fin-dim)]">—</td>
 <td className="px-4 py-2.5 font-medium text-amber-900">
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

 {tab === "intraday" && (
 <section className="space-y-4">
 <div className="fin-panel space-y-4 p-4">
 <div>
 <h3 className="text-sm font-semibold text-[var(--fin-text)]">盘中信号</h3>
 <p className="mt-1 text-xs text-fin-muted leading-relaxed">
 以实时最新价覆盖当日最后一根 K 的收盘，对下表各策略重算信号与标尺 %（非历史分位）。
 </p>
 </div>
 <IntradayQuoteBar
 quote={liveQuote.quote}
 loading={liveQuote.loading}
 lastClose={lastClose}
 onRefresh={() => void liveQuote.refresh()}
 />
 {!variants.length ? (
 <p className="text-xs fin-muted-text">无可用策略参数。</p>
 ) : (
 <div className="overflow-x-auto rounded-lg border border-fin-border">
 <table className="min-w-full text-left text-xs">
 <thead className="fin-table-head">
 <tr>
 <th className="px-2 py-1.5 font-normal">策略</th>
 <th className="px-2 py-1.5 font-normal">信号</th>
 <th className="px-2 py-1.5 font-normal">标尺</th>
 <th className="px-2 py-1.5 font-normal">指标</th>
 <th className="px-2 py-1.5 font-normal">区间</th>
 <th className="px-2 py-1.5 font-normal">提醒</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-fin-border">
 {intradayRows.map(({ v, sig, pctCtx, alert }) => (
 <tr key={v.key} className="hover:bg-fin-panel-muted/80">
 <td className="px-2 py-1.5 font-medium text-[var(--fin-text)] max-w-[14rem] truncate" title={variantOptionLabel(v)}>
 {variantOptionLabel(v)}
 </td>
 <td className="px-2 py-1.5">
 <span
 className={
 sig === "BUY"
 ? "font-semibold text-emerald-700"
 : sig === "SELL"
 ? "font-semibold text-red-700"
 : "fin-muted-text"
 }
 >
 {sig}
 </span>
 </td>
 <td className="px-2 py-1.5 font-mono text-[var(--fin-text)]">
 {pctCtx != null ? formatPct(pctCtx.percentile) : "—"}
 </td>
 <td className="px-2 py-1.5 text-[10px] fin-muted-text">
 {pctCtx ? (
 <>
 {pctCtx.metricName} = <span className="font-mono">{pctCtx.metricValue}</span>
 </>
 ) : (
 "—"
 )}
 </td>
 <td className="px-2 py-1.5 text-[10px] fin-muted-text">{pctCtx?.hint ?? "—"}</td>
 <td className="px-2 py-1.5 text-[10px]">
 {alert ? (
 <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900">
 {alert}
 </span>
 ) : (
 <span className="text-[var(--fin-dim)]">—</span>
 )}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 <p className="text-xs fin-muted-text">提醒：标尺约 ≤32% 或 ≥68% 时标黄。</p>
 </div>
 </section>
 )}

 {tab === "ledger" && (
 <section className="rounded-3xl border border-fin-border bg-white overflow-hidden shadow-sm">
 <div className="max-h-[28rem] overflow-y-auto">
 <table className="min-w-full text-sm">
 <thead className="bg-fin-panel-muted text-left text-xs font-semibold uppercase tracking-wide fin-muted-text">
 <tr>
 <th className="px-6 py-4">日期</th>
 <th className="px-6 py-4">方向</th>
 <th className="px-6 py-4">策略指标值</th>
 <th className="px-6 py-4">原因</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-zinc-100">
 {[...fullTrades].reverse().map((t, i) => (
 <tr key={`${t.date}-${t.side}-${i}`} className="hover:bg-fin-panel-muted/80">
 <td className="px-6 py-3 font-mono fin-muted-text">{t.date}</td>
 <td className="px-6 py-3 font-medium">{t.side}</td>
 <td className="px-6 py-3 font-mono fin-muted-text">
 {activeVariant
 ? indicatorValueLabelAtDate(etf.bars, activeVariant.params, activeVariant.strategyId, t.date)
 : "—"}
 </td>
 <td className="px-6 py-3 fin-muted-text">{t.reason}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </section>
 )}

 {tab === "methodology" && (
 <section className="rounded-3xl border border-fin-border bg-white p-8 shadow-sm text-sm fin-muted-text leading-relaxed space-y-4">
 <h3 className="text-lg font-semibold text-[var(--fin-text)]">指数研究入口</h3>
 <p>
 编制说明、指数价格/全收益曲线、股息率与股债利差分位等<strong>指数层</strong>内容，统一在指数详情页查看，避免与产品执行页重复大图表。
 </p>
 {trackingIndexCode ?
 <Link
 to={`/indices/${encodeURIComponent(trackingIndexCode)}`}
 className="fin-btn-primary inline-flex rounded-full px-4 py-2"
 >
 前往 {trackingIndexCode}
 {trackingIndexName ? ` · ${trackingIndexName}` : ""} 指数详情
 </Link>
 : (
 <p className="fin-muted-text">暂未关联跟踪指数，可在首页「产品落地」或指数列表中查找对应指数。</p>
 )}
 <p className="text-xs text-[var(--fin-dim)] border-t border-fin-border pt-4">
 产品执行页下图表均为<strong>本 ETF 日 K 收盘价</strong>上的策略回测，不代表指数实时点位。
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
 <div className="rounded-lg border border-fin-border/90 bg-white px-2.5 py-2 shadow-sm">
 <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--fin-dim)]">{label}</p>
 <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-[var(--fin-text)]">{value}</p>
 {hint ? <p className="mt-0.5 text-[9px] leading-snug text-[var(--fin-dim)]">{hint}</p> : null}
 </div>
 );
 }
 return (
 <div className="rounded-2xl border border-fin-border bg-white p-5 shadow-sm">
 <p className="text-xs font-medium uppercase tracking-wide text-[var(--fin-dim)]">{label}</p>
 {hint ? <p className="mt-0.5 text-[10px] leading-snug text-[var(--fin-dim)]">{hint}</p> : null}
 <p className="mt-2 text-xl font-semibold text-[var(--fin-text)]">{value}</p>
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
