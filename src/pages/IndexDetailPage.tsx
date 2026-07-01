import { useDeferredValue, useEffect, useMemo, useState } from "react";
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
import { BondAnchorToggle } from "../components/BondAnchorToggle";
import { IndexConclusionCard } from "../components/IndexConclusionCard";
import { IndexOfficialIntroLink } from "../components/IndexOfficialIntroLink";
import { PageBreadcrumb } from "../components/PageBreadcrumb";
import { CsIndexDatePicker } from "../components/CsIndexRangePicker";
import { EtfProductCodeLink } from "../components/EtfProductDetailLink";
import { IndexTrackingProductsTable } from "../components/EtfProductSections";
import { useDataSource } from "../context/DataSourceContext";
import { useHkBondAnchorPreference } from "../hooks/useHkBondAnchorPreference";
import {
  bondAnchorLabel,
  bondAnchorShortLabel,
  resolveBondAnchorForIndex,
} from "../lib/bondAnchor";
import { CHART_THEME as CHART } from "../lib/chartTheme";
import { formatPct } from "../lib/formatDisplay";
import { indexOfficialIntroUrl } from "../lib/indexOfficialLinks";
import { productsForIndex, primaryProductForIndex } from "../lib/etfProducts";
import { etfDashboardHref } from "../lib/etfListingAge";
import {
  buildIndexSpreadRows,
  indexChartValueModes,
  indexSeriesForMode,
  indexShowsSpread,
  type IndexValueMode,
} from "../data/indexCsv";
import { dividendAllocationObservation } from "../lib/configFramework";
import {
  ANNUAL_METRIC_WINDOW_IDS,
  METRIC_WINDOWS,
  RETURN_METRIC_WINDOW_IDS,
  buildMetricRow,
  buildPercentileHistogram,
  calcMetricBlock,
  chartDatesForDisplay,
  cumulativeReturnSeries,
  finiteMax,
  finiteMin,
  isMetricWindowSatisfied,
  metricWindowBlock,
  ohlcBarsToSeries,
  satisfiedMetricWindowIds,
  type DateValuePoint,
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
  { id: "10y", label: "十年", years: 10 },
  { id: "all", label: "全部" },
] as const;
const RETURN_WINDOWS = RETURN_METRIC_WINDOW_IDS;
const ANNUAL_WINDOWS = ANNUAL_METRIC_WINDOW_IDS;
import {
  SP_ETF_PROXY_DETAIL_NOTE,
  SP_INDEX_ETF_PROXY_CODES,
  etfProxyPriceLineLabel,
} from "../lib/indexEtfProxy";
const COMPARE_COLORS = [
  CHART.series.tertiary,
  CHART.series.warn,
  CHART.series.secondary,
  "#7eb8e8",
  "#d4a574",
  "#a78bfa",
  CHART.series.muted,
] as const;
const SPREAD_LINE_KEYS = ["股息率", "国债收益率", "利差", "价格"] as const;

type SpreadLineKey = (typeof SPREAD_LINE_KEYS)[number];

function clampWindow(
  len: number,
  start: number,
  end: number,
): { start: number; end: number } {
  if (len <= 0) return { start: 0, end: 0 };
  const s = Math.max(0, Math.min(len - 1, Math.floor(start)));
  const e = Math.max(s, Math.min(len - 1, Math.floor(end)));
  return { start: s, end: e };
}

