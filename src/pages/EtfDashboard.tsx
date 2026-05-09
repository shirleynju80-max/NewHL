import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
import { attachNavToRounds, buildRoundTrips, computeBacktestSummary, findOpenBuy } from "../lib/backtestSummary";
import { buildSpreadSeries, bondAnchorForEtf } from "../lib/dividend";
import { indicatorValueLabelAtDate, strategyPercentileContext } from "../lib/indicatorPercentile";
import { getParamVariants } from "../lib/paramVariants";
import {
  type Signal,
  computeSignals,
  latestSignal,
  mergeIntraday1345,
  usesRsiStrategy,
} from "../lib/strategy";

type TabId = "backtest" | "intraday" | "ledger" | "dividend" | "hk" | "methodology";

const MIN_WINDOW_BARS = 25;

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
  const { getEtf, bondByDate } = useDataSource();
  const { entries: registeredStrategies } = useStrategyRegistry();
  const etf = code ? getEtf(code) : undefined;

  const isDividend = etf?.meta.product_kind === "红利_含股息分红";
  const isCashflow = etf?.meta.product_kind === "现金流类";
  const hasScope = Boolean(etf?.meta.dividend_market_scope);
  const showDividendModule = Boolean(isDividend && hasScope);
  const showHk = Boolean(isDividend && etf?.meta.dividend_market_scope === "港股红利");

  const [tab, setTab] = useState<TabId>("backtest");

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

  const [intraVariantKey, setIntraVariantKey] = useState("");
  useEffect(() => {
    if (!etf) return;
    setIntraVariantKey(getParamVariants(etf, registeredStrategies)[0]?.key ?? "");
  }, [etf?.meta.code, etf, registeredStrategies]);

  const activeVariant = useMemo(() => {
    if (!variants.length) return undefined;
    return variants.find((x) => x.key === variantKey) ?? variants[0];
  }, [variants, variantKey]);

  const intraVariant = useMemo(() => {
    if (!variants.length) return undefined;
    return variants.find((x) => x.key === intraVariantKey) ?? variants[0];
  }, [variants, intraVariantKey]);

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
        ? buildTrades(etf.bars, closeSignals, activeVariant.paramVersion, activeVariant.strategyId)
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

  const spreadRows = useMemo(
    () => (etf ? buildSpreadSeries(etf, bondByDate) : []),
    [etf, bondByDate]
  );

  const priceChartRows = useMemo(() => {
    const hasSpread = spreadRows.length > 0;
    const m = new Map(spreadRows.map((r) => [r.date, r.spreadPct]));
    return chartMerged.map((row) => ({
      date: row.date,
      price: row.price,
      buyMark: row.buyMark,
      sellMark: row.sellMark,
      spread: hasSpread ? m.get(row.date) : undefined,
    }));
  }, [chartMerged, spreadRows]);

  const lastClose = etf?.bars[etf.bars.length - 1]?.close ?? 1;
  const [snapClose, setSnapClose] = useState(1);
  useEffect(() => {
    if (etf?.bars.length) setSnapClose(etf.bars[etf.bars.length - 1].close);
  }, [etf]);

  const mergedForIntra = useMemo(() => {
    if (!etf?.bars.length) return [];
    return mergeIntraday1345(etf.bars, snapClose);
  }, [etf, snapClose]);

  const intraSignals = useMemo((): Signal[] => {
    if (!etf || !intraVariant) return [];
    return computeSignals(mergedForIntra, intraVariant.params, intraVariant.strategyId);
  }, [mergedForIntra, etf, intraVariant]);

  const intraPct = useMemo(
    () =>
      etf && intraVariant && mergedForIntra.length
        ? strategyPercentileContext(etf.bars, intraVariant.params, intraVariant.strategyId, mergedForIntra)
        : null,
    [etf, intraVariant, mergedForIntra]
  );

  const closeZoneHint = useMemo(
    () =>
      etf && activeVariant
        ? strategyPercentileContext(etf.bars, activeVariant.params, activeVariant.strategyId)
        : null,
    [etf, activeVariant]
  );

  const anchor = etf ? bondAnchorForEtf(etf) : null;

  const windowLabel =
    winBt && winBt.barsWin.length > 0
      ? `${winBt.barsWin[0].date} ~ ${winBt.barsWin[winBt.barsWin.length - 1].date}（${winBt.barsWin.length} 根 K 线）`
      : "";

  const tripleData = spreadRows.map((r) => ({
    date: r.date,
    股息率: r.divYieldPct,
    国债: r.bondYieldPct,
    利差: r.spreadPct,
  }));

  const spreadPriceData = spreadRows.map((r) => ({
    date: r.date,
    价格: r.price,
    利差: r.spreadPct,
  }));

  const tabs: { id: TabId; label: string; hide?: boolean }[] = [
    { id: "backtest", label: "回测与买卖点" },
    { id: "intraday", label: "今日盘中信号" },
    { id: "ledger", label: "信号台账" },
    { id: "dividend", label: "股息与利差", hide: !showDividendModule },
    { id: "hk", label: "港股现金流", hide: !showHk },
    { id: "methodology", label: "编制说明" },
  ];

  if (!etf) {
    return (
      <div className="rounded-3xl border border-zinc-100 bg-white p-12 text-center shadow-sm">
        <p className="text-zinc-500">未找到标的</p>
        <Link to="/" className="mt-4 inline-block text-sm font-medium text-indigo-600 hover:underline">
          返回总览
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Link to="/" className="text-xs font-medium text-indigo-600 hover:underline">
            ← 总览
          </Link>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">{etf.meta.name}</h2>
          <p className="mt-1 font-mono text-sm text-zinc-500">{etf.meta.code}</p>
        </div>
        <div className="rounded-2xl border border-zinc-100 bg-white px-5 py-4 text-sm shadow-sm max-w-md">
          <p className="text-xs text-zinc-400">临近买入 / 卖出区间提示</p>
          <p className="mt-1 text-base font-semibold leading-snug text-zinc-900">
            {closeZoneHint?.hint ?? "—"}
          </p>
          {closeZoneHint && (
            <p className="mt-1 text-xs text-zinc-600">
              {closeZoneHint.metricName} = {closeZoneHint.metricValue} · 历史分位{" "}
              <span className="font-mono font-semibold">{closeZoneHint.percentile}%</span>
              <span className="text-zinc-400">（买入提示 ≤20%，卖出提示 ≥80%）</span>
            </p>
          )}
          <p className="text-xs text-zinc-400 mt-2">
            param {activeVariant?.paramVersion ?? etf.meta.param_version}
            {variants.length > 1 && (
              <span className="text-zinc-300"> · {variants.length} 组可切换</span>
            )}
          </p>
          <p className="text-xs text-zinc-500 mt-2 border-t border-zinc-100 pt-2">
            最新收盘（全序列）持仓状态：<span className="font-semibold text-zinc-800">{latestGlobalPosition}</span>
            <span className="text-zinc-400"> · 与下方时间窗内「窗口末」可能不同</span>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-zinc-200 pb-2">
        {tabs
          .filter((t) => !t.hide)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                tab === t.id ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              {t.label}
            </button>
          ))}
      </div>

      {isCashflow && (
        <div className="rounded-3xl border border-amber-100 bg-amber-50/60 p-6 text-sm text-amber-950">
          <strong className="font-semibold">现金流类产品</strong>
          ：与「股票股息率 − 国债」红利利差模块互斥；以下为占位说明。正式环境可接入分配率、现金流日历等字段。
        </div>
      )}

      {tab === "backtest" && (
        <section className="space-y-6">
          {variants.length > 0 && (
            <div className="rounded-3xl border border-zinc-100 bg-white p-5 shadow-sm">
              <label className="block text-xs font-medium uppercase tracking-wide text-zinc-400">
                策略参数
              </label>
              <select
                className="mt-2 w-full max-w-md rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-900"
                value={activeVariant?.key ?? ""}
                onChange={(e) => setVariantKey(e.target.value)}
              >
                {variants.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label} · {v.strategyId}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-zinc-500">
                切换后回测区按该组参数重算；收益与买卖统计以<strong>下方时间条所选区间</strong>为准（指标向左带预热）。基准为区间内买入持有（首尾收盘）。
              </p>
            </div>
          )}

          {backSummary && winBt && (
            <div className="rounded-3xl border border-zinc-100 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-zinc-900">策略汇总（当前时间窗）</h3>
              <p className="mt-1 text-xs font-mono text-zinc-600">{windowLabel}</p>
              <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
                收益：区间内已平仓按复利滚动；若窗口<strong>最后一天</strong>仍为持仓，按当日收盘对未平部分做市值。基准为窗口<strong>首根 K 收盘买入、持有至末根 K 收盘</strong>。
              </p>
              <div className="mt-5 space-y-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">收益与基准</p>
                  <p className="mt-1 text-[10px] text-zinc-400">
                    策略累计收益 = 按成交重建的<strong>每日收盘权益曲线</strong>首尾变化，与下方「最大回撤 / 年化波动」同源。
                  </p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Stat label="策略累计收益" value={`${backSummary.strategyReturnPct}%`} />
                    <Stat label="买入持有（基准）" value={`${backSummary.buyHoldReturnPct}%`} />
                    <Stat label="相对基准（超额）" value={`${backSummary.excessReturnPct}%`} />
                    <Stat label="最大回撤" value={`${backSummary.maxDrawdownPct}%`} />
                    <Stat label="年化波动（日收益）" value={`${backSummary.annualVolPct}%`} />
                    <Stat label="胜率（按已平仓卖）" value={`${(backSummary.winRate * 100).toFixed(1)}%`} />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">交易统计（与完整轮次对齐）</p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Stat label="完整买卖轮次" value={String(backSummary.roundCount)} />
                    <Stat
                      label="已平仓 · 买 / 卖"
                      hint="每轮各 1 笔"
                      value={`${backSummary.pairedBuyCount} / ${backSummary.pairedSellCount}`}
                    />
                    <Stat
                      label="未完成买入"
                      hint="最后一笔为买且尚未在窗内卖出"
                      value={backSummary.pendingBuyCount > 0 ? "1（持仓中）" : "0"}
                    />
                    <Stat
                      label="流水笔数（审计）"
                      hint="含未配对买；与轮次不同时见上"
                      value={`买 ${backSummary.rawBuyCount} · 卖 ${backSummary.rawSellCount}`}
                    />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">节奏与状态</p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Stat label="平均持仓天数（已平仓轮）" value={String(backSummary.avgHoldDays)} />
                    <Stat label="平均空仓天数（轮次之间）" value={String(backSummary.avgFlatDays)} />
                    <Stat
                      label="窗口末 / 全序列收盘"
                      hint="窗口末：所选区间内最后一根 K 之后是否仍持仓；全序列见顶栏"
                      value={`${backSummary.position} / ${latestGlobalPosition}`}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {fullSummary && backSummary && winBt && (
            <details className="rounded-3xl border border-zinc-200 bg-zinc-50/60 px-5 py-4 text-sm shadow-sm">
              <summary className="cursor-pointer list-none font-medium text-zinc-900 [&::-webkit-details-marker]:hidden">
                全序列 vs 当前窗口（审计对照）
                <span className="ml-2 text-xs font-normal text-zinc-500">点击展开</span>
              </summary>
              <p className="mt-3 text-xs leading-relaxed text-zinc-600">
                <strong>全序列</strong>：整段 K 线 + 当前参数组下的成交与权益曲线（不受 Brush 截取）。
                <strong>当前窗口</strong>：与上方「策略汇总」及 Brush 选区一致。
              </p>
              <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-200/80 bg-white">
                <table className="min-w-full text-left text-xs">
                  <thead className="border-b border-zinc-100 bg-zinc-50/90 font-semibold uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-4 py-2.5">指标</th>
                      <th className="px-4 py-2.5">全序列</th>
                      <th className="px-4 py-2.5">当前窗口</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 text-zinc-700">
                    <tr>
                      <td className="px-4 py-2">K 线根数</td>
                      <td className="px-4 py-2 font-mono">{etf.bars.length}</td>
                      <td className="px-4 py-2 font-mono">{winBt.barsWin.length}</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2">策略累计收益</td>
                      <td className="px-4 py-2 font-mono">{fullSummary.strategyReturnPct}%</td>
                      <td className="px-4 py-2 font-mono">{backSummary.strategyReturnPct}%</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2">买入持有（基准）</td>
                      <td className="px-4 py-2 font-mono">{fullSummary.buyHoldReturnPct}%</td>
                      <td className="px-4 py-2 font-mono">{backSummary.buyHoldReturnPct}%</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2">最大回撤</td>
                      <td className="px-4 py-2 font-mono">{fullSummary.maxDrawdownPct}%</td>
                      <td className="px-4 py-2 font-mono">{backSummary.maxDrawdownPct}%</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2">年化波动（日收益）</td>
                      <td className="px-4 py-2 font-mono">{fullSummary.annualVolPct}%</td>
                      <td className="px-4 py-2 font-mono">{backSummary.annualVolPct}%</td>
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

          <ChartCard
            title="价格、利差与买卖点"
            subtitle={`左轴：收盘；右轴：名义股息率 − 锚国债（%）；买卖点与 K 线对齐 · 下方 Brush（至少 ${MIN_WINDOW_BARS} 根 K 线）`}
          >
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart
                data={priceChartRows}
                margin={{ top: 8, right: spreadRows.length > 0 ? 50 : 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={28} />
                <YAxis yAxisId="left" domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={52} />
                {spreadRows.length > 0 && (
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 10 }}
                    width={44}
                    label={{ value: "利差%", angle: 90, position: "insideRight", fill: "#0f766e", fontSize: 10 }}
                  />
                )}
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: "1px solid #e4e4e7" }}
                  formatter={(value: number, name: string) => {
                    if (value == null || Number.isNaN(value)) return [null, name];
                    if (name === "利差") return [`${Number(value).toFixed(2)}%`, name];
                    return [typeof value === "number" ? Number(value).toFixed(4) : value, name];
                  }}
                />
                <Legend />
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
                {spreadRows.length > 0 && (
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="spread"
                    stroke="#0d9488"
                    dot={false}
                    strokeWidth={1.5}
                    name="利差"
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
                <Scatter
                  yAxisId="left"
                  name="买"
                  dataKey="buyMark"
                  fill="#059669"
                  shape={(p: { cx?: number; cy?: number }) => <BuyMarker cx={p.cx} cy={p.cy} />}
                />
                <Scatter
                  yAxisId="left"
                  name="卖"
                  dataKey="sellMark"
                  fill="#b91c1c"
                  shape={(p: { cx?: number; cy?: number }) => <SellMarker cx={p.cx} cy={p.cy} />}
                />
              </ComposedChart>
            </ResponsiveContainer>
            {spreadRows.length === 0 && (
              <p className="mt-2 text-xs text-zinc-500">
                当前标的无红利利差数据（非红利品类或未配置国债锚），仅展示价格与买卖点。
              </p>
            )}

            {barCount > MIN_WINDOW_BARS && brushData.length > 0 && (
              <div className="mt-4 rounded-xl border border-zinc-100 bg-zinc-50/80 px-2 py-2">
                <p className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                  全序列时间窗（拖动两端或整体平移）
                </p>
                <ResponsiveContainer width="100%" height={56}>
                  <ComposedChart data={brushData} margin={{ top: 2, right: 8, left: 0, bottom: 2 }}>
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
              <p className="mt-3 text-xs text-zinc-500">当前序列过短，不展示时间窗 Brush（至少需多于 {MIN_WINDOW_BARS} 根 K 线）。</p>
            )}
          </ChartCard>

          <ChartCard
            title="策略指标"
            subtitle={rsiMode ? "RSI 与阈值（与回测信号同源）" : "快慢均线（与回测信号同源）"}
          >
            <ResponsiveContainer width="100%" height={rsiMode ? 220 : 200}>
              <ComposedChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={28} />
                <YAxis
                  domain={rsiMode ? [0, 100] : ["auto", "auto"]}
                  tick={{ fontSize: 11 }}
                  width={rsiMode ? 36 : 48}
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
                {!rsiMode && (
                  <>
                    <Line
                      type="monotone"
                      dataKey="maFast"
                      stroke="#f59e0b"
                      dot={false}
                      strokeWidth={1.5}
                      name="MA 快"
                      connectNulls
                      isAnimationActive={false}
                    />
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
                  </>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
          <div className="rounded-3xl border border-zinc-100 bg-white overflow-hidden shadow-sm">
            <div className="border-b border-zinc-100 px-6 py-4">
              <h3 className="text-sm font-semibold text-zinc-900">明细数据（按完整轮次）</h3>
              <p className="mt-1 text-xs text-zinc-500">
                净值列为策略复利净值（每轮平仓后滚动）；单轮收益率为该轮买卖价差收益。
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">轮次</th>
                    <th className="px-4 py-3">买入日</th>
                    <th className="px-4 py-3">卖出日</th>
                    <th className="px-4 py-3">买入净值</th>
                    <th className="px-4 py-3">卖出净值</th>
                    <th className="px-4 py-3">买点触发</th>
                    <th className="px-4 py-3">卖点触发</th>
                    <th className="px-4 py-3">单轮收益 %</th>
                    <th className="px-4 py-3">持仓天数</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {rounds.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-zinc-500">
                        暂无完整买卖轮次
                      </td>
                    </tr>
                  ) : (
                    [...rounds].reverse().map((r) => (
                      <tr key={r.round} className="hover:bg-zinc-50/80">
                        <td className="px-4 py-2.5 font-mono text-zinc-600">{r.round}</td>
                        <td className="px-4 py-2.5 font-mono text-zinc-600">{r.buyDate}</td>
                        <td className="px-4 py-2.5 font-mono text-zinc-600">{r.sellDate}</td>
                        <td className="px-4 py-2.5">{r.buyNav}</td>
                        <td className="px-4 py-2.5">{r.sellNav}</td>
                        <td className="px-4 py-2.5 text-zinc-700 max-w-[200px] truncate" title={r.buyTrigger}>
                          {r.buyTrigger}
                        </td>
                        <td className="px-4 py-2.5 text-zinc-700 max-w-[200px] truncate" title={r.sellTrigger}>
                          {r.sellTrigger}
                        </td>
                        <td className="px-4 py-2.5 font-medium">{r.pnlPct}%</td>
                        <td className="px-4 py-2.5">{r.holdDays}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-100 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-zinc-900">最近买卖点（流水）</h3>
            <ul className="mt-4 divide-y divide-zinc-100 text-sm">
              {backtestTrades.slice(-8).map((t) => (
                <li key={`${t.date}-${t.side}`} className="flex flex-wrap justify-between gap-2 py-3">
                  <span className="font-mono text-zinc-500">{t.date}</span>
                  <span className={t.side === "BUY" ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>
                    {t.side}
                  </span>
                  <span className="text-zinc-600">{t.reason}</span>
                  {t.pnlPct != null && <span className="text-zinc-500">盈亏 {t.pnlPct}%</span>}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {tab === "intraday" && (
        <section className="space-y-6">
          <div className="rounded-3xl border border-zinc-100 bg-white p-8 shadow-sm space-y-5">
            <div>
              <h3 className="text-lg font-semibold text-zinc-900">今日盘中信号</h3>
              <p className="mt-1 text-sm text-zinc-500">
                选择策略参数后，用「模拟最新价」替换当日最后一根 K 的收盘，重算指标；<strong>分位数</strong>为当前指标值在<strong>历史全日样本</strong>（不含当日原收盘）中的经验分位。买入提示 ≤20%，卖出提示 ≥80%。
              </p>
            </div>
            {variants.length > 0 && (
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-zinc-400">策略参数</label>
                <select
                  className="mt-2 w-full max-w-md rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-900"
                  value={intraVariant?.key ?? ""}
                  onChange={(e) => setIntraVariantKey(e.target.value)}
                >
                  {variants.map((v) => (
                    <option key={v.key} value={v.key}>
                      {v.label} · {v.strategyId}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-4">
              <label className="text-sm text-zinc-600">
                模拟最新价（当日最后一根 K）
                <input
                  type="range"
                  min={lastClose * 0.95}
                  max={lastClose * 1.05}
                  step={0.001}
                  value={snapClose ?? lastClose}
                  onChange={(e) => setSnapClose(Number(e.target.value))}
                  className="block w-full mt-2 accent-indigo-600"
                />
              </label>
              <button
                type="button"
                onClick={() => setSnapClose(lastClose * (0.98 + Math.random() * 0.04))}
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                随机模拟价
              </button>
            </div>
            <p className="font-mono text-2xl font-semibold text-indigo-700">{(snapClose ?? lastClose).toFixed(4)}</p>
            {intraPct && (
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 px-5 py-4">
                <p className="text-xs font-medium uppercase tracking-wide text-indigo-800/80">指标分位与区间</p>
                <p className="mt-2 text-lg font-semibold text-indigo-950">{intraPct.hint}</p>
                <p className="mt-2 text-sm text-indigo-900/90">
                  {intraPct.metricName} = <span className="font-mono font-semibold">{intraPct.metricValue}</span>
                  <span className="text-zinc-600"> · 历史分位 </span>
                  <span className="font-mono font-semibold">{intraPct.percentile}%</span>
                </p>
              </div>
            )}
            <p className="text-sm text-zinc-600">
              离散信号（BUY/SELL/HOLD）：<span className="font-semibold text-zinc-900">{latestSignal(intraSignals)}</span>
            </p>
            <p className="text-xs text-amber-800 bg-amber-50 rounded-xl px-3 py-2">
              演示用途：正式环境应由服务端在固定时点写入快照价；分位阈值（20% / 80%）可按产品再调参。
            </p>
          </div>
        </section>
      )}

      {tab === "ledger" && (
        <section className="rounded-3xl border border-zinc-100 bg-white overflow-hidden shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-6 py-4">日期</th>
                <th className="px-6 py-4">方向</th>
                <th className="px-6 py-4">策略指标值</th>
                <th className="px-6 py-4">原因</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {fullTrades.slice(-12).map((t, i) => (
                <tr key={`${t.date}-${t.side}-${i}`} className="hover:bg-zinc-50/80">
                  <td className="px-6 py-3 font-mono text-zinc-600">{t.date}</td>
                  <td className="px-6 py-3 font-medium">{t.side}</td>
                  <td className="px-6 py-3 font-mono text-zinc-700">
                    {activeVariant
                      ? indicatorValueLabelAtDate(etf.bars, activeVariant.params, activeVariant.strategyId, t.date)
                      : "—"}
                  </td>
                  <td className="px-6 py-3 text-zinc-600">{t.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "dividend" && showDividendModule && (
        <section className="space-y-6">
          <div className="rounded-3xl border border-zinc-100 bg-white p-6 shadow-sm text-sm text-zinc-600">
            <p>
              名义股息率 <strong>{etf.meta.div_yield_nominal_pct}%</strong> · 来源{" "}
              <strong>{etf.meta.div_yield_source}</strong>
              {anchor && (
                <>
                  {" "}
                  · 锚 <strong>{anchor === "CN_10Y" ? "中国 10Y" : "美国 10Y"}</strong>
                </>
              )}
            </p>
          </div>
          <ChartCard title="股息率、国债收益率与利差" subtitle="解释层，不参与信号">
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={tripleData.slice(-120)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={20} />
                <YAxis tick={{ fontSize: 11 }} width={40} />
                <Tooltip contentStyle={{ borderRadius: 12 }} />
                <Legend />
                <Line type="monotone" dataKey="股息率" stroke="#4f46e5" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="国债" stroke="#71717a" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="利差" stroke="#0d9488" dot={false} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="利差与价格" subtitle="双轴 · V1 必含">
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={spreadPriceData.slice(-120)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={20} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} width={44} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} width={44} />
                <Tooltip contentStyle={{ borderRadius: 12 }} />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="价格" stroke="#18181b" dot={false} strokeWidth={2} />
                <Line yAxisId="right" type="monotone" dataKey="利差" stroke="#6366f1" dot={false} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
        </section>
      )}

      {tab === "hk" && showHk && (
        <section className="rounded-3xl border border-zinc-100 bg-white p-8 shadow-sm space-y-4 text-sm">
          <h3 className="text-lg font-semibold text-zinc-900">港股税后股息（解释层）</h3>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-zinc-400">通道</dt>
              <dd className="font-medium">{etf.meta.investor_channel}</dd>
            </div>
            <div>
              <dt className="text-zinc-400">名义 / 税后（估）</dt>
              <dd className="font-medium">
                {etf.meta.div_yield_nominal_pct}% / {etf.meta.div_yield_after_tax_est_pct}%
              </dd>
            </div>
            <div>
              <dt className="text-zinc-400">币种</dt>
              <dd className="font-medium">{etf.meta.fx_ccy}</dd>
            </div>
          </dl>
          <p className="text-zinc-500 text-xs leading-relaxed">{etf.meta.tax_assumption_note}</p>
          {anchor === "US_10Y" && etf.meta.div_yield_after_tax_est_pct != null && (
            <p className="text-xs text-zinc-600">
              税后相对美国 10Y 利差（示意）：
              <span className="font-semibold text-indigo-700">
                {(etf.meta.div_yield_after_tax_est_pct - (spreadRows[spreadRows.length - 1]?.bondYieldPct ?? 0)).toFixed(2)}%
              </span>
            </p>
          )}
          <ul className="flex flex-wrap gap-3">
            {etf.meta.doc_links?.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="text-indigo-600 text-xs font-medium hover:underline" target="_blank" rel="noreferrer">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "methodology" && (
        <section className="rounded-3xl border border-zinc-100 bg-white shadow-sm">
          <details open className="group p-8">
            <summary className="cursor-pointer text-lg font-semibold text-zinc-900 list-none flex justify-between items-center">
              指数与编制（解释）
              <span className="text-zinc-400 text-sm font-normal">展开 / 收起</span>
            </summary>
            <div className="mt-6 space-y-4 text-sm text-zinc-600 leading-relaxed">
              <p>
                <strong>价格指数与全收益</strong>：展示回测与绩效时须标明对标净值/价格指数/全收益指数，三者不可混用。红利长期回报中股息再投资占比较高。
              </p>
              <p>
                <strong>调样与权重</strong>：定期调样可能带来短期净值波动；本区仅作解释，不修改已注册策略参数。
              </p>
              <p>
                <strong>防价值陷阱</strong>：关注连续分红、股利支付率区间、盈利质量；高股息若来自盈利下滑需警惕。
              </p>
              <p className="text-xs text-zinc-400">本产品不展示折溢价、跟踪误差（按产品决策排除）。</p>
            </div>
          </details>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-100 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">{label}</p>
      {hint ? <p className="mt-0.5 text-[10px] leading-snug text-zinc-400">{hint}</p> : null}
      <p className="mt-2 text-xl font-semibold text-zinc-900">{value}</p>
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

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-zinc-100 bg-white p-6 shadow-sm">
      <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      {subtitle && <p className="text-xs text-zinc-500 mt-1">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}
