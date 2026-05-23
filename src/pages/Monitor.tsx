import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { useDataSource } from "../context/DataSourceContext";
import { useStrategyRegistry } from "../context/StrategyRegistryContext";
import { fetchLiveQuote, formatQuoteFetchedAt, formatQuoteSourceLabel, type LiveQuote } from "../lib/liveQuote";
import { getParamVariants } from "../lib/paramVariants";
import { variantMonitorCompact } from "../lib/strategyLabels";
import { tryWebThenApiBars } from "../lib/marketDataSync";
import { formatPct } from "../lib/formatDisplay";
import { strategyPercentileContext } from "../lib/indicatorPercentile";
import { mergeIntraday1345 } from "../lib/strategy";
import type { EtfDefinition } from "../types";

const LS_PREF = "desk.monitorPref.v2";

type MonitorPref = {
 updateHm: string;
 codes: string[];
 snapByCode: Record<string, number>;
};

function loadPref(defCodes: string[], primaryCodes: string[]): MonitorPref {
 try {
 const raw = localStorage.getItem(LS_PREF);
 if (raw) {
 const j = JSON.parse(raw) as MonitorPref;
 if (j && typeof j === "object") {
 return {
 updateHm: typeof j.updateHm === "string" ? j.updateHm : "13:45",
 codes: Array.isArray(j.codes) && j.codes.length ? j.codes : primaryCodes.slice(0, 6).length ? primaryCodes.slice(0, 6) : defCodes.slice(0, 4),
 snapByCode: typeof j.snapByCode === "object" && j.snapByCode ? j.snapByCode : {},
 };
 }
 }
 const legacy = localStorage.getItem("desk.monitorPref.v1");
 if (legacy) {
 const j = JSON.parse(legacy) as { codes?: string[]; updateHm?: string; snapByCode?: Record<string, number> };
 if (j && typeof j === "object") {
 return {
 updateHm: typeof j.updateHm === "string" ? j.updateHm : "13:45",
 codes: Array.isArray(j.codes) && j.codes.length ? j.codes : primaryCodes.slice(0, 6).length ? primaryCodes.slice(0, 6) : defCodes.slice(0, 4),
 snapByCode: typeof j.snapByCode === "object" && j.snapByCode ? j.snapByCode : {},
 };
 }
 }
 } catch {
 /* ignore */
 }
 return {
 updateHm: "13:45",
 codes: primaryCodes.slice(0, 6).length ? primaryCodes.slice(0, 6) : defCodes.slice(0, Math.min(4, defCodes.length)),
 snapByCode: {},
 };
}

function savePref(p: MonitorPref) {
 try {
 localStorage.setItem(LS_PREF, JSON.stringify(p));
 } catch {
 /* ignore */
 }
}

function alertFromPercentile(p: number | null | undefined): string | null {
 if (p == null || Number.isNaN(p)) return null;
 if (p <= 18) return "临近买";
 if (p <= 32) return "靠近买区";
 if (p >= 82) return "临近卖";
 if (p >= 68) return "靠近卖区";
 return null;
}

function groupDefinitions(defs: EtfDefinition[]) {
 const cn: EtfDefinition[] = [];
 const hk: EtfDefinition[] = [];
 const cf: EtfDefinition[] = [];
 for (const d of defs) {
 if (d.meta.product_kind === "现金流类") cf.push(d);
 else if (d.meta.dividend_market_scope === "港股红利") hk.push(d);
 else cn.push(d);
 }
 return { cn, hk, cf };
}

