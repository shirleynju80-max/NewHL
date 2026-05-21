import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDataSource } from "../context/DataSourceContext";
import type { IndexTrackingRow } from "../types";
import { buildSeriesOverviewRowFromNav, type SeriesOverviewRow } from "../lib/compareEtfs";
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

const STYLE_FILTER_OPTIONS = ["全部风格", "A股", "港股", "低波", "质量", "央企", "红利", "自由现金流"] as const;
type StyleFilter = (typeof STYLE_FILTER_OPTIONS)[number];

type InceptionFilter = "all" | "lt2015" | "y2015_2019" | "y2020_2024" | "ge2025" | "unknown";

const INCEPTION_FILTERS: { id: InceptionFilter; label: string }[] = [
  { id: "all", label: "全部成立期" },
  { id: "lt2015", label: "2015 年前" },
  { id: "y2015_2019", label: "2015–2019" },
  { id: "y2020_2024", label: "2020–2024" },
  { id: "ge2025", label: "2025 年及以后" },
  { id: "unknown", label: "未填成立日" },
];

function isListVisibleIndex(code: string): boolean {
  return code !== "000300";
}

function inceptionBucket(d: string | undefined): InceptionFilter {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return "unknown";
  const y = Number(d.slice(0, 4));
  if (y < 2015) return "lt2015";
  if (y <= 2019) return "y2015_2019";
  if (y <= 2024) return "y2020_2024";
  return "ge2025";
}

function indexTriNav(def: { bars: { date: string; tri_close: number }[] }): { closes: number[]; dates: string[] } | null {
  const sorted = [...def.bars].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 20) return null;
  return { closes: sorted.map((b) => b.tri_close), dates: sorted.map((b) => b.date) };
}

function fmtBlock(b: SeriesOverviewRow["all"], key: "annualReturnPct" | "maxDrawdownPct" | "annualVolPct"): string {
  if (!b) return "—";
  const v = b[key];
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "—";
}

function fmtAnn(row: SeriesOverviewRow | null, win: "all" | "y1" | "y3" | "y5"): string {
  if (!row) return "—";
  const b = win === "all" ? row.all : win === "y1" ? row.y1 : win === "y3" ? row.y3 : row.y5;
  return fmtBlock(b, "annualReturnPct");
}

