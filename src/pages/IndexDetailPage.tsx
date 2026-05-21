import { useDeferredValue, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  Brush,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useDataSource } from "../context/DataSourceContext";
import {
  bondAnchorForIndexMarket,
  buildIndexSpreadRows,
  indexHasPriceSeries,
  indexSeriesForMode,
  indexShowsSpread,
} from "../data/indexCsv";
import { dividendAllocationObservation } from "../lib/configFramework";
import {
  METRIC_WINDOWS,
  buildMetricRow,
  buildPercentileHistogram,
  calcMetricBlock,
  cumulativeReturnSeries,
  type DateValuePoint,
  type MetricWindowId,
} from "../lib/indexPanelMetrics";

const MIN_BRUSH_POINTS = 30;
const DEFAULT_LINE_KEYS = ["price", "tri", "hs300"] as const;
const QUICK_RANGES = [
  { id: "1m", label: "一月", months: 1 },
  { id: "3m", label: "三月", months: 3 },
  { id: "ytd", label: "年至今", ytd: true },
  { id: "1y", label: "一年", years: 1 },
  { id: "3y", label: "三年", years: 3 },
  { id: "5y", label: "五年", years: 5 },
  { id: "all", label: "全部" },
] as const;
const RETURN_WINDOWS: MetricWindowId[] = ["m1", "m3", "ytd", "y1", "y3", "y5"];
const ANNUAL_WINDOWS: MetricWindowId[] = ["y1", "y3", "y5"];
const COMPARE_COLORS = ["#7c3aed", "#f59e0b", "#0891b2", "#16a34a", "#be185d", "#475569", "#ea580c"];
const SPREAD_LINE_KEYS = ["股息率", "国债收益率", "利差", "价格"] as const;

type SpreadLineKey = (typeof SPREAD_LINE_KEYS)[number];

function clampWindow(len: number, start: number, end: number): { start: number; end: number } {
  if (len <= 0) return { start: 0, end: 0 };
  const s = Math.max(0, Math.min(len - 1, Math.floor(start)));
  const e = Math.max(s, Math.min(len - 1, Math.floor(end)));
  return { start: s, end: e };
}

function fmtPct(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(2)}%` : "—";
}

function fmtRawValue(v: unknown): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : "—";
}

function fmtNum(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : "—";
}

function percentileTone(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  if (v >= 80) return "高位";
  if (v >= 60) return "偏高";
  if (v > 40) return "中位";
  if (v > 20) return "偏低";
  return "低位";
}


function dateShift(date: string, opts: { days?: number; months?: number; years?: number; ytd?: boolean }) {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  if (opts.ytd) return `${date.slice(0, 4)}-01-01`;
  if (opts.days) d.setDate(d.getDate() - opts.days);
  if (opts.months) d.setMonth(d.getMonth() - opts.months);
  if (opts.years) d.setFullYear(d.getFullYear() - opts.years);
  return d.toISOString().slice(0, 10);
}

function nearestDateIndex(series: DateValuePoint[], date: string) {
  const i = series.findIndex((p) => p.date >= date);
  return i < 0 ? Math.max(0, series.length - 1) : i;
}

function metaText(meta: unknown, key: string): string | undefined {
  const v = (meta as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v : undefined;
}

function sampledBrushData(series: DateValuePoint[], maxPoints = 320) {
  if (series.length <= maxPoints) return series;
  const step = Math.ceil(series.length / maxPoints);
  const out = series.filter((_, i) => i % step === 0);
  const last = series.at(-1);
  if (last && out.at(-1)?.date !== last.date) out.push(last);
  return out;
}

function shortIndexName(name: string) {
  return name.replace(/^中证/, "").replace(/指数$/, "");
}

function signedPct(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "▲" : v < 0 ? "▼" : "";
  return `${sign}${Math.abs(v).toFixed(2)}`;
}

function signedClass(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v) || v === 0) return "text-zinc-900";
  return v > 0 ? "text-red-500" : "text-emerald-600";
}

function PercentileMeter({ label, value, percentile }: { label: string; value: number | null; percentile: number | null }) {
  const pct = typeof percentile === "number" && Number.isFinite(percentile) ? Math.max(0, Math.min(100, percentile)) : null;
  return (
    <div className="rounded-2xl border border-zinc-100 bg-zinc-50/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-zinc-500">{label}</p>
          <p className="mt-1 font-mono text-xl font-semibold text-zinc-900">{fmtPct(value)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-zinc-500">历史分位</p>
          <p className="mt-1 font-mono text-lg font-semibold text-indigo-600">{fmtPct(pct)}</p>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200">
        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct ?? 0}%` }} />
      </div>
      <p className="mt-2 text-xs text-zinc-500">{percentileTone(pct)}</p>
    </div>
  );
}