function MonitorPoolSection({
 title,
 items,
 selectedCodes,
 onToggle,
 onSelectAll,
}: {
 title: string;
 items: EtfDefinition[];
 selectedCodes: string[];
 onToggle: (code: string) => void;
 onSelectAll: (codes: string[]) => void;
}) {
 const codes = items.map((e) => e.meta.code);
 const selectedInSection = codes.filter((c) => selectedCodes.includes(c)).length;
 const allSelected = codes.length > 0 && codes.every((c) => selectedCodes.includes(c));

 return (
 <div className="border-b border-fin-border pb-2 last:border-0 last:pb-0">
 <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
 <span className="text-[10px] font-semibold uppercase tracking-wide fin-muted-text">
 {title}
 <span className="ml-1.5 font-normal normal-case text-[var(--fin-dim)]">
 {selectedInSection}/{items.length}
 </span>
 </span>
 {items.length > 0 ? (
 <button
 type="button"
 onClick={() => onSelectAll(codes)}
 className="text-[10px] fin-link"
 >
 {allSelected ? "取消" : "全选"}
 </button>
 ) : null}
 </div>
 {items.length === 0 ? (
 <p className="mt-1 text-[10px] text-[var(--fin-dim)]">暂无</p>
 ) : (
 <ul className="mt-1 flex flex-wrap gap-1">
 {items.map((e) => {
 const checked = selectedCodes.includes(e.meta.code);
 return (
 <li key={e.meta.code}>
 <label
 title={e.meta.name}
 className={`inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition ${
 checked ? "border-[var(--fin-blue)] bg-[var(--fin-blue-soft)] text-[var(--fin-text)]" : "border-fin-border bg-white fin-muted-text"
 }`}
 >
 <input
 type="checkbox"
 checked={checked}
 onChange={() => onToggle(e.meta.code)}
 className="h-3 w-3 shrink-0 rounded border-zinc-300 text-[var(--fin-blue)] accent-[var(--fin-blue)]"
 />
 <span className="font-mono font-semibold">{e.meta.code}</span>
 </label>
 </li>
 );
 })}
 </ul>
 )}
 </div>
 );
}