export function IndicesListPage() {
  const { indices, indexTracking, publicCsvAutoLoading } = useDataSource();
  const [dimension, setDimension] = useState<ConfigDimensionFilter>("shareholder_return");
  const [styleFilter, setStyleFilter] = useState<StyleFilter>("全部风格");
  const [inc, setInc] = useState<InceptionFilter>("all");

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

  const primaryTrackingByIndex = useMemo(() => {
    const map = new Map<string, IndexTrackingRow>();
    for (const row of indexTracking) {
      if (!map.has(row.index_code)) map.set(row.index_code, row);
    }
    return map;
  }, [indexTracking]);

  const rows = useMemo(() => {
    const list = filterIndicesByDimensionOption(
      indices.filter((ix) => isListVisibleIndex(ix.meta.index_code)),
      dimension
    )
      .filter((ix) => (inc === "all" ? true : inceptionBucket(ix.meta.inception_date) === inc))
      .filter((ix) => {
        if (styleFilter === "全部风格") return true;
        return indexStyleTags(ix.meta).includes(styleFilter);
      })
      .map((def) => {
        const nav = indexTriNav(def);
        const overview =
          nav ? buildSeriesOverviewRowFromNav(nav.closes, nav.dates, def.meta.index_code, def.meta.name) : null;
        return { def, barDays: def.bars.length, overview, tags: indexStyleTags(def.meta) };
      });
    list.sort((a, b) => {
      if (a.barDays === 0 && b.barDays > 0) return 1;
      if (a.barDays > 0 && b.barDays === 0) return -1;
      return a.def.meta.name.localeCompare(b.def.meta.name, "zh-Hans-CN");
    });
    return list;
  }, [indices, dimension, styleFilter, inc]);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 tracking-tight">指数研究</h1>
          <p className="mt-2 text-sm text-zinc-500 max-w-2xl">
            按配置维度研究指数：现金创造看长期质量底仓；股东回报可看股息率与利差。不做简单收益排行榜。
          </p>
        </div>
        <p className="text-xs text-zinc-500">
          当前 {rows.length} 个 · 有行情 {rows.filter((r) => r.barDays > 0).length} 个
        </p>
      </header>

      <section className="rounded-lg border border-zinc-100 bg-white p-5 shadow-sm space-y-5">
        <div>
          <p className="text-xs font-medium text-zinc-600">一级维度</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDimension("all")}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                dimension === "all" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
              }`}
            >
              全部（{dimensionCounts.all}）
            </button>
            {CONFIG_DIMENSION_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setDimension(opt.id)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  dimension === opt.id ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                }`}
              >
                {opt.title}（{dimensionCounts[opt.id]}）
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-zinc-100 bg-zinc-50/60 p-4 sm:flex-row sm:items-end sm:gap-6">
          <label className="flex w-full shrink-0 flex-col gap-1 text-sm sm:w-40">
            <span className="text-xs font-medium text-zinc-600">二级风格</span>
            <select
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900"
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
          <label className="flex w-full shrink-0 flex-col gap-1 text-sm sm:w-44">
            <span className="text-xs font-medium text-zinc-600">成立时间</span>
            <select
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900"
              value={inc}
              onChange={(e) => setInc(e.target.value as InceptionFilter)}
            >
              {INCEPTION_FILTERS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="text-xs text-zinc-500 leading-relaxed">
          绩效仅基于指数全收益 tri_close；红利类详情页可查看股息率与利差。高级多标的对比见配置总览底部折叠区。
        </p>

        {publicCsvAutoLoading ?
          <p className="rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-6 text-sm text-zinc-500">
            正在加载指数数据...
          </p>
        : indices.length === 0 ?
          <p className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-6 text-sm text-amber-900">
            暂无指数 CSV。请确认 `public/data/indices.csv` 与 `public/data/index_bars.csv` 已随构建发布。
          </p>
        : rows.length === 0 ? (
          <p className="rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-6 text-sm text-zinc-500">
            当前筛选条件下没有指数。
          </p>
        )
        : (
          <div className="grid gap-3">
            {rows.map(({ def, barDays, overview, tags }) => {
              const primaryTrackingRow = primaryTrackingByIndex.get(def.meta.index_code);
              const avail = indexDataAvailability(def);
              const availTone = dataAvailabilityTone(avail);
              return (
                <div
                  key={def.meta.index_code}
                  className="group rounded-lg border border-zinc-100 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-indigo-50/30 hover:shadow-md"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-base font-semibold text-zinc-900 group-hover:text-indigo-700">{def.meta.name}</p>
                        <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600 group-hover:border-indigo-200 group-hover:bg-white">
                          {def.meta.category}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                            availTone === "good"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : availTone === "warn"
                                ? "border-amber-200 bg-amber-50 text-amber-800"
                                : "border-zinc-200 bg-zinc-100 text-zinc-600"
                          }`}
                        >
                          {dataAvailabilityLabel(avail)}
                        </span>
                        {tags.slice(0, 4).map((t) => (
                          <span
                            key={t}
                            className="rounded-full border border-indigo-100 bg-indigo-50/50 px-2 py-0.5 text-[10px] text-indigo-800"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                      <p className="mt-1 font-mono text-xs text-zinc-500">
                        {def.meta.index_code} · 成立日 {def.meta.inception_date ?? "—"} · {barDays} 个指数交易日
                      </p>
                    </div>
                    <Link
                      to={`/indices/${encodeURIComponent(def.meta.index_code)}`}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white opacity-90 transition hover:bg-indigo-700 group-hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      查看详情
                    </Link>
                  </div>

                  <div className="mt-4 grid gap-3 text-xs sm:grid-cols-3 lg:grid-cols-7">
                    <div>
                      <p className="text-zinc-500">全样本年化</p>
                      <p className="mt-1 font-mono font-semibold text-zinc-900">{fmtAnn(overview, "all")}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500">全样本回撤</p>
                      <p className="mt-1 font-mono font-semibold text-zinc-900">
                        {overview?.all ? fmtBlock(overview.all, "maxDrawdownPct") : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-zinc-500">全样本波动</p>
                      <p className="mt-1 font-mono font-semibold text-zinc-900">
                        {overview?.all ? fmtBlock(overview.all, "annualVolPct") : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-zinc-500">近1年年化</p>
                      <p className="mt-1 font-mono font-semibold text-zinc-900">{fmtAnn(overview, "y1")}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500">近3年年化</p>
                      <p className="mt-1 font-mono font-semibold text-zinc-900">{fmtAnn(overview, "y3")}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500">近5年年化</p>
                      <p className="mt-1 font-mono font-semibold text-zinc-900">{fmtAnn(overview, "y5")}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500">主跟踪产品</p>
                      {primaryTrackingRow ?
                        <Link
                          to={`/etf/${encodeURIComponent(primaryTrackingRow.etf_code)}`}
                          className="mt-1 inline-block font-mono font-semibold text-indigo-600 hover:underline"
                        >
                          {primaryTrackingRow.etf_code}
                        </Link>
                      : (
                        <p className="mt-1 font-mono font-semibold text-zinc-900">—</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="text-center text-xs text-zinc-400">
        详情页仅使用指数序列；跟踪产品仅提供跳转链接，不混入指数指标计算。
      </p>
    </div>
  );
}
