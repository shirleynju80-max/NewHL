import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { useDataSource } from "../context/DataSourceContext";
import { buildIndexSpreadRows, indexSeriesForMode } from "../data/indexCsv";
import { useHkBondAnchorPreference } from "../hooks/useHkBondAnchorPreference";
import { resolveBondAnchorForIndex } from "../lib/bondAnchor";
import { formatPct, formatPctValue } from "../lib/formatDisplay";
import { primaryProductForIndex } from "../lib/etfProducts";
import {
 CONFIG_DIMENSION_OPTIONS,
 dataAvailabilityLabel,
 dataAvailabilityTone,
 filterIndicesByDimensionOption,
 indexDataAvailability,
 indexStyleTags,
 indexToConfigDimension,
 type ConfigDimensionFilter,
} from "../lib/configFramework";
import {
 calcMetricBlock,
 cleanDateValueSeries,
 sliceSeriesForWindow,
 type DateValuePoint,
 type MetricWindowId,
} from "../lib/indexPanelMetrics";

const STYLE_FILTER_OPTIONS = ["全部风格", "A股", "港股", "低波", "质量", "央企", "红利", "自由现金流"] as const;
type StyleFilter = (typeof STYLE_FILTER_OPTIONS)[number];
type MarketFilter = "all" | "cn" | "hk";
type PerfWindow = "y3" | "y5" | "y10" | "all";

const PERF_WINDOWS: { id: PerfWindow; label: string; metricId: MetricWindowId | "y10" }[] = [
 { id: "y3", label: "近3年", metricId: "y3" },
 { id: "y5", label: "近5年", metricId: "y5" },
 { id: "y10", label: "近10年", metricId: "y10" },
 { id: "all", label: "全周期", metricId: "all" },
];

type SortKey = "annualReturnPct" | "maxDrawdownPct" | "annualVolPct" | "sharpeLike" | "calmarLike";
type SortState = { key: SortKey; dir: "asc" | "desc" };

function isListVisibleIndex(code: string): boolean {
 return code !== "000300";
}

function sliceSeriesYears(series: DateValuePoint[], years: number): DateValuePoint[] {
 const clean = cleanDateValueSeries(series);
 const latest = clean.at(-1)?.date;
 if (!latest) return clean;
 const d = new Date(`${latest}T00:00:00`);
 if (Number.isNaN(d.getTime())) return clean;
 d.setFullYear(d.getFullYear() - years);
 const start = d.toISOString().slice(0, 10);
 return clean.filter((p) => p.date >= start);
}

