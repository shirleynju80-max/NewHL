import { useDeferredValue, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EtfProductCodeLink } from "../components/EtfProductDetailLink";
import { IndexOfficialIntroLink } from "../components/IndexOfficialIntroLink";
import { PageHeader } from "../components/PageHeader";
import {
  FilterChipCount,
  FilterGroup,
  FilterSep,
} from "../components/FilterToolbar";
import { useDataSource } from "../context/DataSourceContext";
import { buildIndexSpreadRows, indexSeriesForMode } from "../data/indexCsv";
import { useHkBondAnchorPreference } from "../hooks/useHkBondAnchorPreference";
import { resolveBondAnchorForIndex } from "../lib/bondAnchor";
import { formatPct, formatPctValue } from "../lib/formatDisplay";
import {
  primaryProductForIndex,
  type EtfProductRecord,
} from "../lib/etfProducts";
import type { EtfDefinition, IndexDefinition } from "../types";
import {
  CONFIG_DIMENSION_OPTIONS,
  INDEX_META_DATE_FOOTNOTE,
  dataAvailabilityLabel,
  dataAvailabilityTone,
  filterIndicesByDimensionOption,
  indexDataAvailability,
  indexStyleTags,
  indexToConfigDimension,
  type ConfigDimensionFilter,
} from "../lib/configFramework";
import {
  indexOfficialIntroUrl,
  indicesMissingOfficialIntro,
} from "../lib/indexOfficialLinks";
import {
  calcMetricBlockForWindow,
  isMetricWindowSatisfied,
  type DateValuePoint,
  type MetricWindowId,
} from "../lib/indexPanelMetrics";

type MarketFilter = "all" | "cn" | "hk";
type InceptionFilter = "all" | "y5" | "y10";
type PerfWindow = "ytd" | "y1" | "y3" | "y5" | "y10" | "all";

const MARKET_OPTIONS: { id: MarketFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "cn", label: "A股" },
  { id: "hk", label: "港股" },
];

const INCEPTION_OPTIONS: {
  id: InceptionFilter;
  label: string;
  minYears: number | null;
}[] = [
  { id: "all", label: "全部", minYears: null },
  { id: "y5", label: "满5年", minYears: 5 },
  { id: "y10", label: "满10年", minYears: 10 },
];

const PERF_WINDOWS: {
  id: PerfWindow;
  label: string;
  metricId: MetricWindowId;
}[] = [
  { id: "ytd", label: "今年来", metricId: "ytd" },
  { id: "y1", label: "近1年", metricId: "y1" },
  { id: "y3", label: "近3年", metricId: "y3" },
  { id: "y5", label: "近5年", metricId: "y5" },
  { id: "y10", label: "近10年", metricId: "y10" },
  { id: "all", label: "全周期", metricId: "all" },
];

type SortKey =
  | "dimension"
  | "baseDate"
  | "inceptionDate"
  | "annualReturnPct"
  | "maxDrawdownPct"
  | "annualVolPct"
  | "sharpeLike"
  | "calmarLike";
type SortState = { key: SortKey; dir: "asc" | "desc" };

function dateToSortValue(iso: string | null | undefined): number {
  if (!iso?.trim()) return Number.NaN;
  const t = new Date(`${iso.trim()}T00:00:00`).getTime();
  return Number.isNaN(t) ? Number.NaN : t;
}

function metricToSortValue(v: number | null | undefined): number {
  return v == null || Number.isNaN(v) ? Number.NaN : v;
}

/** Null/missing values always sort last; asc = smaller first, desc = larger first. */
function compareSortValues(a: number, b: number, dir: "asc" | "desc"): number {
  const aMissing = Number.isNaN(a);
  const bMissing = Number.isNaN(b);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return dir === "asc" ? a - b : b - a;
}

function fmtMetaDate(iso: string | null | undefined): string {
  return iso?.trim() ? iso.trim() : "—";
}

const SHORT_INCEPTION_YEARS = 3;

