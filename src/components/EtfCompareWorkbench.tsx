import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
 Bar,
 BarChart,
 CartesianGrid,
 Legend,
 ResponsiveContainer,
 Tooltip,
 XAxis,
 YAxis,
} from "recharts";
import { useDataSource } from "../context/DataSourceContext";
import type { EtfDefinition } from "../types";
import { groupEtfsForLanding } from "../lib/configFramework";
import { compareDefinitions, type SeriesMetricBlock } from "../lib/compareEtfs";
import { formatPct } from "../lib/formatDisplay";



const MAX_COMPARE = 8;
const TRADING_1Y = 252;
const TRADING_3Y = 756;
const TRADING_5Y = 1260;

type WindowKey = "all" | "y1" | "y3" | "y5";

const WINDOW_OPTIONS: { key: WindowKey; label: string }[] = [
 { key: "all", label: "全样本" },
 { key: "y1", label: "近1年" },
 { key: "y3", label: "近3年" },
 { key: "y5", label: "近5年" },
];

type SummaryCard = {
 title: string;
 value: string;
 note: string;
 href: string;
 tone: "neutral" | "good" | "warn";
};

type SortKey =
 | "code"
 | "name"
 | "days"
 | "totalReturnPct"
 | "annualReturnPct"
 | "maxDrawdownPct"
 | "annualVolPct"
 | "sharpeLike"
 | "calmarLike";

type SortState = { key: SortKey; dir: "asc" | "desc" };
type CorrOrderMode = "code" | "cluster";

function barsTailByWindow(bars: EtfDefinition["bars"], win: WindowKey) {
 if (win === "all") return bars;
 const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
 const need = win === "y1" ? TRADING_1Y : win === "y3" ? TRADING_3Y : TRADING_5Y;
 return sorted.slice(-need);
}

function corrCellStyle(v: number) {
 if (!Number.isFinite(v)) return { backgroundColor: "transparent", color: "#27272a" };
 const alpha = 0.08 + Math.min(1, Math.abs(v)) * 0.36;
 if (v >= 0) return { backgroundColor: `rgba(239, 68, 68, ${alpha})`, color: v > 0.75 ? "#7f1d1d" : "#3f3f46" };
 return { backgroundColor: `rgba(59, 130, 246, ${alpha})`, color: v < -0.75 ? "#1e3a8a" : "#3f3f46" };
}

/** 贪心聚类序：尽量把高正相关标的排在相邻位置 */
function buildCorrelationClusterOrder(correlation: number[][]): number[] {
 const n = correlation.length;
 if (n <= 2) return Array.from({ length: n }, (_, i) => i);
 const avgCorr = (i: number) => {
 let s = 0;
 for (let j = 0; j < n; j += 1) if (j !== i) s += correlation[i][j];
 return s / Math.max(1, n - 1);
 };
 let seed = 0;
 let bestSeedScore = -Infinity;
 for (let i = 0; i < n; i += 1) {
 const score = avgCorr(i);
 if (score > bestSeedScore) {
 bestSeedScore = score;
 seed = i;
 }
 }
 const used = new Set<number>([seed]);
 const order = [seed];
 while (order.length < n) {
 const cur = order[order.length - 1]!;
 let pick = -1;
 let pickScore = -Infinity;
 for (let j = 0; j < n; j += 1) {
 if (used.has(j)) continue;
 const score = correlation[cur][j];
 if (score > pickScore) {
 pickScore = score;
 pick = j;
 }
 }
 if (pick < 0) break;
 used.add(pick);
 order.push(pick);
 }
 for (let i = 0; i < n; i += 1) if (!used.has(i)) order.push(i);
 return order;
}

function groupDefinitions(defs: EtfDefinition[]) {
 const landing = groupEtfsForLanding(defs);
 return { cn: landing.cn, hk: landing.hk, cf: landing.cash, other: landing.other };
}