function metricForWindow(series: DateValuePoint[], win: PerfWindow) {
 if (win === "y10") return calcMetricBlock(sliceSeriesYears(series, 10));
 const id: MetricWindowId = win === "all" ? "all" : win;
 return calcMetricBlock(sliceSeriesForWindow(series, id));
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

function fmtPctCell(v: number | null | undefined): string {
 return formatPct(v);
}

function fmtRatio(v: number | null | undefined): string {
 return formatPctValue(v);
}

function dimOrder(dim: ConfigDimensionFilter | null): number {
 if (dim === "cash_creation") return 0;
 if (dim === "shareholder_return") return 1;
 return 2;
}

export function IndicesListPage() {
  const { indices, etfProducts, bondByDate, publicCsvAutoLoading } = useDataSource();
  const [hkBondAnchor] = useHkBondAnchorPreference();
 const [searchParams] = useSearchParams();
 const dimParam = searchParams.get("dim");
 const initialDim: ConfigDimensionFilter =
 dimParam === "cash_creation" || dimParam === "shareholder_return" ? dimParam : "all";

 const [dimension, setDimension] = useState<ConfigDimensionFilter>(initialDim);
 const [market, setMarket] = useState<MarketFilter>("all");
 const [styleFilter, setStyleFilter] = useState<StyleFilter>("全部风格");
 const [perfWindow, setPerfWindow] = useState<PerfWindow>("y5");
 const [sort, setSort] = useState<SortState>({ key: "calmarLike", dir: "desc" });
 const [compactTable, setCompactTable] = useState(true);

 const dimensionCounts = useMemo(() => {
 const counts: Record<ConfigDimensionFilter, number> = { all: 0, cash_creation: 0, shareholder_return: 0 };
 for (const ix of indices) {
 if (!isListVisibleIndex(ix.meta.index_code)) continue;
 const dim = indexToConfigDimension(ix.meta.category);
 if (!dim) continue;
 counts.all += 1;
 counts[dim] += 1;
 }
 return counts;
 }, [indices]);

 const rows = useMemo(() => {
 const list = filterIndicesByDimensionOption(
 indices.filter((ix) => isListVisibleIndex(ix.meta.index_code)),
 dimension
 )
 .filter((ix) => {
 if (market === "all") return true;
 return marketOf(ix.meta.category) === market;
 })
 .filter((ix) => {
 if (styleFilter === "全部风格") return true;
 return indexStyleTags(ix.meta).includes(styleFilter);
 })
 .map((def) => {
 const tri = indexSeriesForMode(def.bars, "tri");
 const mb = metricForWindow(tri, perfWindow);
 const primary = primaryProductForIndex(etfProducts, def.meta.index_code);
 const dim = indexToConfigDimension(def.meta.category);
      const spreadRows = buildIndexSpreadRows(
        def,
        bondByDate,
        def.meta.market === "H" ? hkBondAnchor : resolveBondAnchorForIndex(def)
      );
 const latestSpread = spreadRows.at(-1);
 const showSpread = dim === "shareholder_return" && spreadRows.length > 0;
 return {
 def,
 dim,
 tags: indexStyleTags(def.meta),
 avail: indexDataAvailability(def),
 primary,
 mb,
 sharpe: sharpeLike(mb.annualReturnPct, mb.annualVolPct),
 divYield: showSpread ? latestSpread?.divYieldPct : null,
 spread: showSpread ? latestSpread?.spreadPct : null,
 };
 });

 list.sort((a, b) => {
 const da = dimOrder(a.dim);
 const db = dimOrder(b.dim);
 if (da !== db) return da - db;
 const mul = sort.dir === "asc" ? 1 : -1;
 const pick = (row: (typeof list)[number]) => {
 if (sort.key === "maxDrawdownPct") return row.mb.maxDrawdownPct ?? -Infinity;
 if (sort.key === "annualVolPct") return row.mb.annualVolPct ?? -Infinity;
 if (sort.key === "sharpeLike") return row.sharpe ?? -Infinity;
 if (sort.key === "calmarLike") return row.mb.calmar ?? -Infinity;
 return row.mb.annualReturnPct ?? -Infinity;
 };
 const diff = (pick(a) - pick(b)) * mul;
 if (diff !== 0) return diff;
 return a.def.meta.name.localeCompare(b.def.meta.name, "zh-Hans-CN");
 });
 return list;
 }, [indices, dimension, market, styleFilter, perfWindow, etfProducts, bondByDate, sort, hkBondAnchor]);

 function onSort(key: SortKey) {
 setSort((prev) => {
 if (prev.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
 const defaultDir = key === "maxDrawdownPct" || key === "annualVolPct" ? "asc" : "desc";
 return { key, dir: defaultDir };
 });
 }

 function sortMark(key: SortKey) {
 if (sort.key !== key) return "";
 return sort.dir === "asc" ? " ↑" : " ↓";
 }

 return (
 <div className="space-y-6">
      <PageHeader
        kicker="研究层"
        title="指数研究"
        breadcrumbs={[
          { label: "配置总览", to: "/" },
          { label: "指数研究" },
        ]}
        description={
          <>
            全收益（TRI）口径，用于理解不同指数的风险收益特征。
            <strong className="font-medium text-[var(--fin-text)]"> 表格排序便于研究对比，不是买入排行榜</strong>
            ；落地产品请进入
            <Link to="/products" className="mx-1 fin-link">
              产品选择
            </Link>
            。
          </>
        }
      />

 <section className="fin-panel space-y-4 p-4">
 <div className="flex flex-wrap gap-2">
 <span className="fin-label w-full sm:mr-1 sm:w-auto">维度</span>
 {(["all", ...CONFIG_DIMENSION_OPTIONS.map((o) => o.id)] as ConfigDimensionFilter[]).map((id) => (
 <button
 key={id}
 type="button"
 onClick={() => setDimension(id)}
 className={`fin-chip-filter ${dimension === id ? "fin-chip-filter-active" : ""}`}
 >
 {id === "all" ? `全部 ${dimensionCounts.all}` : `${CONFIG_DIMENSION_OPTIONS.find((o) => o.id === id)?.title} ${dimensionCounts[id]}`}
 </button>
 ))}
 </div>

 <div className="flex flex-wrap items-end gap-4">
 <label className="text-sm">
 <span className="fin-label">市场</span>
 <select
 className="fin-interactive mt-1 block rounded border border-fin-border bg-white px-2 py-1.5 text-sm"
 value={market}
 onChange={(e) => setMarket(e.target.value as MarketFilter)}
 >
 <option value="all">全部</option>
 <option value="cn">A 股</option>
 <option value="hk">港股</option>
 </select>
 </label>
 <label className="text-sm">
 <span className="fin-label">风格</span>
 <select
 className="fin-interactive mt-1 block rounded border border-fin-border bg-white px-2 py-1.5 text-sm"
 value={styleFilter}
 onChange={(e) => setStyleFilter(e.target.value as StyleFilter)}
 >
 {STYLE_FILTER_OPTIONS.map((s) => (
 <option key={s} value={s}>
 {s}
 </option>
 ))}
 </select>
 </label>
 <div>
 <span className="fin-label">时间窗</span>
 <div className="mt-1 flex flex-wrap gap-1">
 {PERF_WINDOWS.map((w) => (
 <button
 key={w.id}
 type="button"
 onClick={() => setPerfWindow(w.id)}
 className={`fin-chip-filter ${perfWindow === w.id ? "fin-chip-filter-active" : ""}`}
 >
 {w.label}
 </button>
 ))}
 </div>
 </div>
 <button
 type="button"
 onClick={() => setCompactTable((v) => !v)}
 className="fin-chip-filter ml-auto"
 aria-pressed={compactTable}
 >
 {compactTable ? "显示全部列" : "简略列"}
 </button>
 </div>
 </section>

 {publicCsvAutoLoading ?
 <p className="text-sm fin-muted-text">正在加载指数数据…</p>
 : rows.length === 0 ?
 <p className="text-sm fin-muted-text">当前筛选条件下没有指数。</p>
 : (
 <div className="fin-panel overflow-x-auto">
 <table className={`w-full text-sm ${compactTable ? "min-w-[720px]" : "min-w-[1100px]"}`}>
 <thead>
 <tr className="fin-table-head">
 <th className="px-3 py-2 font-normal text-left">指数</th>
 <th className="px-3 py-2 font-normal">维度</th>
 {!compactTable ?
 <>
 <th className="px-3 py-2 font-normal">风格</th>
 <th className="px-3 py-2 font-normal">起始</th>
 </>
 : null}
 <th className="px-3 py-2 font-normal">
 <button
 type="button"
 className="fin-interactive hover:text-[var(--fin-blue)]"
 onClick={() => onSort("annualReturnPct")}
 >
 年化{sortMark("annualReturnPct")}
 </button>
 </th>
 <th className="px-3 py-2 font-normal">
 <button
 type="button"
 className="fin-interactive hover:text-[var(--fin-blue)]"
 onClick={() => onSort("maxDrawdownPct")}
 >
 回撤{sortMark("maxDrawdownPct")}
 </button>
 </th>
 {!compactTable ?
 <th className="px-3 py-2 font-normal">
 <button
 type="button"
 className="fin-interactive hover:text-[var(--fin-blue)]"
 onClick={() => onSort("annualVolPct")}
 >
 波动{sortMark("annualVolPct")}
 </button>
 </th>
 : null}
 {!compactTable ?
 <th className="px-3 py-2 font-normal" title="年化收益÷年化波动，非真实夏普">
 <button
 type="button"
 className="fin-interactive hover:text-[var(--fin-blue)]"
 onClick={() => onSort("sharpeLike")}
 >
 风险收益比{sortMark("sharpeLike")}
 </button>
 </th>
 : null}
 <th className="px-3 py-2 font-normal">
 <button
 type="button"
 className="fin-interactive hover:text-[var(--fin-blue)]"
 onClick={() => onSort("calmarLike")}
 >
 卡玛{sortMark("calmarLike")}
 </button>
 </th>
 <th className="px-3 py-2 font-normal">股息率/利差</th>
 <th className="px-3 py-2 font-normal">主跟踪</th>
 <th className="px-3 py-2 font-normal">状态</th>
 <th className="px-3 py-2 font-normal">操作</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-fin-border">
 {rows.map(({ def, tags, avail, primary, mb, sharpe, divYield, spread }) => {
 const tone = dataAvailabilityTone(avail);
 return (
 <tr key={def.meta.index_code} className="fin-row-hover">
 <td className="px-3 py-2">
 <Link to={`/indices/${encodeURIComponent(def.meta.index_code)}`} className="font-medium text-[var(--fin-text)] fin-link">
 {def.meta.name}
 </Link>
 <p className="font-mono text-xs fin-muted-text">{def.meta.index_code}</p>
 </td>
 <td className="px-3 py-2 text-xs fin-muted-text">{def.meta.category}</td>
 {!compactTable ?
 <>
 <td className="max-w-[8rem] truncate px-3 py-2 text-xs fin-muted-text" title={tags.join("、")}>
 {tags.slice(0, 2).join("、") || "—"}
 </td>
 <td className="px-3 py-2 font-mono text-xs">{mb.startDate ?? "—"}</td>
 </>
 : null}
 <td className="px-3 py-2 font-mono text-xs">{fmtPctCell(mb.annualReturnPct)}</td>
 <td className="px-3 py-2 font-mono text-xs">{fmtPctCell(mb.maxDrawdownPct)}</td>
 {!compactTable ?
 <td className="px-3 py-2 font-mono text-xs">{fmtPctCell(mb.annualVolPct)}</td>
 : null}
 {!compactTable ?
 <td className="px-3 py-2 font-mono text-xs">{fmtRatio(sharpe)}</td>
 : null}
 <td className="px-3 py-2 font-mono text-xs">{fmtRatio(mb.calmar)}</td>
 <td className="px-3 py-2 font-mono text-xs">
 {divYield != null ?
 <>
 {fmtPctCell(divYield)}
 {spread != null ? <span className="text-[var(--fin-dim)]"> / {fmtPctCell(spread)}</span> : null}
 </>
 : "—"}
 </td>
 <td className="px-3 py-2 font-mono text-xs">
 {primary ?
 <Link to={`/etf/${encodeURIComponent(primary.code)}`} className="fin-link">
 {primary.code}
 </Link>
 : "—"}
 </td>
 <td className="px-3 py-2">
 <span
 className={`rounded border px-1.5 py-0.5 text-[10px] ${
 tone === "good"
 ? "border-emerald-200 bg-emerald-50 text-emerald-800"
 : tone === "warn"
 ? "border-amber-200 bg-amber-50 text-amber-900"
 : "border-fin-border fin-muted-text"
 }`}
 >
 {dataAvailabilityLabel(avail)}
 </span>
 </td>
 <td className="px-3 py-2 whitespace-nowrap text-xs">
 <Link to={`/indices/${encodeURIComponent(def.meta.index_code)}`} className="fin-link">
 详情
 </Link>
 {primary ?
 <>
 <span className="mx-1 text-zinc-300">|</span>
 <Link to={`/etf/${encodeURIComponent(primary.code)}`} className="fin-link">
 ETF
 </Link>
 </>
 : null}
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 <p className="border-t border-fin-border px-3 py-2 text-xs fin-muted-text">
 全周期列显示各指数基日起始；风险收益比 = 年化收益 ÷ 年化波动（类夏普，非无风险夏普）。
 </p>
 </div>
 )}
 </div>
 );
}