function yearsSinceInception(iso: string | null | undefined): number | null {
  const s = iso?.trim();
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

function isShortInception(iso: string | null | undefined): boolean {
  const years = yearsSinceInception(iso);
  return years != null && years < SHORT_INCEPTION_YEARS;
}

function meetsInceptionMin(
  iso: string | null | undefined,
  minYears: number,
): boolean {
  const years = yearsSinceInception(iso);
  return years != null && years >= minYears;
}

function isListVisibleIndex(code: string): boolean {
  return code !== "000300";
}

function metricForWindow(series: DateValuePoint[], win: PerfWindow) {
  const id: MetricWindowId = win === "all" ? "all" : win;
  return calcMetricBlockForWindow(series, id);
}

import { SP_INDEX_ETF_PROXY_CODES } from "../lib/indexEtfProxy";

function etfCloseSeries(etf: EtfDefinition | undefined): DateValuePoint[] {
  if (!etf?.bars.length) return [];
  return etf.bars
    .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
    .map((bar) => ({ date: bar.date, value: bar.close }));
}

function listMetricSeriesForIndex(
  def: IndexDefinition,
  primaryEtf: EtfDefinition | undefined,
): DateValuePoint[] {
  const tri = indexSeriesForMode(def.bars, "tri");
  if (tri.length || !SP_INDEX_ETF_PROXY_CODES.has(def.meta.index_code))
    return tri;
  return etfCloseSeries(primaryEtf);
}

function sharpeLike(ann: number | null, vol: number | null): number | null {
  if (ann == null || vol == null || vol < 1e-6) return null;
  return Math.round((ann / vol) * 100) / 100;
}

function marketOf(category: string): "cn" | "hk" | null {
  if (category === "港股红利") return "hk";
  if (category === "A股红利" || category === "现金流") return "cn";
  return null;
}

function fmtPctCell(
  v: number | null | undefined,
  windowSatisfied = true,
): string {
  if (!windowSatisfied) return "/";
  return formatPct(v);
}

function fmtRatio(
  v: number | null | undefined,
  windowSatisfied = true,
): string {
  if (!windowSatisfied) return "/";
  return formatPctValue(v);
}

function dimOrder(dim: ConfigDimensionFilter | null): number {
  if (dim === "cash_creation") return 0;
  if (dim === "shareholder_return") return 1;
  return 2;
}

function indexMatchesSearch(
  indexCode: string,
  indexName: string,
  category: string,
  tags: string[],
  primaryCode: string | undefined,
  primaryName: string | undefined,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    indexCode,
    indexName,
    category,
    ...tags,
    primaryCode,
    primaryName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/** 在当前维度/市场/搜索下，符合成立年限门槛的指数只数（chip 上的筛选计数） */
function countFilteredIndices(
  indices: IndexDefinition[],
  etfProducts: EtfProductRecord[],
  query: string,
  dimension: ConfigDimensionFilter,
  market: MarketFilter,
  inceptionMinYears: number | null,
): number {
  let n = 0;
  for (const ix of indices) {
    if (!isListVisibleIndex(ix.meta.index_code)) continue;
    if (!indexToConfigDimension(ix.meta.category)) continue;
    if (filterIndicesByDimensionOption([ix], dimension).length === 0) continue;
    if (market !== "all" && marketOf(ix.meta.category) !== market) continue;
    if (
      inceptionMinYears != null &&
      !meetsInceptionMin(ix.meta.inception_date, inceptionMinYears)
    ) {
      continue;
    }
    const primary = primaryProductForIndex(etfProducts, ix.meta.index_code);
    if (
      !indexMatchesSearch(
        ix.meta.index_code,
        ix.meta.name,
        ix.meta.category,
        indexStyleTags(ix.meta),
        primary?.code,
        primary?.name,
        query,
      )
    ) {
      continue;
    }
    n += 1;
  }
  return n;
}

export function IndicesListPage() {
  const {
    indices,
    etfProducts,
    bondByDate,
    publicCsvAutoLoading,
    getEtf,
  } = useDataSource();
  const [hkBondAnchor] = useHkBondAnchorPreference();
  const [searchParams] = useSearchParams();
  const dimParam = searchParams.get("dim");
  const initialDim: ConfigDimensionFilter =
    dimParam === "cash_creation" || dimParam === "shareholder_return"
      ? dimParam
      : "all";

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [dimension, setDimension] = useState<ConfigDimensionFilter>(initialDim);
  const [market, setMarket] = useState<MarketFilter>("all");
  const [inceptionFilter, setInceptionFilter] =
    useState<InceptionFilter>("all");

  const missingIntroLabels = useMemo(
    () =>
      indicesMissingOfficialIntro(
        indices.filter((ix) => isListVisibleIndex(ix.meta.index_code)),
      ),
    [indices],
  );

  const [perfWindow, setPerfWindow] = useState<PerfWindow>("y5");
  const [sort, setSort] = useState<SortState>({
    key: "calmarLike",
    dir: "desc",
  });
  const [compactTable, setCompactTable] = useState(true);

  const activeInceptionMin =
    INCEPTION_OPTIONS.find((o) => o.id === inceptionFilter)?.minYears ?? null;

  const rows = useMemo(() => {
    const list = filterIndicesByDimensionOption(
      indices.filter((ix) => isListVisibleIndex(ix.meta.index_code)),
      dimension,
    )
      .filter((ix) => {
        if (market === "all") return true;
        return marketOf(ix.meta.category) === market;
      })
      .filter((ix) => {
        const opt = INCEPTION_OPTIONS.find((o) => o.id === inceptionFilter);
        if (!opt?.minYears) return true;
        return meetsInceptionMin(ix.meta.inception_date, opt.minYears);
      })
      .filter((ix) => {
        const primary = primaryProductForIndex(etfProducts, ix.meta.index_code);
        return indexMatchesSearch(
          ix.meta.index_code,
          ix.meta.name,
          ix.meta.category,
          indexStyleTags(ix.meta),
          primary?.code,
          primary?.name,
          deferredQuery,
        );
      })
      .map((def) => {
        const primary = primaryProductForIndex(
          etfProducts,
          def.meta.index_code,
        );
        const primaryEtf = primary ? getEtf(primary.code) : undefined;
        const metricSeries = listMetricSeriesForIndex(def, primaryEtf);
        const metricWindowId: MetricWindowId =
          perfWindow === "all" ? "all" : perfWindow;
        const windowSatisfied = isMetricWindowSatisfied(
          metricSeries,
          metricWindowId,
        );
        const mb = metricForWindow(metricSeries, perfWindow);
        const dim = indexToConfigDimension(def.meta.category);
        const spreadRows = buildIndexSpreadRows(
          def,
          bondByDate,
          def.meta.market === "H"
            ? hkBondAnchor
            : resolveBondAnchorForIndex(def),
        );
        const latestSpread = spreadRows.at(-1);
        const showSpread =
          dim === "shareholder_return" && spreadRows.length > 0;
        return {
          def,
          dim,
          tags: indexStyleTags(def.meta),
          avail: indexDataAvailability(def),
          primary,
          mb,
          windowSatisfied,
          sharpe: sharpeLike(mb.annualReturnPct, mb.annualVolPct),
          baseDate: def.meta.base_date?.trim() || null,
          inceptionDate: def.meta.inception_date?.trim() || null,
          divYield: showSpread ? latestSpread?.divYieldPct : null,
        };
      });

    list.sort((a, b) => {
      const compare = (va: number, vb: number) =>
        compareSortValues(va, vb, sort.dir);
      let diff = 0;
      if (sort.key === "dimension") {
        const cmp = a.def.meta.category.localeCompare(
          b.def.meta.category,
          "zh-Hans-CN",
        );
        diff = sort.dir === "asc" ? cmp : -cmp;
      } else if (sort.key === "baseDate")
        diff = compare(
          dateToSortValue(a.baseDate),
          dateToSortValue(b.baseDate),
        );
      else if (sort.key === "inceptionDate")
        diff = compare(
          dateToSortValue(a.inceptionDate),
          dateToSortValue(b.inceptionDate),
        );
      else if (sort.key === "maxDrawdownPct")
        diff = compare(
          metricToSortValue(a.mb.maxDrawdownPct),
          metricToSortValue(b.mb.maxDrawdownPct),
        );
      else if (sort.key === "annualVolPct")
        diff = compare(
          metricToSortValue(a.mb.annualVolPct),
          metricToSortValue(b.mb.annualVolPct),
        );
      else if (sort.key === "sharpeLike")
        diff = compare(
          metricToSortValue(a.sharpe),
          metricToSortValue(b.sharpe),
        );
      else if (sort.key === "calmarLike")
        diff = compare(
          metricToSortValue(a.mb.calmar),
          metricToSortValue(b.mb.calmar),
        );
      else
        diff = compare(
          metricToSortValue(a.mb.annualReturnPct),
          metricToSortValue(b.mb.annualReturnPct),
        );
      if (diff !== 0) return diff;
      if (sort.key !== "dimension") {
        const da = dimOrder(a.dim);
        const db = dimOrder(b.dim);
        if (da !== db) return da - db;
      }
      return a.def.meta.name.localeCompare(b.def.meta.name, "zh-Hans-CN");
    });
    return list;
  }, [
    indices,
    deferredQuery,
    dimension,
    market,
    inceptionFilter,
    perfWindow,
    etfProducts,
    getEtf,
    bondByDate,
    sort,
    hkBondAnchor,
  ]);

  function onSort(key: SortKey) {
    setSort((prev) => {
      if (prev.key === key)
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      const defaultDir =
        key === "dimension" ||
        key === "maxDrawdownPct" ||
        key === "annualVolPct"
          ? "asc"
          : "desc";
      return { key, dir: defaultDir };
    });
  }

  function sortableTh(
    key: SortKey,
    label: string,
    opts?: { className?: string; title?: string },
  ) {
    return (
      <th
        className={opts?.className ?? "px-3 py-2 font-normal"}
        title={opts?.title}
      >
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

  function sortMark(key: SortKey) {
    if (sort.key !== key) return "";
    return sort.dir === "asc" ? " ↑" : " ↓";
  }

  const hasActiveFilters =
    deferredQuery.trim() !== "" || dimension !== "all" || market !== "all";

  return (
    <div className="ft-page space-y-6">
      <PageHeader
        kicker="研究层"
        title="指数研究"
        breadcrumbs={[{ label: "配置总览", to: "/" }, { label: "指数研究" }]}
      />

      <section className="fin-panel space-y-2 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[min(100%,220px)] flex-1 text-sm">
            <span className="fin-label">搜索</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="指数或 ETF 代码、名称"
              className="fin-select fin-interactive mt-1 block w-full rounded-md border border-fin-border bg-transparent px-3 py-2 text-sm"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button
            type="button"
            onClick={() => setCompactTable((v) => !v)}
            className="fin-chip-filter indices-filter-chip px-2 py-1.5 text-xs"
            aria-pressed={compactTable}
          >
            {compactTable ? "显示全部列" : "简略列"}
          </button>
          {hasActiveFilters ? (
            <button
              type="button"
              className="fin-chip-filter indices-filter-chip px-2 py-1.5 text-xs"
              onClick={() => {
                setQuery("");
                setDimension("all");
                setMarket("all");
                setInceptionFilter("all");
              }}
            >
              重置筛选
            </button>
          ) : null}
        </div>

        <div className="indices-filter-bar flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-fin-border pt-2">
          <FilterGroup label="维度">
            {(
              [
                "all",
                ...CONFIG_DIMENSION_OPTIONS.map((o) => o.id),
              ] as ConfigDimensionFilter[]
            ).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setDimension(id)}
                className={`fin-chip-filter indices-filter-chip ${dimension === id ? "fin-chip-filter-active" : ""}`}
              >
                {id === "all"
                  ? "全部"
                  : CONFIG_DIMENSION_OPTIONS.find((o) => o.id === id)?.title}
                <FilterChipCount
                  count={countFilteredIndices(
                    indices,
                    etfProducts,
                    deferredQuery,
                    id,
                    market,
                    activeInceptionMin,
                  )}
                />
              </button>
            ))}
          </FilterGroup>
          <FilterSep />
          <FilterGroup label="市场">
            {MARKET_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMarket(opt.id)}
                className={`fin-chip-filter indices-filter-chip ${market === opt.id ? "fin-chip-filter-active" : ""}`}
              >
                {opt.label}
                <FilterChipCount
                  count={countFilteredIndices(
                    indices,
                    etfProducts,
                    deferredQuery,
                    dimension,
                    opt.id,
                    activeInceptionMin,
                  )}
                />
              </button>
            ))}
          </FilterGroup>
          <FilterSep />
          <FilterGroup label="成立">
            {INCEPTION_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setInceptionFilter(opt.id)}
                className={`fin-chip-filter indices-filter-chip ${inceptionFilter === opt.id ? "fin-chip-filter-active" : ""}`}
              >
                {opt.label}
                <FilterChipCount
                  count={countFilteredIndices(
                    indices,
                    etfProducts,
                    deferredQuery,
                    dimension,
                    market,
                    opt.minYears,
                  )}
                />
              </button>
            ))}
          </FilterGroup>
          <FilterSep />
          <FilterGroup label="时间窗">
            {PERF_WINDOWS.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setPerfWindow(w.id)}
                className={`fin-chip-filter indices-filter-chip ${perfWindow === w.id ? "fin-chip-filter-active" : ""}`}
              >
                {w.label}
              </button>
            ))}
          </FilterGroup>
        </div>

        {hasActiveFilters ? (
          <p className="text-xs fin-muted-text">当前 {rows.length} 个指数</p>
        ) : null}
      </section>

      {publicCsvAutoLoading ? (
        <p className="text-sm fin-muted-text">正在加载指数数据…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm fin-muted-text">
          暂无符合筛选条件的指数，请调整搜索或筛选条件。
        </p>
      ) : (
        <div className="fin-panel overflow-x-auto">
          <table
            className={`w-full text-sm ${compactTable ? "min-w-[880px]" : "min-w-[1180px]"}`}
          >
            <thead>
              <tr className="fin-table-head">
                <th className="px-3 py-2 font-normal text-left">指数</th>
                {sortableTh("dimension", "维度", {
                  title: "指数分类（A股红利、港股红利、现金流等，点击排序）",
                })}
                {!compactTable ? (
                  <th className="px-3 py-2 font-normal">风格</th>
                ) : null}
                {!compactTable
                  ? sortableTh("baseDate", "基日", {
                      title: "指数基日（编制方案）",
                    })
                  : null}
                {sortableTh("inceptionDate", "成立日", {
                  title: "指数正式发布/成立日",
                })}
                {sortableTh("annualReturnPct", "年化")}
                {sortableTh("maxDrawdownPct", "回撤")}
                {!compactTable ? sortableTh("annualVolPct", "波动") : null}
                {sortableTh("sharpeLike", "收益/波动", {
                  title: "年化收益 ÷ 年化波动，类夏普，非无风险夏普",
                  className: compactTable
                    ? "px-2 py-2 font-normal text-right w-[4.5rem]"
                    : undefined,
                })}
                {sortableTh("calmarLike", "收益/回撤", {
                  title: "年化收益相对最大回撤，越高表示同样回撤下收益越高",
                })}
                <th
                  className={`font-normal ${compactTable ? "px-2 py-2 w-[4.5rem]" : "px-3 py-2"}`}
                >
                  股息率
                </th>
                <th
                  className={`font-normal ${compactTable ? "px-2 py-2 w-[5.5rem]" : "px-3 py-2"}`}
                >
                  主跟踪
                </th>
                {!compactTable ? (
                  <th className="px-3 py-2 font-normal">状态</th>
                ) : null}
                <th
                  className={`font-normal ${compactTable ? "px-2 py-2 w-[5.5rem]" : "px-3 py-2"}`}
                >
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fin-border">
              {rows.map(
                ({
                  def,
                  tags,
                  avail,
                  primary,
                  mb,
                  windowSatisfied,
                  sharpe,
                  baseDate,
                  inceptionDate,
                  divYield,
                }) => {
                  const tone = dataAvailabilityTone(avail);
                  const primaryEtf = primary ? getEtf(primary.code) : undefined;
                  const shortInception = isShortInception(inceptionDate);
                  const inceptionYears = yearsSinceInception(inceptionDate);
                  return (
                    <tr
                      key={def.meta.index_code}
                      className={
                        shortInception
                          ? "fin-row-hover fin-row-inception-short"
                          : "fin-row-hover"
                      }
                    >
                      <td className="px-3 py-2">
                        <Link
                          to={`/indices/${encodeURIComponent(def.meta.index_code)}`}
                          className="font-medium text-[var(--fin-text)] fin-link"
                        >
                          {def.meta.name}
                        </Link>
                        <p className="font-mono text-xs fin-muted-text">
                          {def.meta.index_code}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-xs fin-muted-text">
                        {def.meta.category}
                      </td>
                      {!compactTable ? (
                        <td
                          className="max-w-[8rem] truncate px-3 py-2 text-xs fin-muted-text"
                          title={tags.join("、")}
                        >
                          {tags.slice(0, 2).join("、") || "—"}
                        </td>
                      ) : null}
                      {!compactTable ? (
                        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                          {fmtMetaDate(baseDate)}
                        </td>
                      ) : null}
                      <td
                        className={`px-3 py-2 font-mono text-xs whitespace-nowrap ${
                          shortInception ? "fin-inception-date-short" : ""
                        }`}
                        title={
                          shortInception && inceptionYears != null
                            ? `成立约 ${inceptionYears.toFixed(1)} 年（不足 ${SHORT_INCEPTION_YEARS} 年）`
                            : undefined
                        }
                      >
                        {fmtMetaDate(inceptionDate)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {fmtPctCell(mb.annualReturnPct, windowSatisfied)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {fmtPctCell(mb.maxDrawdownPct, windowSatisfied)}
                      </td>
                      {!compactTable ? (
                        <td className="px-3 py-2 font-mono text-xs">
                          {fmtPctCell(mb.annualVolPct, windowSatisfied)}
                        </td>
                      ) : null}
                      <td className="px-3 py-2 font-mono text-xs">
                        {fmtRatio(sharpe, windowSatisfied)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {fmtRatio(mb.calmar, windowSatisfied)}
                      </td>
                      <td
                        className={`font-mono text-xs ${compactTable ? "px-2" : "px-3 py-2"}`}
                      >
                        {divYield != null ? fmtPctCell(divYield) : "—"}
                      </td>
                      <td
                        className={`font-mono text-xs ${compactTable ? "px-2" : "px-3 py-2"}`}
                      >
                        {primary ? (
                          <EtfProductCodeLink
                            product={primary}
                            etf={primaryEtf}
                            className="fin-link"
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                      {!compactTable ? (
                        <td className="px-3 py-2">
                          <span
                            className={
                              tone === "good"
                                ? "fin-status-good"
                                : tone === "warn"
                                  ? "fin-status-warn"
                                  : "fin-status-neutral"
                            }
                          >
                            {dataAvailabilityLabel(avail)}
                          </span>
                        </td>
                      ) : null}
                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                        <Link
                          to={`/indices/${encodeURIComponent(def.meta.index_code)}`}
                          className="fin-link"
                        >
                          详情
                        </Link>
                        {indexOfficialIntroUrl(def.meta) ? (
                          <>
                            <span className="fin-muted-separator" aria-hidden>
                              |
                            </span>
                            <IndexOfficialIntroLink
                              meta={def.meta}
                              className="fin-link"
                              label="官网"
                            />
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
          <p className="space-y-1 border-t border-fin-border px-3 py-2 text-xs fin-muted-text">
            <span className="block">{INDEX_META_DATE_FOOTNOTE}</span>
            <span className="block">
              标普港股通红利低波指数、标普中国A股大盘红利低波50指数暂未获取数据，用跟踪的
              ETF 行情数据替代。
            </span>
            <span className="block">
              成立日不足 {SHORT_INCEPTION_YEARS} 年：关注数据长度
            </span>
            {missingIntroLabels.length > 0 ? (
              <span className="block">
                暂无编制机构官网介绍链接：
                {missingIntroLabels.join("、")}
              </span>
            ) : null}
          </p>
        </div>
      )}
    </div>
  );
}