/** 总览一行一块：标题 + 该类全部标的（网格换行） */
function PoolSection({
 title,
 items,
 compareCodes,
 toggleCompare,
 selectAllInSection,
 atCapacity,
}: {
 title: string;
 items: EtfDefinition[];
 compareCodes: string[];
 toggleCompare: (code: string) => void;
 selectAllInSection: (codes: string[]) => void;
 atCapacity: boolean;
}) {
 const codes = items.map((e) => e.meta.code);
 const allSelected = codes.length > 0 && codes.every((c) => compareCodes.includes(c));

 return (
 <div className="rounded-lg border border-fin-border bg-fin-panel-muted/40 p-3">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <div className="flex flex-wrap items-baseline gap-2">
 <h3 className="text-sm font-semibold text-[var(--fin-text)]">{title}</h3>
 <span className="text-xs text-[var(--fin-dim)]">{items.length} 只</span>
 </div>
 {items.length > 0 ?
 <button
 type="button"
 onClick={() => selectAllInSection(codes)}
 className="text-xs fin-link"
 >
 {allSelected ? "取消全选" : "全选本类"}
 </button>
 : null}
 </div>
 {items.length === 0 ? (
 <p className="mt-2 text-sm text-[var(--fin-dim)]">暂无</p>
 ) : (
 <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
 {items.map((e) => {
 const checked = compareCodes.includes(e.meta.code);
 const disableNew = atCapacity && !checked;
 const barStart =
 e.bars.length > 0
 ? [...e.bars].sort((a, b) => a.date.localeCompare(b.date))[0]!.date
 : "—";
 return (
 <li
 key={e.meta.code}
 className={`flex gap-1.5 rounded-md border py-1.5 px-2 transition ${
 checked ? "border-[var(--fin-blue)] bg-[var(--fin-blue-soft)]/50" : "border-fin-border bg-white"
 }`}
 >
 <label className={`flex cursor-pointer items-start pt-0.5 ${disableNew ? "opacity-50 cursor-not-allowed" : ""}`}>
 <input
 type="checkbox"
 disabled={disableNew}
 className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-300 text-[var(--fin-blue)] accent-[var(--fin-blue)]"
 checked={checked}
 onChange={() => toggleCompare(e.meta.code)}
 />
 </label>
 <Link
 to={`/etf/${e.meta.code}`}
 className="group min-w-0 flex-1 rounded px-0.5 py-0 transition hover:bg-fin-panel-muted"
 >
 <div className="min-w-0">
 <p className="font-mono text-[9px] text-[var(--fin-dim)]">{e.meta.code}</p>
 <p className="mt-0.5 text-xs font-semibold leading-snug text-[var(--fin-text)] group-hover:text-[var(--fin-blue)] line-clamp-2">
 {e.meta.name}
 </p>
 <p className="mt-0.5 text-[9px] fin-muted-text">
 成立（首交易日）<span className="font-mono fin-muted-text">{barStart}</span>
 </p>
 </div>
 </Link>
 </li>
 );
 })}
 </ul>
 )}
 </div>
 );
}