function lineKeyForIndex(code: string) {
  return `cmp_${code.replace(/[^A-Za-z0-9]/g, "_")}`;
}

function defaultVisibleLines() {
  return new Set<string>(DEFAULT_LINE_KEYS);
}

type MarketTooltipProps = {
  active?: boolean;
  label?: string | number;
  payload?: Array<{
    color?: string;
    dataKey?: string | number;
    name?: string | number;
    payload?: Record<string, unknown>;
  }>;
};

function MarketTooltip({ active, label, payload }: MarketTooltipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-mono font-semibold text-slate-900">{label}</p>
      <div className="space-y-1">
        {payload.map((item) => {
          const key = String(item.dataKey ?? "");
          const rawKey = `${key}Raw`;
          return (
            <div key={key} className="flex min-w-[180px] items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-slate-600">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                {item.name}
              </span>
              <span className="font-mono text-slate-950">{fmtRawValue(row[rawKey])}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function IndexDetailPage() {
  const { indexCode: indexCodeParam } = useParams();
  const raw = indexCodeParam ? decodeURIComponent(indexCodeParam) : "";
  const { getIndex, indices, indexTracking, bondByDate, publicCsvAutoLoading } = useDataSource();
  const def = raw ? getIndex(raw) : undefined;
  const [perfStartDateOverride, setPerfStartDateOverride] = useState<string | null>(null);
  const [perfEndDateOverride, setPerfEndDateOverride] = useState<string | null>(null);
  const [quickRange, setQuickRange] = useState<string>("all");
  const [compareCodes, setCompareCodes] = useState<string[]>([]);
  const [compareCandidate, setCompareCandidate] = useState("");
  const [visibleLineKeys, setVisibleLineKeys] = useState<Set<string>>(() => defaultVisibleLines());
  const [visibleSpreadLineKeys, setVisibleSpreadLineKeys] = useState<Set<SpreadLineKey>>(() => new Set(SPREAD_LINE_KEYS));

  const trackingRows = useMemo(
    () => indexTracking.filter((t) => t.index_code === def?.meta.index_code),
    [indexTracking, def?.meta.index_code]
  );

  const hasBars = Boolean(def?.bars.length);
  const priceLabel = shortIndexName(def?.meta.name ?? "");
  const triLabel = `${priceLabel}全收益`;

  const triSeries = useMemo<DateValuePoint[]>(
    () => (def ? indexSeriesForMode(def.bars, "tri").filter((p) => Number.isFinite(p.value) && p.value > 0) : []),
    [def]
  );
  const priceSeries = useMemo<DateValuePoint[]>(
    () => (def ? indexSeriesForMode(def.bars, "price").filter((p) => Number.isFinite(p.value) && p.value > 0) : []),
    [def]
  );
  const hs300 = useMemo(() => indices.find((ix) => ix.meta.index_code === "000300"), [indices]);
  const hs300Series = useMemo<DateValuePoint[]>(
    () => (hs300 ? indexSeriesForMode(hs300.bars, "tri").filter((p) => Number.isFinite(p.value) && p.value > 0) : []),
    [hs300]
  );
  const compareOptions = useMemo(
    () =>
      indices
        .filter((ix) => ix.bars.length > 0 && ix.meta.index_code !== def?.meta.index_code && !compareCodes.includes(ix.meta.index_code))
        .sort((a, b) => a.meta.name.localeCompare(b.meta.name, "zh-Hans-CN")),
    [indices, def?.meta.index_code, compareCodes]
  );
  const compareSeriesDefs = useMemo(
    () =>
      compareCodes.flatMap((code, i) => {
        const ix = indices.find((item) => item.meta.index_code === code);
        if (!ix) return [];
        const mode = indexHasPriceSeries(ix.bars) ? "price" : "tri";
        const series = indexSeriesForMode(ix.bars, mode).filter((p) => Number.isFinite(p.value) && p.value > 0);
        if (!series.length) return [];
        return [
          {
            key: lineKeyForIndex(code),
            code,
            name: shortIndexName(ix.meta.name),
            color: COMPARE_COLORS[i % COMPARE_COLORS.length]!,
            series,
          },
        ];
      }),
    [compareCodes, indices]
  );
  const lineDefs = useMemo(
    () => [
      { key: "price", code: def?.meta.index_code ?? "", name: priceLabel, color: "#164ba3", series: priceSeries },
      { key: "tri", code: def?.meta.index_code ?? "", name: triLabel, color: "#e00012", series: triSeries },
      { key: "hs300", code: "000300", name: "沪深300", color: "#8b95a7", series: hs300Series },
      ...compareSeriesDefs,
    ],
    [def?.meta.index_code, priceLabel, triLabel, priceSeries, triSeries, hs300Series, compareSeriesDefs]
  );
  const visibleLineDefs = useMemo(
    () => lineDefs.filter((line) => visibleLineKeys.has(line.key)),
    [lineDefs, visibleLineKeys]
  );
  const colorByLineKey = useMemo(() => new Map(visibleLineDefs.map((line) => [line.key, line.color])), [visibleLineDefs]);
  const perfDates = useMemo(() => triSeries.map((p) => p.date), [triSeries]);
  const brushPreview = useMemo(() => sampledBrushData(triSeries), [triSeries]);
  const fullPerf = useMemo(() => calcMetricBlock(triSeries), [triSeries]);
  const firstPerfDate = perfDates[0];
  const lastPerfDate = perfDates.at(-1);
  const perfStartDate = perfStartDateOverride ?? firstPerfDate;
  const perfEndDate = perfEndDateOverride ?? lastPerfDate;
  const perfWindow = useMemo(() => {
    const start = perfStartDate ? nearestDateIndex(brushPreview, perfStartDate) : 0;
    const end = perfEndDate ? nearestDateIndex(brushPreview, perfEndDate) : Math.max(0, brushPreview.length - 1);
    return start <= end ? clampWindow(brushPreview.length, start, end) : clampWindow(brushPreview.length, end, start);
  }, [brushPreview, perfStartDate, perfEndDate]);
  const latestDate = lastPerfDate ?? def?.bars.at(-1)?.date ?? "—";
  const deferredPerfStartDate = useDeferredValue(perfStartDate);
  const deferredPerfEndDate = useDeferredValue(perfEndDate);
  const cumulativeData = useMemo(() => {
    const dates = perfDates.filter(
      (date) =>
        (!deferredPerfStartDate || date >= deferredPerfStartDate) &&
        (!deferredPerfEndDate || date <= deferredPerfEndDate)
    );
    const seriesMap = Object.fromEntries(visibleLineDefs.map((line) => [line.key, line.series]));
    const rawMaps = Object.fromEntries(
      visibleLineDefs.map((line) => [line.key, new Map(line.series.map((p) => [p.date, p.value]))])
    ) as Record<string, Map<string, number>>;
    return cumulativeReturnSeries(seriesMap, dates).map((row) => {
      const date = String(row.date);
      const withRaw = { ...row };
      for (const line of visibleLineDefs) {
        withRaw[`${line.key}Raw`] = rawMaps[line.key]?.get(date) ?? null;
      }
      return withRaw;
    });
  }, [perfDates, deferredPerfStartDate, deferredPerfEndDate, visibleLineDefs]);
  const metricRows = useMemo(
    () => visibleLineDefs.map((line) => buildMetricRow(line.key, line.name, line.series)),
    [visibleLineDefs]
  );

  const shouldShowSpreadModule = Boolean(def && hasBars && indexShowsSpread(def.meta.category));
  const spreadRows = useMemo(
    () => (def && shouldShowSpreadModule ? buildIndexSpreadRows(def, bondByDate) : []),
    [def, shouldShowSpreadModule, bondByDate]
  );
  const priceByDate = useMemo(() => new Map(priceSeries.map((p) => [p.date, p.value])), [priceSeries]);
  const triByDate = useMemo(() => new Map(triSeries.map((p) => [p.date, p.value])), [triSeries]);

  const tripleData = useMemo(
    () =>
      spreadRows
        .filter(
          (r) =>
            (!deferredPerfStartDate || r.date >= deferredPerfStartDate) &&
            (!deferredPerfEndDate || r.date <= deferredPerfEndDate)
        )
        .map((r) => ({
          date: r.date,
          股息率: r.divYieldPct,
          国债收益率: r.bondYieldPct,
          利差: r.spreadPct,
          价格: priceByDate.get(r.date) ?? triByDate.get(r.date) ?? null,
        })),
    [spreadRows, deferredPerfStartDate, deferredPerfEndDate, priceByDate, triByDate]
  );
  const dividendHistogram = useMemo(
    () => buildPercentileHistogram(spreadRows.map((r) => r.divYieldPct), 12),
    [spreadRows]
  );
  const bondHistogram = useMemo(
    () => buildPercentileHistogram(spreadRows.map((r) => r.bondYieldPct), 12),
    [spreadRows]
  );
  const spreadHistogram = useMemo(
    () => buildPercentileHistogram(spreadRows.map((r) => r.spreadPct), 12),
    [spreadRows]
  );
  const latestSpreadPoint = spreadRows.at(-1);
  const pctAxisMax = useMemo(() => {
    const values = tripleData.flatMap((r) => [r.股息率, r.国债收益率, r.利差]).filter((v) => Number.isFinite(v));
    return Math.max(5.5, Math.ceil(Math.max(...values, 0) + 0.5));
  }, [tripleData]);
  const pctAxisMin = useMemo(() => {
    const values = tripleData.flatMap((r) => [r.股息率, r.国债收益率, r.利差]).filter((v) => Number.isFinite(v));
    return Math.min(0, Math.floor(Math.min(...values, 0) - 0.5));
  }, [tripleData]);
  const allocationAdvice = dividendAllocationObservation(
    latestSpreadPoint?.spreadPct,
    latestSpreadPoint?.divYieldPct
  );

  if (!def) {
    if (raw && (publicCsvAutoLoading || indices.length === 0)) {
      return (
        <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-8 text-sm text-zinc-500">
          正在加载指数数据…
        </div>
      );
    }
    return <Navigate to="/indices" replace />;
  }

  const anchor = bondAnchorForIndexMarket(def.meta.market);
  const primaryTracking = trackingRows[0];
  const bondLabel = anchor === "CN_10Y" ? "中国 10 年期国债收益率（%）" : "美国 10 年期国债收益率（%）";
  const baseDate = metaText(def.meta, "base_date");
  const launchDate = metaText(def.meta, "launch_date") ?? def.meta.inception_date;
  const weightingMethod = metaText(def.meta, "weighting_method");
  const methodologySummary = metaText(def.meta, "methodology_summary") ?? "（未提供 methodology_summary）";
  function applyQuickRange(range: (typeof QUICK_RANGES)[number]) {
    if (!lastPerfDate) return;
    setQuickRange(range.id);
    if (range.id === "all") {
      setPerfStartDateOverride(null);
      setPerfEndDateOverride(null);
      return;
    }
    setPerfStartDateOverride(dateShift(lastPerfDate, range));
    setPerfEndDateOverride(lastPerfDate);
  }

  function applyDateRange(startDate: string | undefined, endDate: string | undefined) {
    if (!firstPerfDate || !lastPerfDate || !startDate || !endDate) return;
    const start = startDate < firstPerfDate ? firstPerfDate : startDate;
    const end = endDate > lastPerfDate ? lastPerfDate : endDate;
    setQuickRange("custom");
    if (start <= end) {
      setPerfStartDateOverride(start);
      setPerfEndDateOverride(end);
    } else {
      setPerfStartDateOverride(end);
      setPerfEndDateOverride(start);
    }
  }

  function removeLine(line: { key: string; code: string }) {
    setVisibleLineKeys((keys) => {
      const next = new Set(keys);
      next.delete(line.key);
      return next;
    });
    if (!DEFAULT_LINE_KEYS.includes(line.key as (typeof DEFAULT_LINE_KEYS)[number])) {
      setCompareCodes((codes) => codes.filter((item) => item !== line.code));
    }
  }

  function toggleSpreadLine(dataKey: unknown) {
    const key = String(dataKey);
    if (!(SPREAD_LINE_KEYS as readonly string[]).includes(key)) return;
    setVisibleSpreadLineKeys((keys) => {
      const next = new Set(keys);
      if (next.has(key as SpreadLineKey)) next.delete(key as SpreadLineKey);
      else next.add(key as SpreadLineKey);
      return next;
    });
  }

  function resetMarketView() {
    applyQuickRange(QUICK_RANGES[6]!);
    setCompareCodes([]);
    setCompareCandidate("");
    setVisibleLineKeys(defaultVisibleLines());
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/indices" className="text-sm font-medium text-indigo-600 hover:underline">
            ← 指数列表
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-900">{def.meta.name}</h1>
          <p className="mt-1 font-mono text-sm text-zinc-500">{def.meta.index_code}</p>
          <p className="mt-2 text-xs text-zinc-500">
            本页图表与绩效<strong>仅使用 index_bars 指数序列</strong>；无指数行情时下方不展示曲线与数值指标。
          </p>
          {primaryTracking ?
            <p className="mt-3 text-sm">
              <span className="text-zinc-500">主跟踪产品（仅链接）：</span>
              <Link
                to={`/etf/${encodeURIComponent(primaryTracking.etf_code)}`}
                className="font-mono font-semibold text-indigo-600 hover:underline"
              >
                {primaryTracking.etf_code}
              </Link>
            </p>
          : null}
        </div>
      </div>

      <section className="rounded-3xl border border-zinc-100 bg-white p-6 shadow-sm space-y-3">
        <h2 className="text-lg font-semibold text-zinc-900">基本信息</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <dt className="text-xs text-zinc-500">指数名称</dt>
            <dd className="mt-1 font-medium text-zinc-900">{def.meta.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">代码</dt>
            <dd className="mt-1 font-mono text-zinc-900">{def.meta.index_code}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">基期</dt>
            <dd className="mt-1 font-mono text-zinc-900">{baseDate ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">启用日期</dt>
            <dd className="mt-1 font-mono text-zinc-900">{launchDate ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">加权方式</dt>
            <dd className="mt-1 text-zinc-900">{weightingMethod ?? "—"}</dd>
          </div>
        </dl>
        <p className="text-sm text-zinc-600 leading-relaxed whitespace-pre-wrap">
          {methodologySummary}
        </p>
        {def.meta.methodology_url ?
          <a
            href={def.meta.methodology_url}
            className="inline-block text-sm font-medium text-indigo-600 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            官方文档链接
          </a>
        : null}
      </section>

      {hasBars ?
        <>
          <section className="rounded-3xl border border-zinc-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-900">绩效（全样本）</h2>
            <p className="mt-1 text-xs text-zinc-500">
              当前使用全收益序列；波动率为日收益按 252 个交易日折算的年化波动率。
            </p>
            <dl className="mt-4 grid gap-4 sm:grid-cols-3 text-sm">
              <div>
                <dt className="text-zinc-500">年化收益率</dt>
                <dd className="mt-1 text-xl font-semibold text-zinc-900">
                  {fmtPct(fullPerf.annualReturnPct)}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">最大回撤</dt>
                <dd className="mt-1 text-xl font-semibold text-zinc-900">
                  {fmtPct(fullPerf.maxDrawdownPct)}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">年化波动率</dt>
                <dd className="mt-1 text-xl font-semibold text-zinc-900">
                  {fmtPct(fullPerf.annualVolPct)}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-5 py-4 xl:flex-nowrap">
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-sm font-medium text-slate-900">
                {QUICK_RANGES.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => applyQuickRange(r)}
                    className={`min-w-12 rounded-md px-2 py-1.5 transition ${
                      quickRange === r.id ? "bg-blue-50 text-blue-900" : "text-slate-900 hover:bg-zinc-50"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <div className="flex shrink-0 items-center gap-2 rounded-md border border-zinc-200 bg-white px-2.5 py-2 font-mono text-sm text-zinc-600">
                <input
                  type="date"
                  value={perfStartDate ?? ""}
                  min={firstPerfDate}
                  max={perfEndDate ?? brushPreview.at(-1)?.date}
                  onChange={(e) => applyDateRange(e.target.value, perfEndDate)}
                  className="w-[128px] bg-transparent text-zinc-700 outline-none"
                />
                <span className="text-zinc-400">至</span>
                <input
                  type="date"
                  value={perfEndDate ?? ""}
                  min={perfStartDate ?? firstPerfDate}
                  max={lastPerfDate}
                  onChange={(e) => applyDateRange(perfStartDate, e.target.value)}
                  className="w-[128px] bg-transparent text-zinc-700 outline-none"
                />
              </div>
              <p className="shrink-0 text-sm text-zinc-400">更新日期: {latestDate}</p>
              <div className="flex min-w-[220px] flex-1 items-center justify-end">
                <select
                  value={compareCandidate}
                  onChange={(e) => {
                    const code = e.target.value;
                    setCompareCandidate(code);
                    if (!code || compareCodes.includes(code)) return;
                    setCompareCodes((codes) => [...codes, code]);
                    setVisibleLineKeys((keys) => new Set(keys).add(lineKeyForIndex(code)));
                    setCompareCandidate("");
                  }}
                  className="w-full max-w-[280px] rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-slate-700"
                >
                  <option value="">指数比较</option>
                  {compareOptions.map((ix) => (
                    <option key={ix.meta.index_code} value={ix.meta.index_code}>
                      {ix.meta.name}（{ix.meta.index_code}）
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
              {visibleLineDefs.map((line) => (
                <span
                  key={line.key}
                  className="inline-flex items-center gap-2 rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-900"
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: line.color }} />
                  {line.name}
                  <button
                    type="button"
                    onClick={() => removeLine(line)}
                    className="ml-1 text-base leading-none text-slate-400 hover:text-slate-800"
                    aria-label={`删除 ${line.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={resetMarketView}
                className="rounded-md bg-slate-50 px-3 py-1.5 text-sm font-medium text-blue-900"
              >
                重置
              </button>
            </div>
            <div className="h-[390px] w-full px-5 pt-5">
              {cumulativeData.length > 1 ?
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={cumulativeData}>
                    <CartesianGrid stroke="#dbe3f0" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: "#6b7280" }} minTickGap={52} axisLine={{ stroke: "#d1d5db" }} />
                    <YAxis
                      tick={{ fontSize: 12, fill: "#6b7280" }}
                      width={64}
                      domain={["auto", "auto"]}
                      tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<MarketTooltip />} />
                    {visibleLineDefs.map((line) => (
                      <Line
                        key={line.key}
                        type="monotone"
                        dataKey={line.key}
                        name={line.name}
                        stroke={line.color}
                        dot={false}
                        strokeWidth={DEFAULT_LINE_KEYS.includes(line.key as (typeof DEFAULT_LINE_KEYS)[number]) ? 1.8 : 1.6}
                        connectNulls
                        isAnimationActive={false}
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              : (
                <p className="text-sm text-zinc-500">数据不足以绘制曲线。</p>
              )}
            </div>
            {perfDates.length > MIN_BRUSH_POINTS ?
              <div className="px-5 pb-5">
                <ResponsiveContainer width="100%" height={56}>
                <ComposedChart data={brushPreview}>
                  <XAxis dataKey="date" hide />
                  <YAxis hide domain={["auto", "auto"]} />
                  <Line type="monotone" dataKey="value" stroke="#8fb4ff" strokeWidth={1} dot={false} isAnimationActive={false} />
                    <Brush
                    dataKey="date"
                      height={34}
                      stroke="#9db8e8"
                      fill="#dbeafe"
                      travellerWidth={9}
                      startIndex={perfWindow.start}
                      endIndex={perfWindow.end}
                      onChange={(e: { startIndex?: number; endIndex?: number }) => {
                        const c = clampWindow(brushPreview.length, e.startIndex ?? 0, e.endIndex ?? brushPreview.length - 1);
                        setQuickRange("custom");
                        setPerfStartDateOverride(brushPreview[c.start]?.date ?? null);
                        setPerfEndDateOverride(brushPreview[c.end]?.date ?? null);
                      }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            : null}
          </section>

          <section className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[920px] table-fixed text-xs text-slate-950 xl:min-w-0">
              <thead>
                <tr className="border-b border-zinc-200 bg-slate-100/80 text-sm font-semibold">
                  <th className="w-[160px] px-3 py-3 text-left"></th>
                  <th className="border-l border-zinc-200 px-2 py-3 text-center" colSpan={RETURN_WINDOWS.length}>阶段性收益（%）</th>
                  <th className="border-l border-zinc-200 px-2 py-3 text-center" colSpan={ANNUAL_WINDOWS.length}>年化收益（%）</th>
                  <th className="border-l border-zinc-200 px-2 py-3 text-center" colSpan={ANNUAL_WINDOWS.length}>年化波动率（%）</th>
                </tr>
                <tr className="border-b border-zinc-200 bg-slate-100/80 font-semibold">
                  <th className="px-3 py-3 text-left font-mono">{latestDate}</th>
                  {RETURN_WINDOWS.map((id) => (
                    <th key={id} className="border-l border-zinc-200 px-2 py-3 text-center">{METRIC_WINDOWS.find((w) => w.id === id)?.label}</th>
                  ))}
                  {ANNUAL_WINDOWS.map((id) => (
                    <th key={`ann-${id}`} className="border-l border-zinc-200 px-2 py-3 text-center">{METRIC_WINDOWS.find((w) => w.id === id)?.label}</th>
                  ))}
                  {ANNUAL_WINDOWS.map((id) => (
                    <th key={`vol-${id}`} className="border-l border-zinc-200 px-2 py-3 text-center">{METRIC_WINDOWS.find((w) => w.id === id)?.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {metricRows.map((row) => (
                  <tr key={row.id}>
                    <td className="truncate px-3 py-3 font-medium" title={row.label}>
                      <span
                        className="mr-3 inline-block h-3 w-3 rounded-full"
                        style={{ backgroundColor: colorByLineKey.get(row.id) ?? "#94a3b8" }}
                      />
                      {row.label}
                    </td>
                    {RETURN_WINDOWS.map((id) => {
                      const v = row.windows[id].totalReturnPct;
                      return <td key={id} className={`px-2 py-3 text-center font-mono ${signedClass(v)}`}>{signedPct(v)}</td>;
                    })}
                    {ANNUAL_WINDOWS.map((id) => {
                      const v = row.windows[id].annualReturnPct;
                      return <td key={`ann-${id}`} className={`px-2 py-3 text-center font-mono ${signedClass(v)}`}>{signedPct(v)}</td>;
                    })}
                    {ANNUAL_WINDOWS.map((id) => (
                      <td key={`vol-${id}`} className="px-2 py-3 text-center font-mono">{fmtNum(row.windows[id].annualVolPct)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      : (
        <section className="rounded-3xl border border-amber-100 bg-amber-50/80 p-6 text-sm text-amber-950">
          <p className="font-medium">暂无指数日序列</p>
          <p className="mt-2 text-amber-900/90">
            请在 <code className="rounded bg-white/70 px-1">index_bars.csv</code> 中为该{" "}
            <code className="rounded bg-white/70 px-1">index_code</code> 提供 <code className="rounded bg-white/70 px-1">tri_close</code>{" "}
            等列；本页不读取 ETF 行情作替代。
          </p>
        </section>
      )}

      {shouldShowSpreadModule ?
        <section className="rounded-3xl border border-zinc-100 bg-white p-6 shadow-sm space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">红利配置参考：股息率、利差与价格</h2>
            <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
              <strong>{def.meta.market === "A" ? "A 股" : "港股"}</strong>指数：股息率与 <strong>{bondLabel}</strong>{" "}
              对齐至同一交易日。时间窗与上方市场表现图联动；数据仅来自 index_bars / bonds，不含 ETF。
              <span className="block mt-1 text-amber-800/90">仅作配置观察参考，非投资建议，非交易信号。</span>
            </p>
          </div>
          {spreadRows.length > 0 ?
            <>
              <div className="grid gap-3 md:grid-cols-4">
                <div className={`rounded-2xl border p-4 md:col-span-2 ${allocationAdvice.tone}`}>
                  <p className="text-sm font-semibold">{allocationAdvice.title}</p>
                  <p className="mt-2 text-xs leading-relaxed">{allocationAdvice.body}</p>
                </div>
                <div className="rounded-2xl border border-zinc-100 bg-zinc-50/70 p-4">
                  <p className="text-xs text-zinc-500">当前股息率</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-zinc-900">{fmtPct(latestSpreadPoint?.divYieldPct)}</p>
                  <p className="mt-2 text-xs text-zinc-500">股息率越高，红利资产的现金回报吸引力越强</p>
                </div>
                <div className="rounded-2xl border border-zinc-100 bg-zinc-50/70 p-4">
                  <p className="text-xs text-zinc-500">当前股债利差</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-zinc-900">{fmtPct(latestSpreadPoint?.spreadPct)}</p>
                  <p className="mt-2 text-xs text-zinc-500">利差越高，红利相对债券的补偿越充分</p>
                </div>
              </div>

              <div className="h-[330px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={tripleData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={20} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} width={58} domain={["auto", "auto"]} label={{ value: "价格", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "#71717a" } }} />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 11 }}
                      width={58}
                      domain={[pctAxisMin, pctAxisMax]}
                      tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
                      label={{ value: "收益率 / 利差", angle: 90, position: "insideRight", style: { fontSize: 11, fill: "#71717a" } }}
                    />
                    <Tooltip contentStyle={{ borderRadius: 12 }} />
                    <ReferenceArea yAxisId="right" y1={pctAxisMin} y2={1} fill="#e5e7eb" fillOpacity={0.25} label={{ value: "利差警惕区 <1%", fontSize: 10, fill: "#71717a" }} />
                    <ReferenceArea yAxisId="right" y1={2.5} y2={pctAxisMax} fill="#dcfce7" fillOpacity={0.18} label={{ value: "利差配置区 ≥2.5%", fontSize: 10, fill: "#047857" }} />
                    <ReferenceArea yAxisId="right" y1={5.5} y2={pctAxisMax} fill="#fee2e2" fillOpacity={0.14} label={{ value: "股息率高位 ≥5.5%", fontSize: 10, fill: "#dc2626" }} />
                    {latestSpreadPoint?.date ?
                      <ReferenceLine yAxisId="right" x={latestSpreadPoint.date} stroke="#dc2626" strokeDasharray="4 4" label={{ value: "当前", position: "top", fontSize: 11, fill: "#dc2626" }} />
                    : null}
                    <Legend
                      verticalAlign="top"
                      align="left"
                      height={32}
                      iconType="line"
                      wrapperStyle={{ cursor: "pointer", fontSize: 12, paddingBottom: 8 }}
                      onClick={(item) => toggleSpreadLine(item.dataKey)}
                      formatter={(value) => {
                        const key = String(value) as SpreadLineKey;
                        const active = visibleSpreadLineKeys.has(key);
                        return <span className={active ? "text-zinc-700" : "text-zinc-400 line-through"}>{String(value)}</span>;
                      }}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="股息率"
                      name="股息率"
                      stroke="#4f46e5"
                      dot={false}
                      strokeWidth={2}
                      hide={!visibleSpreadLineKeys.has("股息率")}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="国债收益率"
                      name="国债收益率"
                      stroke="#71717a"
                      dot={false}
                      strokeWidth={1.5}
                      strokeDasharray="5 4"
                      hide={!visibleSpreadLineKeys.has("国债收益率")}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="利差"
                      name="利差"
                      stroke="#f97316"
                      dot={false}
                      strokeWidth={2.4}
                      hide={!visibleSpreadLineKeys.has("利差")}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="价格"
                      name="价格"
                      stroke="#27272a"
                      dot={false}
                      strokeWidth={1.4}
                      connectNulls
                      hide={!visibleSpreadLineKeys.has("价格")}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <PercentileMeter label="股息率历史位置" value={dividendHistogram.latest} percentile={dividendHistogram.percentile} />
                <PercentileMeter label="国债收益率历史位置" value={bondHistogram.latest} percentile={bondHistogram.percentile} />
                <PercentileMeter label="股债利差历史位置" value={spreadHistogram.latest} percentile={spreadHistogram.percentile} />
              </div>
            </>
          : (
            <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50/80 p-4 text-sm text-amber-950">
              <p className="font-medium">暂不展示股息率与利差图</p>
              <p className="mt-2 leading-relaxed text-amber-900/90">
                当前 index_bars 未包含已确认口径的历史股息率。此前探测到的中证 <code className="rounded bg-white/70 px-1">indexCsiDsPe</code>{" "}
                字段与 factsheet 股息率不一致，已停止作为 DP 使用；该模块将在接入可靠历史股息率后自动恢复。
              </p>
              <p className="mt-2 text-xs text-amber-800/90">国债收益率仍来自 bonds.csv；本模块不会用前向填充或估算值补股息率。</p>
              </div>
          )}
        </section>
      : null}

      <section className="rounded-3xl border border-zinc-100 bg-white p-6 shadow-sm overflow-x-auto">
        <h2 className="text-lg font-semibold text-zinc-900">跟踪产品（仅链接）</h2>
        <p className="mt-1 text-xs text-zinc-500">
          下列代码来自 <code className="rounded bg-zinc-100 px-1">index_tracking_etfs.csv</code>，<strong>不参与</strong>{" "}
          本页指数曲线与绩效计算。
        </p>
        {trackingRows.length === 0 ?
          <p className="mt-4 text-sm text-zinc-500">暂无映射行。</p>
        : (
          <table className="mt-4 w-full min-w-[360px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                <th className="pb-2 pr-4">产品代码</th>
                <th className="pb-2 pr-4">备注</th>
                <th className="pb-2">ETF 看板</th>
              </tr>
            </thead>
            <tbody>
              {trackingRows.map((row) => (
                <tr key={row.etf_code} className="border-b border-zinc-100">
                  <td className="py-3 font-mono text-zinc-800">{row.etf_code}</td>
                  <td className="py-3 text-zinc-600">{row.note ?? "—"}</td>
                  <td className="py-3">
                    <Link
                      to={`/etf/${encodeURIComponent(row.etf_code)}`}
                      className="font-medium text-indigo-600 hover:underline"
                    >
                      打开
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