export function MonitorPage() {
 const { definitions, getEtf, etfProducts } = useDataSource();
 const { entries } = useStrategyRegistry();

 const defCodes = useMemo(() => definitions.map((d) => d.meta.code), [definitions]);
 const primaryCodes = useMemo(
 () =>
 etfProducts
 .filter((p) => p.isPrimary)
 .map((p) => p.code)
 .filter((c) => defCodes.includes(c)),
 [etfProducts, defCodes]
 );
 const groups = useMemo(() => groupDefinitions(definitions), [definitions]);

 const [pref, setPref] = useState<MonitorPref>(() => loadPref([], []));
 useEffect(() => {
 if (defCodes.length) setPref((p) => (p.codes.length ? p : loadPref(defCodes, primaryCodes)));
 }, [defCodes.join("|"), primaryCodes.join("|")]);

 const setPrefPatch = useCallback((patch: Partial<MonitorPref>) => {
 setPref((prev) => {
 const next = { ...prev, ...patch };
 savePref(next);
 return next;
 });
 }, []);

 const [lastRun, setLastRun] = useState<string | null>(null);
 const [remoteSyncMsg, setRemoteSyncMsg] = useState<Record<string, string>>({});
 const [syncBusy, setSyncBusy] = useState(false);
 const [quotesByCode, setQuotesByCode] = useState<Record<string, LiveQuote>>({});
 const [quotesLoading, setQuotesLoading] = useState(false);
 const [quotesFetchedAt, setQuotesFetchedAt] = useState<string | null>(null);

 const refreshLiveQuotes = useCallback(async () => {
 if (pref.codes.length === 0) {
 setQuotesByCode({});
 setQuotesFetchedAt(null);
 return;
 }
 setQuotesLoading(true);
 try {
 const entries = await Promise.all(
 pref.codes.map(async (code) => {
 const etf = getEtf(code);
 if (!etf?.bars.length) return [code, null] as const;
 const q = await fetchLiveQuote(code, etf.bars);
 return [code, q] as const;
 })
 );
 const next: Record<string, LiveQuote> = {};
 for (const [code, q] of entries) {
 if (q) next[code] = q;
 }
 setQuotesByCode(next);
 setQuotesFetchedAt(new Date().toISOString());
 setPref((prev) => {
 const snapByCode = {
 ...prev.snapByCode,
 ...Object.fromEntries(Object.entries(next).map(([code, q]) => [code, q.price])),
 };
 const updated = { ...prev, snapByCode };
 savePref(updated);
 return updated;
 });
 } finally {
 setQuotesLoading(false);
 }
 }, [pref.codes, getEtf]);

 useEffect(() => {
 void refreshLiveQuotes();
 const timer = window.setInterval(() => void refreshLiveQuotes(), 60_000);
 return () => window.clearInterval(timer);
 }, [refreshLiveQuotes]);

 const toggleCode = (code: string) => {
 const has = pref.codes.includes(code);
 const next = has ? pref.codes.filter((c) => c !== code) : [...pref.codes, code];
 setPrefPatch({ codes: next });
 };

 const selectAllInSection = (codes: string[]) => {
 setPref((prev) => {
 const allIn = codes.length > 0 && codes.every((c) => prev.codes.includes(c));
 const nextCodes = allIn
 ? prev.codes.filter((c) => !codes.includes(c))
 : [...new Set([...prev.codes, ...codes])];
 const next = { ...prev, codes: nextCodes };
 savePref(next);
 return next;
 });
 };

 type Row = {
 variantKey: string;
 code: string;
 etfName: string;
 strategyLabel: string;
 snap: number;
 lastClose: number;
 pct: number | null;
 metricLine: string;
 hint: string;
 alert: string | null;
 };

 const rowGroups = useMemo((): { code: string; rows: Row[] }[] => {
 const groups: { code: string; rows: Row[] }[] = [];
 for (const code of pref.codes) {
 const etf = getEtf(code);
 if (!etf) continue;
 const vars = getParamVariants(etf, entries);
 const lastClose = etf.bars[etf.bars.length - 1]?.close ?? 1;
 const snap = quotesByCode[code]?.price ?? pref.snapByCode[code] ?? lastClose;
 const merged = mergeIntraday1345(etf.bars, snap);
 const block: Row[] = vars.map((v) => {
 const ctx = strategyPercentileContext(etf.bars, v.params, v.strategyId, merged);
 const pct = ctx?.percentile ?? null;
 const metricLine = ctx != null ? `${ctx.metricName}=${ctx.metricValue}` : "—";
 return {
 variantKey: v.key,
 code,
 etfName: etf.meta.name,
 strategyLabel: variantMonitorCompact(v),
 snap,
 lastClose,
 pct,
 metricLine,
 hint: ctx?.hint ?? "—",
 alert: alertFromPercentile(pct),
 };
 });
 if (block.length) groups.push({ code, rows: block });
 }
 return groups;
 }, [pref, getEtf, entries, quotesByCode]);

 const runRefresh = () => {
 setLastRun(new Date().toLocaleString("zh-CN", { hour12: false }));
 };

 const runRemoteSyncAll = async () => {
 setSyncBusy(true);
 const next: Record<string, string> = { ...remoteSyncMsg };
 try {
 for (const code of pref.codes) {
 const etf = getEtf(code);
 if (!etf?.bars.length) {
 next[code] = "无本地 K 线";
 continue;
 }
 const r = await tryWebThenApiBars(code, etf.bars);
 if (!r.ok) {
 next[code] = r.detail ?? "拉取失败";
 continue;
 }
 const bits = [`${r.source === "web" ? "Web" : "API"} 拉取 OK`];
 if (r.consistency) {
 bits.push(...r.consistency.messages);
 if (r.consistency.mismatchSamples.length) bits.push(...r.consistency.mismatchSamples.slice(0, 4));
 }
 next[code] = bits.join(" · ");
 }
 setRemoteSyncMsg(next);
 } finally {
 setSyncBusy(false);
 }
 };

 const poolSummary =
 pref.codes.length > 0
 ? pref.codes.slice(0, 6).join("、") + (pref.codes.length > 6 ? ` 等 ${pref.codes.length} 只` : "")
 : "未选择";

 return (
 <div className="space-y-4">
 <PageHeader
 kicker="策略层"
 title="盘中监控"
 breadcrumbs={[
 { label: "配置总览", to: "/" },
 { label: "盘中监控" },
 ]}
 description={
 <>
 盘中信号使用 <strong>ETF 实时价格</strong>，用于观察指数策略参数映射到可交易产品后的执行状态；不是指数实时行情。默认展示主跟踪产品，参考产品需手动加入监控池。
 </>
 }
 />

 <details className="fin-panel group/pool overflow-hidden" open={pref.codes.length === 0}>
 <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
 <span className="font-medium text-[var(--fin-text)]">
 <span className="mr-1.5 text-[var(--fin-dim)] group-open/pool:rotate-90 inline-block transition">▸</span>
 监控标的
 <span className="ml-2 font-mono text-xs font-normal fin-muted-text">
 {pref.codes.length}/{definitions.length}
 </span>
 </span>
 <span className="truncate font-mono text-[10px] fin-muted-text max-w-[min(100%,28rem)]">{poolSummary}</span>
 </summary>
 <div className="max-h-36 overflow-y-auto border-t border-fin-border px-3 py-2 space-y-2">
 <MonitorPoolSection
 title="A股红利"
 items={groups.cn}
 selectedCodes={pref.codes}
 onToggle={toggleCode}
 onSelectAll={selectAllInSection}
 />
 <MonitorPoolSection
 title="港股红利"
 items={groups.hk}
 selectedCodes={pref.codes}
 onToggle={toggleCode}
 onSelectAll={selectAllInSection}
 />
 <MonitorPoolSection
 title="现金流类"
 items={groups.cf}
 selectedCodes={pref.codes}
 onToggle={toggleCode}
 onSelectAll={selectAllInSection}
 />
 </div>
 </details>

 <section className="fin-panel p-4">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <h3 className="text-sm font-semibold text-[var(--fin-text)]">全策略信号与标尺</h3>
 <button
 type="button"
 onClick={() => void refreshLiveQuotes()}
 disabled={quotesLoading || pref.codes.length === 0}
 className="rounded-full border border-fin-border bg-white px-3 py-1 text-xs font-medium fin-muted-text hover:bg-fin-panel-muted disabled:opacity-50"
 >
 {quotesLoading ? "刷新行情中…" : "刷新行情"}
 </button>
 </div>
 {rowGroups.length === 0 ? (
 <p className="mt-4 text-sm fin-muted-text">请至少勾选一只标的。</p>
 ) : (
 <div className="mt-3 overflow-x-auto rounded-lg border border-fin-border">
 <table className="min-w-full text-left text-xs">
 <thead className="fin-table-head">
 <tr>
 <th className="px-2 py-1.5 font-normal">标的</th>
 <th className="px-2 py-1.5 font-normal">最新价</th>
 <th className="px-2 py-1.5 font-normal">策略</th>
 <th className="px-2 py-1.5 font-normal">标尺%</th>
 <th className="px-2 py-1.5 font-normal">指标</th>
 <th className="px-2 py-1.5 font-normal">区间</th>
 <th className="px-2 py-1.5 font-normal">提醒</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-fin-border">
 {rowGroups.flatMap((g) =>
 g.rows.map((r, i) => (
 <tr key={`${r.code}-${r.variantKey}`} className="hover:bg-fin-panel-muted/80">
 {i === 0 ? (
 <td rowSpan={g.rows.length} className="px-2 py-1.5 align-top border-r border-fin-border whitespace-nowrap">
 <p className="font-mono font-semibold text-[var(--fin-text)]">{r.code}</p>
 <p className="max-w-[7rem] truncate text-[10px] fin-muted-text" title={r.etfName}>
 {r.etfName}
 </p>
 <Link
 to={`/etf/${r.code}?tab=intraday`}
 className="mt-0.5 inline-block text-[10px] fin-link"
 >
 盘中监控
 </Link>
 </td>
 ) : null}
 {i === 0 ? (
 <td rowSpan={g.rows.length} className="px-2 py-1.5 align-top border-r border-fin-border">
 <p className="font-mono text-xs font-semibold text-[var(--fin-blue)]">{r.snap.toFixed(4)}</p>
 <p className="text-[9px] text-[var(--fin-dim)]">
 昨收 {r.lastClose.toFixed(4)}
 {quotesByCode[r.code] ?
 ` · ${formatQuoteSourceLabel(quotesByCode[r.code]!.source)}`
 : null}
 </p>
 </td>
 ) : null}
 <td className="px-2 py-1.5 text-[10px] text-[var(--fin-text)] max-w-[12rem] truncate" title={r.strategyLabel}>
 {r.strategyLabel}
 </td>
 <td className="px-2 py-1.5 font-mono text-[10px]">{formatPct(r.pct)}</td>
 <td className="px-2 py-1.5 font-mono text-[10px] fin-muted-text max-w-[8rem] truncate" title={r.metricLine}>
 {r.metricLine}
 </td>
 <td className="px-2 py-1.5 text-[10px] fin-muted-text max-w-[7rem] truncate" title={r.hint}>
 {r.hint}
 </td>
 <td className="px-2 py-1.5 text-[10px]">
 {r.alert ? (
 <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900">
 {r.alert}
 </span>
 ) : (
 <span className="text-zinc-300">—</span>
 )}
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 )}
 {quotesFetchedAt && pref.codes.length > 0 ?
 <p className="mt-3 border-t border-fin-border pt-3 text-center text-[10px] text-fin-muted">
 行情数据更新：{formatQuoteFetchedAt(quotesFetchedAt)} · 每 60 秒自动刷新 · 东财实时不可用时回退本地/网关收盘
 </p>
 : null}
 </section>

 <details className="rounded-lg border border-fin-border bg-fin-panel-muted/50 p-4 text-sm fin-muted-text">
 <summary className="cursor-pointer list-none font-medium text-[var(--fin-text)] [&::-webkit-details-marker]:hidden">
 <span className="mr-2 text-[var(--fin-dim)]">▸</span>
 标尺说明（默认折叠）
 </summary>
 <p className="mt-3 leading-relaxed">
 对纳入监控的 ETF，列出全部可切换策略在「昨收全日 K + ETF 实时最新价」合成下的标尺与提醒。标尺 % 表示当前指标值在策略买、卖阈值之间的线性位置（0 贴近买侧，100
 贴近卖侧），不是历史经验分位，也<strong>不是</strong>指数实时点位。标尺 ≤20% / ≥80% 为贴近买、卖侧。
 </p>
 <div className="mt-4 flex flex-wrap items-end gap-4">
 <label className="text-sm fin-muted-text">
 参考更新时点
 <input
 type="time"
 value={pref.updateHm}
 onChange={(e) => setPrefPatch({ updateHm: e.target.value })}
 className="mt-1 block rounded-xl border border-fin-border px-3 py-2 font-mono text-sm"
 />
 </label>
 <button
 type="button"
 onClick={runRefresh}
 className="fin-btn-primary rounded-full px-5 py-2.5 shadow-sm"
 >
 刷新汇总时刻
 </button>
 {lastRun && <p className="text-xs text-[var(--fin-dim)]">上次点击：{lastRun}</p>}
 </div>
 </details>

 <details className="rounded-lg border border-fin-border bg-white p-4 text-sm">
 <summary className="cursor-pointer list-none font-medium text-[var(--fin-text)] [&::-webkit-details-marker]:hidden">
 <span className="mr-2 text-[var(--fin-dim)]">▸</span>
 高级：外部行情校验（可选）
 </summary>
 <p className="mt-3 text-xs leading-relaxed fin-muted-text">
 默认使用站点已发布的日 K 与盘中快照重算标尺。若已接入自有行情网关，可对已选标的拉取并比对重叠日期一致性。
 </p>
 <button
 type="button"
 disabled={syncBusy || pref.codes.length === 0}
 onClick={() => void runRemoteSyncAll()}
 className="mt-3 rounded-full bg-zinc-800 px-4 py-1.5 text-xs font-medium text-white hover:bg-zinc-900 disabled:opacity-50"
 >
 {syncBusy ? "校验中…" : "对已选标的拉取并比对"}
 </button>
 {Object.keys(remoteSyncMsg).length > 0 && (
 <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto font-mono text-[10px] fin-muted-text">
 {pref.codes.map((c) =>
 remoteSyncMsg[c] ? (
 <li key={c}>
 <span className="text-[var(--fin-blue)]">{c}</span> {remoteSyncMsg[c]}
 </li>
 ) : null
 )}
 </ul>
 )}
 </details>
 </div>
 );
}