export function EtfCompareWorkbench() {
 const { definitions } = useDataSource();
 const [compareCodes, setCompareCodes] = useState<string[]>([]);
 const compareInitRef = useRef(false);

 useEffect(() => {
 if (compareInitRef.current || definitions.length < 2) return;
 compareInitRef.current = true;
 const ashare = definitions
 .filter((d) => d.meta.dividend_market_scope === "A股红利")
 .map((d) => d.meta.code);
 const rest = definitions.map((d) => d.meta.code);
 const pick: string[] = [];
 for (const c of [...ashare, ...rest]) {
 if (!pick.includes(c)) pick.push(c);
 if (pick.length >= MAX_COMPARE) break;
 }
 if (pick.length >= 2) setCompareCodes(pick.slice(0, Math.min(MAX_COMPARE, Math.max(2, pick.length))));
 }, [definitions]);

 function toggleCompare(code: string) {
 setCompareCodes((prev) => {
 if (prev.includes(code)) return prev.filter((c) => c !== code);
 if (prev.length >= MAX_COMPARE) return prev;
 return [...prev, code];
 });
 }

 function selectAllInSection(codes: string[]) {
 setCompareCodes((prev) => {
 const allIn = codes.length > 0 && codes.every((c) => prev.includes(c));
 if (allIn) return prev.filter((c) => !codes.includes(c));
 const next = [...prev];
 for (const c of codes) {
 if (next.includes(c)) continue;
 if (next.length >= MAX_COMPARE) break;
 next.push(c);
 }
 return next;
 });
 }

 const compareDefsOrdered = useMemo((): EtfDefinition[] => {
 return compareCodes
 .map((c) => definitions.find((d) => d.meta.code === c))
 .filter((x): x is EtfDefinition => Boolean(x));
 }, [definitions, compareCodes]);

 const [windowKey, setWindowKey] = useState<WindowKey>("y5");

 const compareDefsInWindow = useMemo((): EtfDefinition[] => {
 return compareDefsOrdered.map((d) => ({ ...d, bars: barsTailByWindow(d.bars, windowKey) }));
 }, [compareDefsOrdered, windowKey]);

 const compareResult = useMemo(() => {
 if (compareDefsInWindow.length < 2) return null;
 return compareDefinitions(compareDefsInWindow);
 }, [compareDefsInWindow]);

 const fullCompareResult = useMemo(() => {
 if (compareDefsOrdered.length < 2) return null;
 return compareDefinitions(compareDefsOrdered);
 }, [compareDefsOrdered]);

 const currentWindowLabel = WINDOW_OPTIONS.find((w) => w.key === windowKey)?.label ?? "全样本";
 const [sortState, setSortState] = useState<SortState>({ key: "annualReturnPct", dir: "desc" });
 const [corrOrderMode, setCorrOrderMode] = useState<CorrOrderMode>("cluster");

 const overviewRowsSorted = useMemo(() => {
 if (!compareResult) return [] as { code: string; name: string; seg: SeriesMetricBlock }[];
 const rows = compareResult.overview.map((r) => ({ code: r.code, name: r.name, seg: r.all }));
 const valueOf = (row: (typeof rows)[number]): number | string => {
 if (sortState.key === "code") return row.code;
 if (sortState.key === "name") return row.name;
 if (!row.seg) return Number.NEGATIVE_INFINITY;
 if (sortState.key === "days") return row.seg.days;
 if (sortState.key === "totalReturnPct") return row.seg.totalReturnPct;
 if (sortState.key === "annualReturnPct") return row.seg.annualReturnPct;
 if (sortState.key === "maxDrawdownPct") return row.seg.maxDrawdownPct;
 if (sortState.key === "annualVolPct") return row.seg.annualVolPct;
 if (sortState.key === "sharpeLike") return row.seg.sharpeLike ?? Number.NEGATIVE_INFINITY;
 return row.seg.calmarLike ?? Number.NEGATIVE_INFINITY;
 };
 rows.sort((a, b) => {
 const va = valueOf(a);
 const vb = valueOf(b);
 const mul = sortState.dir === "asc" ? 1 : -1;
 if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * mul;
 return ((Number(va) || 0) - (Number(vb) || 0)) * mul;
 });
 return rows;
 }, [compareResult, sortState]);

 const toggleSort = (key: SortKey) => {
 setSortState((prev) => {
 if (prev.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
 const defaultDir = key === "maxDrawdownPct" || key === "annualVolPct" ? "asc" : "desc";
 return { key, dir: defaultDir };
 });
 };

 const corrOrderedIndices = useMemo(() => {
 if (!compareResult?.correlation) return [] as number[];
 if (corrOrderMode === "code") return compareResult.corrLabels.map((_, i) => i);
 return buildCorrelationClusterOrder(compareResult.correlation);
 }, [compareResult, corrOrderMode]);

 const corrOrderedLabels = useMemo(() => {
 if (!compareResult?.correlation) return [] as string[];
 return corrOrderedIndices.map((i) => compareResult.corrLabels[i]);
 }, [compareResult, corrOrderedIndices]);

 /** 当前时间窗：年化收益 vs 最大回撤（双柱） */
 const overviewDualData = useMemo(() => {
 if (!compareResult) return [];
 return compareResult.overview
 .filter((r) => r.all)
 .map((r) => ({
 code: r.code,
 name: r.name,
 annualReturn: r.all!.annualReturnPct,
 maxDrawdown: r.all!.maxDrawdownPct,
 }));
 }, [compareResult]);

 const groups = useMemo(() => groupDefinitions(definitions), [definitions]);
 const atCapacity = compareCodes.length >= MAX_COMPARE;
 const summaryCards = useMemo<SummaryCard[]>(() => {
 const cards: SummaryCard[] = [
 {
 title: "选池进度",
 value: `${compareCodes.length}/${MAX_COMPARE}`,
 note:
 compareCodes.length >= 2
 ? "已满足对比分析最小要求"
 : "请先勾选至少 2 只标的",
 href: "#etf-pool",
 tone: compareCodes.length >= 2 ? "good" : "warn",
 },
 ];
 if (!fullCompareResult) {
 cards.push(
 {
 title: "近5年优选",
 value: "待生成",
 note: "选择 2 只及以上后自动计算",
 href: "#overview-metrics",
 tone: "neutral",
 },
 {
 title: "风险提示",
 value: "待生成",
 note: "将基于近1年最大回撤给出",
 href: "#overview-metrics",
 tone: "neutral",
 },
 {
 title: "相关性状态",
 value: "待生成",
 note: "选择后可查看相关性矩阵",
 href: "#overview-correlation",
 tone: "neutral",
 }
 );
 return cards;
 }
 const y5Rows = fullCompareResult.overview
 .filter((r) => r.y5)
 .map((r) => ({ code: r.code, name: r.name, block: r.y5! }));
 if (y5Rows.length > 0) {
 const best = [...y5Rows].sort((a, b) => {
 const ac = a.block.calmarLike ?? a.block.annualReturnPct / Math.max(a.block.maxDrawdownPct, 0.01);
 const bc = b.block.calmarLike ?? b.block.annualReturnPct / Math.max(b.block.maxDrawdownPct, 0.01);
 return bc - ac;
 })[0]!;
 const worstDd = [...y5Rows].sort((a, b) => b.block.maxDrawdownPct - a.block.maxDrawdownPct)[0]!;
 cards.push(
 {
 title: "近5年优选",
 value: `${best.code} ${formatPct(best.block.annualReturnPct)}`,
 note: `${best.name} · 卡玛 ${best.block.calmarLike ?? "—"}`,
 href: "#overview-metrics",
 tone: "good",
 },
 {
 title: "风险提示",
 value: `${worstDd.code} 回撤 ${formatPct(worstDd.block.maxDrawdownPct)}`,
 note: "近5年最大回撤最高标的",
 href: "#overview-metrics",
 tone: worstDd.block.maxDrawdownPct >= 20 ? "warn" : "neutral",
 }
 );
 } else {
 cards.push(
 {
 title: "近5年优选",
 value: "样本不足",
 note: "当前标的近5年数据不足",
 href: "#overview-metrics",
 tone: "neutral",
 },
 {
 title: "风险提示",
 value: "样本不足",
 note: "无法计算近5年回撤风险",
 href: "#overview-metrics",
 tone: "neutral",
 }
 );
 }
 if (!compareResult || !compareResult.overlapOk || !compareResult.correlation) {
 cards.push({
 title: "相关性状态",
 value: "不可比",
 note:
 compareResult && compareResult.overlapDates.length > 0
 ? `重合仅 ${compareResult.overlapDates.length} 日`
 : "所选标的无重合交易日",
 href: "#overview-correlation",
 tone: "warn",
 });
 } else {
 let maxCorr = -1;
 for (let i = 0; i < compareResult.correlation.length; i += 1) {
 for (let j = i + 1; j < compareResult.correlation.length; j += 1) {
 maxCorr = Math.max(maxCorr, compareResult.correlation[i][j]);
 }
 }
 cards.push({
 title: "相关性状态",
 value: `最高 ${maxCorr.toFixed(2)}`,
 note: maxCorr >= 0.9 ? "相关性偏高，注意分散不足" : "分散度尚可",
 href: "#overview-correlation",
 tone: maxCorr >= 0.9 ? "warn" : "good",
 });
 }
 return cards;
 }, [compareCodes.length, compareResult, fullCompareResult]);

 return (
 <div className="space-y-8">
 <section className="rounded-lg border border-fin-border bg-white p-5 shadow-sm">
 <div className="flex flex-wrap items-baseline justify-between gap-2">
 <h2 className="text-lg font-semibold text-[var(--fin-text)]">对比摘要</h2>
 <p className="text-xs fin-muted-text">勾选标的后生成</p>
 </div>
 {summaryCards.length > 0 && (
 <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
 {summaryCards.map((card) => (
 <a
 key={card.title}
 href={card.href}
 className={`rounded-lg border px-4 py-3 transition hover:shadow-sm ${
 card.tone === "good"
 ? "border-emerald-200 bg-emerald-50/70"
 : card.tone === "warn"
 ? "border-amber-200 bg-amber-50/70"
 : "border-fin-border bg-fin-panel-muted/60"
 }`}
 >
 <p className="text-xs font-medium fin-muted-text">{card.title}</p>
 <p className="mt-1 text-base font-semibold text-[var(--fin-text)]">{card.value}</p>
 <p className="mt-1 text-[11px] fin-muted-text">{card.note}</p>
 </a>
 ))}
 </div>
 )}
 <nav
 aria-label="对比步骤"
 className="mt-4 flex flex-wrap items-center gap-2 text-xs fin-muted-text"
 >
 <span className="rounded-full bg-zinc-900 px-2.5 py-1 font-medium text-white">① 选标的</span>
 <span className="text-zinc-300">→</span>
 <span className="rounded-full border border-fin-border bg-white px-2.5 py-1 font-medium">② 看收益风险</span>
 <span className="text-zinc-300">→</span>
 <span className="rounded-full border border-fin-border bg-white px-2.5 py-1 font-medium">③ 看相关性</span>
 <span className="text-[var(--fin-dim)]">（最多 {MAX_COMPARE} 只）</span>
 </nav>
 </section>
 <section id="etf-pool" className="rounded-lg border border-fin-border bg-white p-5 shadow-sm">
 <div className="flex flex-wrap items-baseline justify-between gap-2">
 <h2 className="text-lg font-semibold text-[var(--fin-text)]">对比标的池</h2>
 <p className="text-xs fin-muted-text">{definitions.length} 只可选</p>
 </div>
 {compareCodes.length > 0 && (
 <div className="mt-3 flex flex-wrap items-center gap-2">
 <span className="text-xs font-medium fin-muted-text">已选 {compareCodes.length}/{MAX_COMPARE}</span>
 {compareCodes.map((code) => {
 const name = definitions.find((d) => d.meta.code === code)?.meta.name ?? code;
 return (
 <button
 key={code}
 type="button"
 onClick={() => toggleCompare(code)}
 className="inline-flex max-w-[14rem] items-center gap-1 rounded-full border border-fin-border bg-[var(--fin-blue-soft)] px-2.5 py-1 text-xs font-medium text-[var(--fin-text)] hover:bg-[var(--fin-blue-soft)]"
 title={name}
 >
 <span className="font-mono">{code}</span>
 <span aria-hidden className="text-[var(--fin-dim)]">
 ×
 </span>
 </button>
 );
 })}
 <button
 type="button"
 onClick={() => setCompareCodes([])}
 className="text-xs fin-muted-text hover:text-[var(--fin-text)] hover:underline"
 >
 清空
 </button>
 </div>
 )}
 {atCapacity && (
 <p className="mt-2 text-xs text-amber-800">已选满 {MAX_COMPARE} 只，取消勾选后可再选。</p>
 )}
 {definitions.length === 0 ? (
 <p className="mt-8 text-sm fin-muted-text">暂无标的，请检查 CSV。</p>
 ) : (
 <div className="mt-6 flex flex-col gap-4">
 <PoolSection
 title="股东回报 · A股红利"
 items={groups.cn}
 compareCodes={compareCodes}
 toggleCompare={toggleCompare}
 selectAllInSection={selectAllInSection}
 atCapacity={atCapacity}
 />
 <PoolSection
 title="股东回报 · 港股红利"
 items={groups.hk}
 compareCodes={compareCodes}
 toggleCompare={toggleCompare}
 selectAllInSection={selectAllInSection}
 atCapacity={atCapacity}
 />
 <PoolSection
 title="现金创造"
 items={groups.cf}
 compareCodes={compareCodes}
 toggleCompare={toggleCompare}
 selectAllInSection={selectAllInSection}
 atCapacity={atCapacity}
 />
 </div>
 )}
 </section>

 <section id="overview-metrics" className="rounded-lg border border-fin-border bg-white p-5 shadow-sm">
 <div className="flex flex-wrap items-end justify-between gap-3">
 <div>
 <h2 className="text-lg font-semibold text-[var(--fin-text)]">标的概览</h2>
 <p className="mt-1 text-xs fin-muted-text">
 全局时间窗联动收益/风险与相关性矩阵，便于统一口径横向比较。
 </p>
 </div>
 <label className="text-xs fin-muted-text">
 全局时间窗
 <select
 value={windowKey}
 onChange={(e) => setWindowKey(e.target.value as WindowKey)}
 className="mt-1 block rounded-lg border border-fin-border bg-white px-3 py-2 text-sm text-[var(--fin-text)]"
 >
 {WINDOW_OPTIONS.map((w) => (
 <option key={w.key} value={w.key}>
 {w.label}
 </option>
 ))}
 </select>
 </label>
 </div>
 {compareCodes.length < 2 && (
 <p className="mt-6 text-sm fin-muted-text">请在 ETF 标的池中勾选至少 2 个标的（最多 {MAX_COMPARE} 只）。</p>
 )}
 {compareCodes.length >= 2 && !compareResult && (
 <p className="mt-6 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
 无法生成概览（数据不足）。
 </p>
 )}
 {compareResult && (
 <div className="mt-8 space-y-8">
 <div>
 <h3 className="text-sm font-semibold text-[var(--fin-text)]">收益与波动</h3>
 <p className="mt-1 text-xs fin-muted-text">
 当前按<strong>{currentWindowLabel}</strong>口径计算；<strong>区间收益</strong>=窗口首尾收盘涨跌；<strong>年化收益</strong>按 252 交易日由区间复利折算；<strong>最大回撤</strong>为区间内峰值到谷底；<strong>年化波动</strong>为日收益样本标准差×√252；<strong>夏普(简)</strong>=年化÷年化波动；<strong>卡玛</strong>≈年化÷|最大回撤|。
 </p>
 <div className="mt-3 overflow-x-auto rounded-lg border border-fin-border">
 <table className="w-full table-fixed text-left text-[11px] leading-tight sm:text-xs">
 <colgroup>
 <col className="w-[3.75rem]" />
 <col className="w-[5.5rem]" />
 <col className="w-[3.25rem]" />
 <col className="w-[8.25rem] min-w-[7rem]" />
 <col className="w-[2.25rem]" />
 <col className="w-[3rem]" />
 <col className="w-[3rem]" />
 <col className="w-[3rem]" />
 <col className="w-[3rem]" />
 <col className="w-[2.75rem]" />
 <col className="w-[2.75rem]" />
 </colgroup>
 <thead className="bg-fin-panel-muted text-[10px] font-semibold fin-muted-text sm:text-[11px]">
 <tr>
 <th className="px-1 py-2 text-left">
 <button type="button" onClick={() => toggleSort("code")} className="inline-flex items-center gap-1 hover:text-[var(--fin-text)]">
 代码 {sortState.key === "code" ? (sortState.dir === "asc" ? "↑" : "↓") : ""}
 </button>
 </th>
 <th className="px-1 py-2 text-left">
 <button type="button" onClick={() => toggleSort("name")} className="inline-flex items-center gap-1 hover:text-[var(--fin-text)]">
 名称 {sortState.key === "name" ? (sortState.dir === "asc" ? "↑" : "↓") : ""}
 </button>
 </th>
 <th className="px-1 py-2">样本窗</th>
 <th className="px-1 py-2">起止</th>
 <th className="px-0.5 py-2 text-right">
 <button type="button" onClick={() => toggleSort("days")} className="inline-flex items-center gap-1 hover:text-[var(--fin-text)]">
 日 {sortState.key === "days" ? (sortState.dir === "asc" ? "↑" : "↓") : ""}
 </button>
 </th>
 <th className="px-0.5 py-2 text-right" title="区间首尾收盘累计涨跌">
 <button type="button" onClick={() => toggleSort("totalReturnPct")} className="inline-flex items-center gap-1 hover:text-[var(--fin-text)]">
 区间收益% {sortState.key === "totalReturnPct" ? (sortState.dir === "asc" ? "↑" : "↓") : ""}
 </button>
 </th>
 <th className="px-0.5 py-2 text-right" title="由区间复利按 252 交易日年化">
 <button type="button" onClick={() => toggleSort("annualReturnPct")} className="inline-flex items-center gap-1 hover:text-[var(--fin-text)]">
 年化% {sortState.key === "annualReturnPct" ? (sortState.dir === "asc" ? "↑" : "↓") : ""}
 </button>
 </th>
 <th className="px-0.5 py-2 text-right">
 <button type="button" onClick={() => toggleSort("maxDrawdownPct")} className="inline-flex items-center gap-1 hover:text-[var(--fin-text)]">
 回撤% {sortState.key === "maxDrawdownPct" ? (sortState.dir === "asc" ? "↑" : "↓") : ""}
 </button>
 </th>
 <th className="px-0.5 py-2 text-right">
 <button type="button" onClick={() => toggleSort("annualVolPct")} className="inline-flex items-center gap-1 hover:text-[var(--fin-text)]">
 波动% {sortState.key === "annualVolPct" ? (sortState.dir === "asc" ? "↑" : "↓") : ""}
 </button>
 </th>
 <th className="px-0.5 py-2 text-right">
 <button type="button" onClick={() => toggleSort("sharpeLike")} className="inline-flex items-center gap-1 hover:text-[var(--fin-text)]">
 夏普 {sortState.key === "sharpeLike" ? (sortState.dir === "asc" ? "↑" : "↓") : ""}
 </button>
 </th>
 <th className="px-0.5 py-2 text-right">
 <button type="button" onClick={() => toggleSort("calmarLike")} className="inline-flex items-center gap-1 hover:text-[var(--fin-text)]">
 卡玛 {sortState.key === "calmarLike" ? (sortState.dir === "asc" ? "↑" : "↓") : ""}
 </button>
 </th>
 </tr>
 </thead>
 <tbody className="divide-y divide-zinc-100">
 {overviewRowsSorted.map((r) => {
 const seg = r.seg;
 if (!seg) {
 return (
 <tr key={r.code} className="hover:bg-fin-panel-muted/80">
 <td className="px-1 py-1.5 font-mono fin-muted-text">{r.code}</td>
 <td className="px-1 py-1.5 text-[var(--fin-text)]">{r.name}</td>
 <td className="px-1 py-1.5 fin-muted-text">{currentWindowLabel}</td>
 <td colSpan={8} className="px-1 py-1.5 fin-muted-text">
 有效样本不足（需约 ≥20 个交易日）
 </td>
 </tr>
 );
 }
 return (
 <tr key={`${r.code}-${windowKey}`} className="hover:bg-fin-panel-muted/80">
 <td className="px-1 py-1.5 font-mono fin-muted-text">{r.code}</td>
 <td className="max-w-[5.5rem] truncate px-1 py-1.5 text-[var(--fin-text)]" title={r.name}>
 {r.name}
 </td>
 <td className="px-1 py-1.5 fin-muted-text">{currentWindowLabel}</td>
 <td
 className="px-0.5 py-1 align-top font-mono text-[9px] leading-snug fin-muted-text sm:px-1 sm:text-[10px]"
 title={`${seg.from} 至 ${seg.to}`}
 >
 <span className="block whitespace-nowrap">{seg.from}</span>
 <span className="block py-0.5 text-center text-[8px] text-[var(--fin-dim)]">↓</span>
 <span className="block whitespace-nowrap">{seg.to}</span>
 </td>
 <td className="px-0.5 py-1.5 text-right font-mono">{seg.days}</td>
 <td className="px-0.5 py-1.5 text-right font-mono">{seg.totalReturnPct}</td>
 <td className="px-0.5 py-1.5 text-right font-mono">{seg.annualReturnPct}</td>
 <td className="px-0.5 py-1.5 text-right font-mono">{seg.maxDrawdownPct}</td>
 <td className="px-0.5 py-1.5 text-right font-mono">{seg.annualVolPct}</td>
 <td className="px-0.5 py-1.5 text-right font-mono fin-muted-text">
 {seg.sharpeLike != null ? seg.sharpeLike : "—"}
 </td>
 <td className="px-0.5 py-1.5 text-right font-mono fin-muted-text">
 {seg.calmarLike != null ? seg.calmarLike : "—"}
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 {overviewDualData.length > 0 && (
 <div className="mt-6 rounded-lg border border-fin-border bg-fin-panel-muted/50 p-4">
 <h4 className="text-xs font-semibold text-[var(--fin-text)]">{currentWindowLabel} · 年化收益与最大回撤（%）</h4>
 <p className="mt-0.5 text-[10px] fin-muted-text">
 与上表同窗口；紫柱=年化收益（越高越好），粉柱=最大回撤（越低越好）。
 </p>
 <div className="mt-3 h-56 w-full min-w-[300px]">
 <ResponsiveContainer width="100%" height="100%">
 <BarChart data={overviewDualData} margin={{ top: 8, right: 8, left: 4, bottom: 36 }}>
 <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
 <XAxis dataKey="code" tick={{ fontSize: 10 }} />
 <YAxis
 width={40}
 tick={{ fontSize: 10 }}
 tickFormatter={(v) => `${v}`}
 domain={["auto", "auto"]}
 />
 <Tooltip
 formatter={(v, name) => {
 const n = typeof v === "number" ? v : Number(v);
 const lab = String(name);
 return Number.isFinite(n) ? [`${n}%`, lab] : ["—", lab];
 }}
 labelFormatter={(label) => {
 const row = overviewDualData.find((x) => x.code === label);
 return row ? `${row.code}` : String(label);
 }}
 contentStyle={{ borderRadius: 10, fontSize: 12 }}
 />
 <Legend wrapperStyle={{ fontSize: 11 }} />
 <Bar
 dataKey="annualReturn"
 fill="#4f46e5"
 name="年化收益 %"
 radius={[3, 3, 0, 0]}
 isAnimationActive={false}
 />
 <Bar
 dataKey="maxDrawdown"
 fill="#fb7185"
 name="最大回撤 %"
 radius={[3, 3, 0, 0]}
 isAnimationActive={false}
 />
 </BarChart>
 </ResponsiveContainer>
 </div>
 </div>
 )}
 </div>
 <div id="overview-correlation">
 <div className="flex flex-wrap items-end justify-between gap-3">
 <h3 className="text-sm font-semibold text-[var(--fin-text)]">日收益相关性（Pearson）</h3>
 <label className="text-xs fin-muted-text">
 排序
 <select
 value={corrOrderMode}
 onChange={(e) => setCorrOrderMode(e.target.value as CorrOrderMode)}
 className="ml-2 rounded-md border border-fin-border bg-white px-2 py-1 text-xs text-[var(--fin-text)]"
 >
 <option value="cluster">聚类序（高相关相邻）</option>
 <option value="code">代码序</option>
 </select>
 </label>
 </div>
 <p className="mt-1 text-xs fin-muted-text">当前按<strong>{currentWindowLabel}</strong>取样；仅使用各标的<strong>日期交集</strong>上的日收益序列，重合不足 30 个交易日时不展示矩阵。</p>
 <p className="mt-1 text-[11px] fin-muted-text">热力底色：红色=正相关更强，蓝色=负相关更强；悬浮可看精确值。</p>
 {!compareResult.overlapOk || !compareResult.correlation ? (
 <p className="mt-3 text-sm fin-muted-text">
 {compareResult.overlapDates.length > 0
 ? `当前重合 ${compareResult.overlapDates.length} 日，需 ≥30 日。`
 : "所选标的无重合交易日。"}
 </p>
 ) : (
 <p className="mt-2 text-xs font-mono fin-muted-text">
 重合区间 {compareResult.overlapDates[0]} ~{" "}
 {compareResult.overlapDates[compareResult.overlapDates.length - 1]} ·{" "}
 {compareResult.overlapDates.length} 日
 </p>
 )}
 {compareResult.correlation && (
 <div className="mt-3 overflow-x-auto rounded-lg border border-fin-border">
 <table className="w-full min-w-[240px] table-fixed text-center text-[11px] sm:text-xs">
 <colgroup>
 <col className="w-[3.5rem]" />
 {corrOrderedLabels.map((lb) => (
 <col key={lb} className="w-[3.25rem]" />
 ))}
 </colgroup>
 <thead>
 <tr className="border-b border-fin-border bg-fin-panel-muted">
 <th className="px-1 py-2" />
 {corrOrderedLabels.map((lb) => (
 <th key={lb} className="px-1 py-2 font-mono font-semibold fin-muted-text">
 {lb}
 </th>
 ))}
 </tr>
 </thead>
 <tbody>
 {corrOrderedIndices.map((rowIdx) => (
 <tr key={compareResult.corrLabels[rowIdx]} className="border-b border-zinc-50">
 <td className="bg-fin-panel-muted px-1 py-2 font-mono font-semibold fin-muted-text">{compareResult.corrLabels[rowIdx]}</td>
 {corrOrderedIndices.map((colIdx) => {
 const v = compareResult.correlation![rowIdx][colIdx];
 const cellStyle = rowIdx === colIdx
 ? { backgroundColor: "rgba(22, 163, 74, 0.14)", color: "#14532d" }
 : corrCellStyle(v);
 return (
 <td
 key={`${rowIdx}-${colIdx}`}
 className="px-1 py-2 font-mono"
 style={cellStyle}
 title={`${compareResult.corrLabels[rowIdx]} vs ${compareResult.corrLabels[colIdx]}: ${v.toFixed(4)}`}
 >
 {v.toFixed(2)}
 </td>
 );
 })}
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 </div>
 )}
 </section>
 </div>
 );
}