function fmtRawValue(v: unknown): string {
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

function dateShift(
  date: string,
  opts: { days?: number; months?: number; years?: number; ytd?: boolean },
) {
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

function signedPct(
  v: number | null | undefined,
  windowSatisfied = true,
) {
  if (!windowSatisfied) return "/";
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "▲" : v < 0 ? "▼" : "";
  return `${sign}${Math.abs(v).toFixed(1)}`;
}

function signedClass(
  v: number | null | undefined,
  windowSatisfied = true,
) {
  if (!windowSatisfied) return "text-[var(--fin-dim)]";
  if (typeof v !== "number" || !Number.isFinite(v) || v === 0)
    return "text-[var(--fin-text)]";
  return v > 0 ? "text-[var(--fin-up)]" : "text-[var(--fin-down)]";
}

function formatVolPct(
  v: number | null | undefined,
  windowSatisfied = true,
) {
  if (!windowSatisfied) return "/";
  return formatPct(v);
}

function PercentileMeter({
  label,
  value,
  percentile,
}: {
  label: string;
  value: number | null;
  percentile: number | null;
}) {
  const pct =
    typeof percentile === "number" && Number.isFinite(percentile)
      ? Math.max(0, Math.min(100, percentile))
      : null;
  return (
    <div className="fin-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs fin-muted-text">{label}</p>
          <p className="mt-1 font-mono text-xl font-semibold text-[var(--fin-text)]">
            {formatPct(value)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs fin-muted-text">历史分位</p>
          <p className="mt-1 font-mono text-lg font-semibold text-[var(--fin-text)]">
            {formatPct(pct)}
          </p>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full border border-fin-border">
        <div
          className="h-full rounded-full bg-[var(--fin-up)]"
          style={{ width: `${pct ?? 0}%`, opacity: 0.65 }}
        />
      </div>
      <p className="mt-2 text-xs fin-muted-text">{percentileTone(pct)}</p>
    </div>
  );
}

function lineKeyForIndex(code: string) {
  return `cmp_${code.replace(/[^A-Za-z0-9]/g, "_")}`;
}

function orderedChartRange(
  start: string | null | undefined,
  end: string | null | undefined,
): { start: string | null; end: string | null } {
  if (!start && !end) return { start: null, end: null };
  if (!start) return { start: end ?? null, end: end ?? null };
  if (!end) return { start, end: start };
  return start <= end ? { start, end } : { start: end, end: start };
}

function defaultVisibleLineKeys(
  bars: Parameters<typeof indexChartValueModes>[0] | undefined,
): Set<string> {
  const modes = indexChartValueModes(bars ?? []);
  const keys: string[] = modes.map((mode) =>
    mode === "price" ? "price" : "tri",
  );
  keys.push("hs300");
  return new Set(keys);
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
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-lg"
      style={{
        background: CHART.tooltip.background,
        borderColor: CHART.tooltip.border,
        color: CHART.tooltip.color,
      }}
    >
      <p className="mb-1 font-mono font-semibold">{label}</p>
      <div className="space-y-1">
        {payload.map((item) => {
          const key = String(item.dataKey ?? "");
          const rawKey = `${key}Raw`;
          return (
            <div
              key={key}
              className="flex min-w-[180px] items-center justify-between gap-4"
            >
              <span
                className="flex items-center gap-2"
                style={{ color: CHART.label }}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                {item.name}
              </span>
              <span className="font-mono">{fmtRawValue(row[rawKey])}</span>
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
  const {
    getIndex,
    getEtf,
    indices,
    etfProducts,
    bondByDate,
    publicCsvAutoLoading,
  } = useDataSource();
  const def = raw ? getIndex(raw) : undefined;
  const [perfStartDateOverride, setPerfStartDateOverride] = useState<
    string | null
  >(null);
  const [perfEndDateOverride, setPerfEndDateOverride] = useState<string | null>(
    null,
  );
  const [quickRange, setQuickRange] = useState<string>("all");
  const [compareCodes, setCompareCodes] = useState<string[]>([]);
  const [compareCandidate, setCompareCandidate] = useState("");
  const [visibleLineKeys, setVisibleLineKeys] = useState<Set<string>>(() =>
    defaultVisibleLineKeys(undefined),
  );
  const [visibleSpreadLineKeys, setVisibleSpreadLineKeys] = useState<
    Set<SpreadLineKey>
  >(() => new Set(SPREAD_LINE_KEYS));
  const [hkBondAnchor, setHkBondAnchor] = useHkBondAnchorPreference();

  const effectiveBondAnchor = useMemo(() => {
    if (!def) return "CN_10Y" as const;
    return def.meta.market === "H"
      ? hkBondAnchor
      : resolveBondAnchorForIndex(def);
  }, [def, hkBondAnchor]);

  const indexProducts = useMemo(
    () => (def ? productsForIndex(etfProducts, def.meta.index_code) : []),
    [etfProducts, def?.meta.index_code],
  );

  const hasIndexBars = Boolean(def?.bars.length);

  const primaryProduct = def
    ? primaryProductForIndex(etfProducts, def.meta.index_code)
    : undefined;
  const primaryEtf = primaryProduct ? getEtf(primaryProduct.code) : undefined;

  const spFallbackWithEtf =
    Boolean(def) &&
    SP_INDEX_ETF_PROXY_CODES.has(def?.meta.index_code ?? "") &&
    !hasIndexBars &&
    Boolean(primaryEtf?.bars?.length);

  const hasBars = hasIndexBars || spFallbackWithEtf;
  const priceLabel = shortIndexName(def?.meta.name ?? "");
  const triLabel = `${priceLabel}全收益`;

  useEffect(() => {
    if (!def) return;
    if (spFallbackWithEtf) {
      setVisibleLineKeys(new Set(["price", "hs300"]));
    } else {
      setVisibleLineKeys(defaultVisibleLineKeys(def.bars));
    }
  }, [def?.meta.index_code, spFallbackWithEtf]);

  const triSeries = useMemo<DateValuePoint[]>(
    () =>
      def
        ? spFallbackWithEtf && primaryEtf?.bars?.length
          ? ohlcBarsToSeries(primaryEtf.bars)
          : indexSeriesForMode(def.bars, "tri").filter(
              (p) => Number.isFinite(p.value) && p.value > 0,
            )
        : [],
    [def, spFallbackWithEtf, primaryEtf],
  );
  const priceSeries = useMemo<DateValuePoint[]>(
    () =>
      def
        ? spFallbackWithEtf && primaryEtf?.bars?.length
          ? ohlcBarsToSeries(primaryEtf.bars)
          : indexSeriesForMode(def.bars, "price").filter(
              (p) => Number.isFinite(p.value) && p.value > 0,
            )
        : [],
    [def, spFallbackWithEtf, primaryEtf],
  );
  const hs300 = useMemo(
    () => indices.find((ix) => ix.meta.index_code === "000300"),
    [indices],
  );
  const hs300Series = useMemo<DateValuePoint[]>(
    () =>
      hs300
        ? indexSeriesForMode(hs300.bars, "tri").filter(
            (p) => Number.isFinite(p.value) && p.value > 0,
          )
        : [],
    [hs300],
  );
  const compareOptions = useMemo(
    () =>
      indices
        .filter(
          (ix) =>
            ix.bars.length > 0 &&
            ix.meta.index_code !== def?.meta.index_code &&
            !compareCodes.includes(ix.meta.index_code),
        )
        .sort((a, b) => a.meta.name.localeCompare(b.meta.name, "zh-Hans-CN")),
    [indices, def?.meta.index_code, compareCodes],
  );
  const compareSeriesDefs = useMemo(
    () =>
      compareCodes.flatMap((code, i) => {
        const ix = indices.find((item) => item.meta.index_code === code);
        if (!ix) return [];
        const series = indexSeriesForMode(ix.bars, "tri").filter(
          (p) => Number.isFinite(p.value) && p.value > 0,
        );
        if (!series.length) return [];
        return [
          {
            key: lineKeyForIndex(code),
            code,
            name: `${shortIndexName(ix.meta.name)}全收益`,
            color: COMPARE_COLORS[i % COMPARE_COLORS.length]!,
            series,
          },
        ];
      }),
    [compareCodes, indices],
  );
  const primaryPerfSeries = useMemo<DateValuePoint[]>(
    () => (spFallbackWithEtf ? priceSeries : triSeries),
    [spFallbackWithEtf, priceSeries, triSeries],
  );
  const subjectChartModes = useMemo(
    (): IndexValueMode[] =>
      def
        ? spFallbackWithEtf
          ? (["price"] as IndexValueMode[])
          : indexChartValueModes(def.bars)
        : [],
    [def, spFallbackWithEtf],
  );
  const lineDefs = useMemo(() => {
    const subjectLines: {
      key: string;
      code: string;
      name: string;
      color: string;
      series: DateValuePoint[];
    }[] = [];
    const pushMode = (mode: IndexValueMode) => {
      if (mode === "price") {
        subjectLines.push({
          key: "price",
          code: def?.meta.index_code ?? "",
          name:
            spFallbackWithEtf && primaryProduct
              ? etfProxyPriceLineLabel(
                  primaryProduct.name,
                  primaryProduct.code,
                )
              : priceLabel,
          color: spFallbackWithEtf ? CHART.series.primary : CHART.series.muted,
          series: priceSeries,
        });
        return;
      }
      const singleSubjectLine =
        subjectChartModes.length === 1 && subjectChartModes[0] === "tri";
      subjectLines.push({
        key: "tri",
        code: def?.meta.index_code ?? "",
        name: singleSubjectLine ? priceLabel : triLabel,
        color: CHART.series.primary,
        series: triSeries,
      });
    };
    for (const mode of subjectChartModes) pushMode(mode);
    return [
      ...subjectLines,
      {
        key: "hs300",
        code: "000300",
        name: spFallbackWithEtf ? "沪深300全收益（指数层）" : "沪深300",
        color: CHART.series.secondary,
        series: hs300Series,
      },
      ...compareSeriesDefs,
    ];
  }, [
    def?.meta.index_code,
    priceLabel,
    triLabel,
    priceSeries,
    triSeries,
    hs300Series,
    compareSeriesDefs,
    subjectChartModes,
    spFallbackWithEtf,
    primaryProduct,
  ]);
  const visibleLineDefs = useMemo(
    () => lineDefs.filter((line) => visibleLineKeys.has(line.key)),
    [lineDefs, visibleLineKeys],
  );
  const colorByLineKey = useMemo(
    () => new Map(visibleLineDefs.map((line) => [line.key, line.color])),
    [visibleLineDefs],
  );
  const perfDates = useMemo(
    () => primaryPerfSeries.map((p) => p.date),
    [primaryPerfSeries],
  );
  const brushPreview = useMemo(
    () => sampledBrushData(primaryPerfSeries),
    [primaryPerfSeries],
  );
  const fullPerf = useMemo(
    () => calcMetricBlock(primaryPerfSeries),
    [primaryPerfSeries],
  );
  const firstPerfDate = perfDates[0];
  const lastPerfDate = perfDates.at(-1);
  const perfStartDate = perfStartDateOverride ?? firstPerfDate;
  const perfEndDate = perfEndDateOverride ?? lastPerfDate;
  const chartRange = useMemo(
    () => orderedChartRange(perfStartDate, perfEndDate),
    [perfStartDate, perfEndDate],
  );
  const perfWindow = useMemo(() => {
    const rangeStart = chartRange.start ?? perfStartDate;
    const rangeEnd = chartRange.end ?? perfEndDate;
    const start = rangeStart ? nearestDateIndex(brushPreview, rangeStart) : 0;
    const end = rangeEnd
      ? nearestDateIndex(brushPreview, rangeEnd)
      : Math.max(0, brushPreview.length - 1);
    return clampWindow(brushPreview.length, start, end);
  }, [brushPreview, chartRange, perfStartDate, perfEndDate]);
  const latestDate = lastPerfDate ?? def?.bars.at(-1)?.date ?? "—";
  const deferredPerfStartDate = useDeferredValue(chartRange.start);
  const deferredPerfEndDate = useDeferredValue(chartRange.end);
  const chartRangeDates = useMemo(
    () =>
      perfDates.filter(
        (date) =>
          (!deferredPerfStartDate || date >= deferredPerfStartDate) &&
          (!deferredPerfEndDate || date <= deferredPerfEndDate),
      ),
    [perfDates, deferredPerfStartDate, deferredPerfEndDate],
  );
  const cumulativeData = useMemo(() => {
    const dates = chartDatesForDisplay(chartRangeDates, quickRange);
    const seriesMap = Object.fromEntries(
      visibleLineDefs.map((line) => [line.key, line.series]),
    );
    const rawMaps = Object.fromEntries(
      visibleLineDefs.map((line) => [
        line.key,
        new Map(line.series.map((p) => [p.date, p.value])),
      ]),
    ) as Record<string, Map<string, number>>;
    return cumulativeReturnSeries(seriesMap, dates).map((row) => {
      const date = String(row.date);
      const withRaw = { ...row };
      for (const line of visibleLineDefs) {
        withRaw[`${line.key}Raw`] = rawMaps[line.key]?.get(date) ?? null;
      }
      return withRaw;
    });
  }, [chartRangeDates, quickRange, visibleLineDefs]);
  const metricRows = useMemo(
    () =>
      visibleLineDefs.map((line) =>
        buildMetricRow(line.key, line.name, line.series),
      ),
    [visibleLineDefs],
  );
  const seriesByLineKey = useMemo(
    () => new Map(visibleLineDefs.map((line) => [line.key, line.series])),
    [visibleLineDefs],
  );
  const visibleReturnWindows = useMemo(
    () => satisfiedMetricWindowIds(primaryPerfSeries, RETURN_WINDOWS),
    [primaryPerfSeries],
  );
  const visibleAnnualWindows = useMemo(
    () => satisfiedMetricWindowIds(primaryPerfSeries, ANNUAL_WINDOWS),
    [primaryPerfSeries],
  );

  const shouldShowSpreadModule = Boolean(
    def && hasIndexBars && indexShowsSpread(def.meta.category),
  );
  const spreadRows = useMemo(
    () =>
      def && shouldShowSpreadModule
        ? buildIndexSpreadRows(def, bondByDate, effectiveBondAnchor)
        : [],
    [def, shouldShowSpreadModule, bondByDate, effectiveBondAnchor],
  );
  const bondYieldSeriesLabel = bondAnchorShortLabel(effectiveBondAnchor);
  const priceByDate = useMemo(
    () => new Map(priceSeries.map((p) => [p.date, p.value])),
    [priceSeries],
  );
  const triByDate = useMemo(
    () => new Map(triSeries.map((p) => [p.date, p.value])),
    [triSeries],
  );

  const tripleData = useMemo(
    () =>
      spreadRows
        .filter(
          (r) =>
            (!deferredPerfStartDate || r.date >= deferredPerfStartDate) &&
            (!deferredPerfEndDate || r.date <= deferredPerfEndDate),
        )
        .map((r) => ({
          date: r.date,
          股息率: r.divYieldPct,
          国债收益率: r.bondYieldPct,
          利差: r.spreadPct,
          价格: priceByDate.get(r.date) ?? triByDate.get(r.date) ?? null,
        })),
    [
      spreadRows,
      deferredPerfStartDate,
      deferredPerfEndDate,
      priceByDate,
      triByDate,
    ],
  );
  const tripleChartData = useMemo(() => {
    if (!tripleData.length) return tripleData;
    const keep = new Set(
      chartDatesForDisplay(
        tripleData.map((r) => r.date),
        quickRange,
      ),
    );
    return tripleData.filter((r) => keep.has(r.date));
  }, [tripleData, quickRange]);
  const dividendHistogram = useMemo(
    () =>
      buildPercentileHistogram(
        spreadRows.map((r) => r.divYieldPct),
        12,
      ),
    [spreadRows],
  );
  const bondHistogram = useMemo(
    () =>
      buildPercentileHistogram(
        spreadRows.map((r) => r.bondYieldPct),
        12,
      ),
    [spreadRows],
  );
  const spreadHistogram = useMemo(
    () =>
      buildPercentileHistogram(
        spreadRows.map((r) => r.spreadPct),
        12,
      ),
    [spreadRows],
  );
  const latestSpreadPoint = spreadRows.at(-1);
  const pctAxisMax = useMemo(() => {
    const values = tripleData.flatMap((r) => [r.股息率, r.国债收益率, r.利差]);
    return Math.max(5.5, Math.ceil(finiteMax(values, 0) + 0.5));
  }, [tripleData]);
  const pctAxisMin = useMemo(() => {
    const values = tripleData.flatMap((r) => [r.股息率, r.国债收益率, r.利差]);
    return Math.min(0, Math.floor(finiteMin(values, 0) - 0.5));
  }, [tripleData]);
  const allocationAdvice = dividendAllocationObservation(
    latestSpreadPoint?.spreadPct,
    latestSpreadPoint?.divYieldPct,
  );

  if (!def) {
    if (raw && (publicCsvAutoLoading || indices.length === 0)) {
      return (
        <div className="rounded-lg border border-fin-border px-4 py-8 text-sm fin-muted-text">
          正在加载指数数据…
        </div>
      );
    }
    return <Navigate to="/indices" replace />;
  }

  const bondLabel = bondAnchorLabel(effectiveBondAnchor);
  const baseDate = metaText(def.meta, "base_date");
  const launchDate =
    metaText(def.meta, "launch_date") ?? def.meta.inception_date;
  const weightingMethod = metaText(def.meta, "weighting_method");
  const introUrl = indexOfficialIntroUrl(def.meta);
  const methodologyUrl = def.meta.methodology_url?.trim() || null;
  const showMethodologyDoc =
    methodologyUrl != null && methodologyUrl !== introUrl;
  const methodologySummary =
    metaText(def.meta, "methodology_summary") ??
    "（未提供 methodology_summary）";
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

  function applyPerfStartDate(startDate: string) {
    if (!firstPerfDate || !lastPerfDate) return;
    const start =
      startDate < firstPerfDate
        ? firstPerfDate
        : startDate > lastPerfDate
          ? lastPerfDate
          : startDate;
    setQuickRange("custom");
    setPerfStartDateOverride(start);
  }

  function applyPerfEndDate(endDate: string) {
    if (!firstPerfDate || !lastPerfDate) return;
    const end =
      endDate > lastPerfDate
        ? lastPerfDate
        : endDate < firstPerfDate
          ? firstPerfDate
          : endDate;
    setQuickRange("custom");
    setPerfEndDateOverride(end);
  }

  function removeLine(line: { key: string; code: string }) {
    setVisibleLineKeys((keys) => {
      const next = new Set(keys);
      next.delete(line.key);
      return next;
    });
    if (
      !DEFAULT_LINE_KEYS.includes(
        line.key as (typeof DEFAULT_LINE_KEYS)[number],
      )
    ) {
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
    applyQuickRange(QUICK_RANGES.find((r) => r.id === "all")!);
    setCompareCodes([]);
    setCompareCandidate("");
    setVisibleLineKeys(
      spFallbackWithEtf
        ? new Set(["price", "hs300"])
        : defaultVisibleLineKeys(def?.bars),
    );
  }

  return (
    <div className="ft-page space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageBreadcrumb
            items={[
              { label: "配置总览", to: "/" },
              { label: "指数研究", to: "/indices" },
              { label: def.meta.index_code },
            ]}
          />
          <h2 className="fin-page-title mt-2">{def.meta.name}</h2>
          <p className="mt-1 font-mono text-sm fin-muted-text">
            {def.meta.index_code}
          </p>
          <p className="mt-2 text-xs fin-muted-text">
            {spFallbackWithEtf
              ? "指数研究 · 无官方指数序列时以主跟踪 ETF 前复权收盘价展示走势"
              : "指数研究 · 图表与绩效基于指数全收益序列"}
          </p>
          {primaryProduct ? (
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="fin-muted-text">主跟踪：</span>
              <EtfProductCodeLink
                product={primaryProduct}
                etf={primaryEtf}
                className="font-mono font-semibold fin-link"
              />
              <span className="fin-muted-text">{primaryProduct.name}</span>
              <span className="fin-muted-separator" aria-hidden>
                |
              </span>
              <Link
                to={etfDashboardHref(
                  primaryProduct.code,
                  "backtest",
                  primaryEtf,
                  primaryProduct,
                )}
                className="fin-link"
              >
                策略回测
              </Link>
              <Link
                to={etfDashboardHref(
                  primaryProduct.code,
                  "intraday",
                  primaryEtf,
                  primaryProduct,
                )}
                className="fin-link"
              >
                盘中监控
              </Link>
              <Link to="/products" className="fin-muted-text fin-link">
                产品选择
              </Link>
            </p>
          ) : null}
        </div>
      </div>

      <div id="section-conclusion" className="fin-section-scroll">
        <IndexConclusionCard
          def={def}
          bondByDate={bondByDate}
          bondAnchor={effectiveBondAnchor}
          primaryProduct={primaryProduct}
          primaryEtf={primaryEtf}
        />
      </div>

      <section
        id="section-meta"
        className="fin-section-scroll fin-panel space-y-3 p-6"
      >
        <h2 className="text-base font-semibold text-[var(--fin-text)]">
          基本信息
        </h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs fin-muted-text">指数名称</dt>
            <dd className="mt-1 font-medium text-[var(--fin-text)]">
              {def.meta.name}
            </dd>
          </div>
          <div>
            <dt className="text-xs fin-muted-text">代码</dt>
            <dd className="mt-1 font-mono text-[var(--fin-text)]">
              {def.meta.index_code}
            </dd>
          </div>
          <div>
            <dt className="text-xs fin-muted-text">基期</dt>
            <dd className="mt-1 font-mono text-[var(--fin-text)]">
              {baseDate ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs fin-muted-text">启用日期</dt>
            <dd className="mt-1 font-mono text-[var(--fin-text)]">
              {launchDate ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs fin-muted-text">加权方式</dt>
            <dd className="mt-1 text-[var(--fin-text)]">
              {weightingMethod ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs fin-muted-text">官网介绍</dt>
            <dd className="mt-1">
              <IndexOfficialIntroLink meta={def.meta} />
            </dd>
          </div>
        </dl>
        <p className="text-sm fin-muted-text leading-relaxed whitespace-pre-wrap">
          {methodologySummary}
        </p>
        {showMethodologyDoc ? (
          <a
            href={methodologyUrl}
            className="inline-block text-sm fin-link"
            target="_blank"
            rel="noreferrer"
          >
            编制方案文档
          </a>
        ) : null}
      </section>

      {hasBars ? (
        <>
          {spFallbackWithEtf ? (
            <section className="fin-alert-warn text-sm leading-relaxed">
              <p className="font-medium text-[var(--fin-text)]">
                无标普官方指数日序列
              </p>
              <p className="mt-2 opacity-90">{SP_ETF_PROXY_DETAIL_NOTE}</p>
            </section>
          ) : null}

          {!spFallbackWithEtf ? (
          <section
            id="section-perf"
            className="fin-section-scroll fin-panel p-6"
          >
            <h2 className="text-lg font-semibold text-[var(--fin-text)]">
              业绩-全样本
            </h2>
            <p className="mt-1 text-xs fin-muted-text">
              当前使用全收益序列；波动率为日收益按 252
              个交易日折算的年化波动率。
            </p>
            <dl className="mt-4 grid gap-4 sm:grid-cols-3 text-sm">
              <div>
                <dt className="fin-muted-text">年化收益率</dt>
                <dd className="mt-1 text-xl font-semibold text-[var(--fin-text)]">
                  {formatPct(fullPerf.annualReturnPct)}
                </dd>
              </div>
              <div>
                <dt className="fin-muted-text">最大回撤</dt>
                <dd className="mt-1 text-xl font-semibold text-[var(--fin-text)]">
                  {formatPct(fullPerf.maxDrawdownPct)}
                </dd>
              </div>
              <div>
                <dt className="fin-muted-text">年化波动率</dt>
                <dd className="mt-1 text-xl font-semibold text-[var(--fin-text)]">
                  {formatPct(fullPerf.annualVolPct)}
                </dd>
              </div>
            </dl>
          </section>
          ) : null}

          <section
            id="section-chart"
            className="fin-section-scroll fin-panel overflow-hidden"
          >
            {spFallbackWithEtf ? (
              <div className="border-b border-fin-border px-5 py-4">
                <h2 className="text-lg font-semibold text-[var(--fin-text)]">
                  走势对比（ETF 前复权）
                </h2>
                <p className="mt-1 text-xs fin-muted-text">
                  累计收益以各序列可见区间首日为基准归一化，非指数官方全收益口径。
                </p>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3 border-b border-fin-border px-5 py-4 xl:flex-nowrap">
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-[var(--fin-dim)]">
                  时间窗
                </span>
                <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                  {QUICK_RANGES.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => applyQuickRange(r)}
                      className={`fin-chip-filter min-w-12 px-2 py-1.5 ${quickRange === r.id ? "fin-chip-filter-active" : ""}`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              {firstPerfDate && lastPerfDate ? (
                <div className="flex flex-wrap items-center gap-2">
                  <CsIndexDatePicker
                    label="开始"
                    placeholder="开始日期"
                    value={perfStartDate ?? firstPerfDate}
                    min={firstPerfDate}
                    max={lastPerfDate}
                    tradingDates={perfDates}
                    onChange={applyPerfStartDate}
                  />
                  <span className="text-sm text-[var(--fin-dim)]">至</span>
                  <CsIndexDatePicker
                    label="结束"
                    placeholder="结束日期"
                    value={perfEndDate ?? lastPerfDate}
                    min={firstPerfDate}
                    max={lastPerfDate}
                    tradingDates={perfDates}
                    onChange={applyPerfEndDate}
                  />
                </div>
              ) : null}
              <p className="shrink-0 text-sm text-[var(--fin-dim)]">
                更新日期: {latestDate}
              </p>
              <div className="flex min-w-[220px] flex-1 items-center justify-end">
                <select
                  value={compareCandidate}
                  onChange={(e) => {
                    const code = e.target.value;
                    setCompareCandidate(code);
                    if (!code || compareCodes.includes(code)) return;
                    setCompareCodes((codes) => [...codes, code]);
                    setVisibleLineKeys((keys) =>
                      new Set(keys).add(lineKeyForIndex(code)),
                    );
                    setCompareCandidate("");
                  }}
                  className="fin-select w-full max-w-[280px] rounded-md border border-fin-border bg-transparent px-3 py-2 text-sm"
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
                  className="inline-flex items-center gap-2 rounded-md border border-fin-border px-3 py-1.5 text-sm font-medium text-[var(--fin-text)]"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: line.color }}
                  />
                  {line.name}
                  <button
                    type="button"
                    onClick={() => removeLine(line)}
                    className="ml-1 text-base leading-none text-[var(--fin-dim)] hover:text-[var(--fin-text)]"
                    aria-label={`删除 ${line.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={resetMarketView}
                className="fin-chip-filter px-3 py-1.5 text-sm font-medium"
              >
                重置
              </button>
            </div>
            <div className="h-[390px] w-full px-5 pt-5">
              {cumulativeData.length > 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={cumulativeData}>
                    <CartesianGrid stroke={CHART.grid} vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12, fill: CHART.axisTick }}
                      minTickGap={52}
                      axisLine={{ stroke: CHART.axisLine }}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: CHART.axisTick }}
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
                        strokeWidth={
                          DEFAULT_LINE_KEYS.includes(
                            line.key as (typeof DEFAULT_LINE_KEYS)[number],
                          )
                            ? 1.8
                            : 1.6
                        }
                        connectNulls
                        isAnimationActive={false}
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm fin-muted-text">数据不足以绘制曲线。</p>
              )}
            </div>
            {perfDates.length > MIN_BRUSH_POINTS ? (
              <div className="px-5 pb-5">
                <ResponsiveContainer width="100%" height={56}>
                  <ComposedChart data={brushPreview}>
                    <XAxis dataKey="date" hide />
                    <YAxis hide domain={["auto", "auto"]} />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke={CHART.series.primary}
                      strokeWidth={1}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Brush
                      dataKey="date"
                      height={34}
                      stroke={CHART.axisLine}
                      fill={CHART.grid}
                      travellerWidth={9}
                      startIndex={perfWindow.start}
                      endIndex={perfWindow.end}
                      onChange={(e: {
                        startIndex?: number;
                        endIndex?: number;
                      }) => {
                        const c = clampWindow(
                          brushPreview.length,
                          e.startIndex ?? 0,
                          e.endIndex ?? brushPreview.length - 1,
                        );
                        setQuickRange("custom");
                        setPerfStartDateOverride(
                          brushPreview[c.start]?.date ?? null,
                        );
                        setPerfEndDateOverride(
                          brushPreview[c.end]?.date ?? null,
                        );
                      }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : null}
          </section>

          {!spFallbackWithEtf ? (
          <section
            id="section-metrics"
            className="fin-section-scroll fin-panel overflow-x-auto"
          >
            <table className="w-full min-w-[980px] table-fixed text-xs text-[var(--fin-text)] xl:min-w-0">
              <thead>
                <tr className="fin-table-head border-b border-fin-border text-sm font-semibold">
                  <th className="w-[220px] px-3 py-3 text-left"></th>
                  <th
                    className="border-l border-fin-border px-2 py-3 text-center"
                    colSpan={visibleReturnWindows.length}
                  >
                    阶段性收益（%）
                  </th>
                  <th
                    className="border-l border-fin-border px-2 py-3 text-center"
                    colSpan={visibleAnnualWindows.length}
                  >
                    年化收益（%）
                  </th>
                  <th
                    className="border-l border-fin-border px-2 py-3 text-center"
                    colSpan={visibleAnnualWindows.length}
                  >
                    年化波动率（%）
                  </th>
                </tr>
                <tr className="fin-table-head border-b border-fin-border font-semibold">
                  <th className="px-3 py-3 text-left font-mono text-[var(--fin-muted)]">
                    {latestDate}
                  </th>
                  {visibleReturnWindows.map((id) => (
                    <th
                      key={id}
                      className="border-l border-fin-border px-2 py-3 text-center"
                    >
                      {METRIC_WINDOWS.find((w) => w.id === id)?.label}
                    </th>
                  ))}
                  {visibleAnnualWindows.map((id) => (
                    <th
                      key={`ann-${id}`}
                      className="border-l border-fin-border px-2 py-3 text-center"
                    >
                      {METRIC_WINDOWS.find((w) => w.id === id)?.label}
                    </th>
                  ))}
                  {visibleAnnualWindows.map((id) => (
                    <th
                      key={`vol-${id}`}
                      className="border-l border-fin-border px-2 py-3 text-center"
                    >
                      {METRIC_WINDOWS.find((w) => w.id === id)?.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-fin-border">
                {metricRows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-3 font-medium" title={row.label}>
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              colorByLineKey.get(row.id) ?? "#94a3b8",
                          }}
                        />
                        <span className="line-clamp-2 leading-snug">
                          {row.label}
                        </span>
                      </div>
                    </td>
                    {visibleReturnWindows.map((id) => {
                      const rowSeries = seriesByLineKey.get(row.id) ?? [];
                      const satisfied = isMetricWindowSatisfied(rowSeries, id);
                      const v = metricWindowBlock(row, id).totalReturnPct;
                      return (
                        <td
                          key={id}
                          className={`px-2 py-3 text-center font-mono ${signedClass(v, satisfied)}`}
                        >
                          {signedPct(v, satisfied)}
                        </td>
                      );
                    })}
                    {visibleAnnualWindows.map((id) => {
                      const rowSeries = seriesByLineKey.get(row.id) ?? [];
                      const satisfied = isMetricWindowSatisfied(rowSeries, id);
                      const v = metricWindowBlock(row, id).annualReturnPct;
                      return (
                        <td
                          key={`ann-${id}`}
                          className={`px-2 py-3 text-center font-mono ${signedClass(v, satisfied)}`}
                        >
                          {signedPct(v, satisfied)}
                        </td>
                      );
                    })}
                    {visibleAnnualWindows.map((id) => {
                      const rowSeries = seriesByLineKey.get(row.id) ?? [];
                      const satisfied = isMetricWindowSatisfied(rowSeries, id);
                      const v = metricWindowBlock(row, id).annualVolPct;
                      return (
                        <td
                          key={`vol-${id}`}
                          className="px-2 py-3 text-center font-mono text-[var(--fin-dim)]"
                        >
                          {formatVolPct(v, satisfied)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          ) : null}
        </>
      ) : (
        <section className="fin-alert-warn">
          <p className="font-medium">暂无指数日序列</p>
          <p className="mt-2 opacity-90">
            暂无可用日序列，图表与绩效无法展示。
          </p>
        </section>
      )}

      {shouldShowSpreadModule ? (
        <section
          id="section-spread"
          className="fin-section-scroll fin-panel space-y-4 p-6"
        >
          <div>
            <h2 className="text-lg font-semibold text-[var(--fin-text)]">
              红利配置参考：股息率、利差与价格
            </h2>
            <p className="mt-1 text-xs fin-muted-text leading-relaxed">
              <strong>{def.meta.market === "A" ? "A 股" : "港股"}</strong>
              指数：股息率与 <strong>{bondLabel}</strong>{" "}
              对齐至同一交易日；时间段与上方市场表现图联动，数据为指数与国债收益率序列，不含
              ETF。
              <span className="mt-1 block text-xs fin-muted-text">
                仅作配置观察参考，非投资建议，非交易信号。
              </span>
            </p>
            {def.meta.market === "H" ? (
              <div className="mt-3">
                <BondAnchorToggle
                  value={hkBondAnchor}
                  onChange={setHkBondAnchor}
                />
                <p className="mt-2 text-[11px] fin-muted-text">
                  切换基准后，利差、分位与下图将按所选国债收益率重新计算。
                </p>
              </div>
            ) : null}
          </div>
          {spreadRows.length > 0 ? (
            <>
              <div className="grid gap-3 md:grid-cols-4">
                <div
                  className={`rounded-2xl border p-4 md:col-span-2 ${allocationAdvice.tone}`}
                >
                  <p className="text-sm font-semibold">
                    {allocationAdvice.title}
                  </p>
                  {allocationAdvice.body ? (
                    <p className="mt-2 text-xs leading-relaxed">
                      {allocationAdvice.body}
                    </p>
                  ) : null}
                </div>
                <div className="fin-panel p-4">
                  <p className="text-xs fin-muted-text">当前股息率</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-[var(--fin-text)]">
                    {formatPct(latestSpreadPoint?.divYieldPct)}
                  </p>
                  <p className="mt-2 text-xs fin-muted-text">
                    股息率越高，红利资产的现金回报吸引力越强
                  </p>
                </div>
                <div className="fin-panel p-4">
                  <p className="text-xs fin-muted-text">当前股债利差</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-[var(--fin-text)]">
                    {formatPct(latestSpreadPoint?.spreadPct)}
                  </p>
                  <p className="mt-2 text-xs fin-muted-text">
                    利差越高，红利相对债券的补偿越充分
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-[11px] fin-muted-text">
                <span className="rounded border border-fin-border px-2 py-1">
                  绿色区域：利差较高，红利相对债券补偿更充分
                </span>
                <span className="rounded border border-fin-border px-2 py-1">
                  灰色区域：利差偏低，需审慎观察
                </span>
                <span className="rounded border border-fin-border px-2 py-1">
                  价格线使用左轴；股息率、国债收益率、利差使用右轴
                </span>
              </div>

              <div className="h-[330px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={tripleChartData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={CHART.gridDash}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: CHART.axisTick }}
                      minTickGap={20}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 11, fill: CHART.axisTick }}
                      width={58}
                      domain={["auto", "auto"]}
                      label={{
                        value: "价格",
                        angle: -90,
                        position: "insideLeft",
                        style: { fontSize: 11, fill: CHART.labelMuted },
                      }}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 11, fill: CHART.axisTick }}
                      width={58}
                      domain={[pctAxisMin, pctAxisMax]}
                      tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
                      label={{
                        value: "收益率 / 利差",
                        angle: 90,
                        position: "insideRight",
                        style: { fontSize: 11, fill: CHART.labelMuted },
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 12,
                        background: CHART.tooltip.background,
                        border: `1px solid ${CHART.tooltip.border}`,
                        color: CHART.tooltip.color,
                      }}
                    />
                    <ReferenceArea
                      yAxisId="right"
                      y1={pctAxisMin}
                      y2={1}
                      fill="#3a4353"
                      fillOpacity={0.24}
                      label={{
                        value: "利差警惕区 <1%",
                        fontSize: 10,
                        fill: CHART.labelMuted,
                      }}
                    />
                    <ReferenceArea
                      yAxisId="right"
                      y1={2.5}
                      y2={pctAxisMax}
                      fill="#1e3a2e"
                      fillOpacity={0.28}
                      label={{
                        value: "利差配置区 ≥2.5%",
                        fontSize: 10,
                        fill: CHART.series.secondary,
                      }}
                    />
                    {latestSpreadPoint?.date ? (
                      <ReferenceLine
                        yAxisId="right"
                        x={latestSpreadPoint.date}
                        stroke="#dc2626"
                        strokeDasharray="4 4"
                        label={{
                          value: "当前",
                          position: "top",
                          fontSize: 11,
                          fill: "#dc2626",
                        }}
                      />
                    ) : null}
                    <Legend
                      verticalAlign="top"
                      align="left"
                      height={32}
                      iconType="line"
                      wrapperStyle={{
                        cursor: "pointer",
                        fontSize: 12,
                        paddingBottom: 8,
                      }}
                      onClick={(item) => toggleSpreadLine(item.dataKey)}
                      formatter={(value, entry) => {
                        const key = String(
                          entry?.dataKey ?? value,
                        ) as SpreadLineKey;
                        const active = visibleSpreadLineKeys.has(key);
                        return (
                          <span
                            className={
                              active
                                ? "fin-muted-text"
                                : "text-[var(--fin-dim)] line-through"
                            }
                          >
                            {String(value)}
                          </span>
                        );
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
                      name={bondYieldSeriesLabel}
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
                      stroke="#cbd5e1"
                      dot={false}
                      strokeWidth={1.8}
                      connectNulls
                      hide={!visibleSpreadLineKeys.has("价格")}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <PercentileMeter
                  label="股息率历史位置"
                  value={dividendHistogram.latest}
                  percentile={dividendHistogram.percentile}
                />
                <PercentileMeter
                  label={`${bondYieldSeriesLabel}历史位置`}
                  value={bondHistogram.latest}
                  percentile={bondHistogram.percentile}
                />
                <PercentileMeter
                  label="股债利差历史位置"
                  value={spreadHistogram.latest}
                  percentile={spreadHistogram.percentile}
                />
              </div>
              <p className="text-[11px] fin-muted-text">
                国债收益率数据月末更新。
              </p>
            </>
          ) : (
            <div className="fin-alert-warn--compact mt-4 p-4 text-sm">
              <p className="font-medium">暂不展示股息率与利差图</p>
              <p className="mt-2 leading-relaxed opacity-90">
                当前尚无可靠的历史股息率序列，股息率与利差图暂无法展示。
              </p>
              <p className="mt-2 text-xs opacity-80">
                国债收益率仍正常展示；股息率不做前向填充或估算补全。
              </p>
            </div>
          )}
        </section>
      ) : null}

      <section
        id="section-products"
        className="fin-section-scroll fin-panel overflow-x-auto p-6"
      >
        <h2 className="text-lg font-semibold text-[var(--fin-text)]">
          跟踪产品
        </h2>
        <p className="mt-1 text-xs fin-muted-text">
          同指数候选 {indexProducts.length} 只（主跟踪{" "}
          {indexProducts.filter((p) => p.isPrimary).length} · 参考{" "}
          {indexProducts.filter((p) => !p.isPrimary).length}
          ）。规模与费率来自基金公告；仅<strong>主跟踪</strong>提供策略回测 /
          盘中监控，参考产品见产品详情。
        </p>
        <IndexTrackingProductsTable products={indexProducts} />
      </section>
    </div>
  );
}
