import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useDataSource } from "../context/DataSourceContext";
import type { EtfDefinition } from "../types";
import { groupEtfProductsByIndex, type EtfProductRecord } from "../lib/etfProducts";
import { compareDefinitions, type SeriesMetricBlock } from "../lib/compareEtfs";
import { formatPct, formatPctValue } from "../lib/formatDisplay";
import { sliceBarsForWindow, type MetricWindowId } from "../lib/indexPanelMetrics";

function fmtPctCell(v: number | null | undefined): string {
  return formatPct(v);
}

function fmtRatioCell(v: number | null | undefined): string {
  return formatPctValue(v);
}

const MIN_BARS_FOR_COMPARE = 2;

type ComparePoolItem = {
  product: EtfProductRecord;
  def: EtfDefinition | undefined;
  comparable: boolean;
};

function buildComparePool(
  products: EtfProductRecord[],
  getEtf: (code: string) => EtfDefinition | undefined,
): {
  cn: ComparePoolItem[];
  hk: ComparePoolItem[];
  cf: ComparePoolItem[];
  all: ComparePoolItem[];
} {
  const byCode = new Map<string, ComparePoolItem>();
  for (const group of groupEtfProductsByIndex(products)) {
    const product = group.products.find((p) => p.isPrimary);
    if (!product || byCode.has(product.code)) continue;
    const def = getEtf(product.code);
    const comparable = Boolean(def && def.bars.length >= MIN_BARS_FOR_COMPARE);
    byCode.set(product.code, {
      product,
      def: def
        ? { ...def, meta: { ...def.meta, name: product.name } }
        : undefined,
      comparable,
    });
  }
  const all = [...byCode.values()];
  return {
    cn: all.filter(
      (i) =>
        i.product.productGroup === "shareholder_return_cn" ||
        i.product.productGroup === "otc_fund",
    ),
    hk: all.filter((i) => i.product.productGroup === "shareholder_return_hk"),
    cf: all.filter((i) => i.product.productGroup === "cash_creation"),
    all,
  };
}

type WindowKey = MetricWindowId & ("all" | "y1" | "y3" | "y5");

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
  return sliceBarsForWindow(bars, win);
}

/** 暗色仪表盘：正相关偏暖（分散度风险）、负相关偏蓝，与 --fin-* token 一致 */
function corrCellStyle(v: number): CSSProperties {
  if (!Number.isFinite(v))
    return { backgroundColor: "transparent", color: "var(--fin-dim)" };
  const t = Math.min(1, Math.abs(v));
  const alpha = 0.14 + t * 0.38;
  if (v >= 0)
    return {
      backgroundColor: `rgba(248, 113, 113, ${alpha})`,
      color: t > 0.65 ? "#fecaca" : "var(--fin-muted)",
    };
  return {
    backgroundColor: `rgba(79, 125, 243, ${alpha})`,
    color: t > 0.65 ? "#bfdbfe" : "var(--fin-muted)",
  };
}

function corrDiagonalCellStyle(): CSSProperties {
  return {
    backgroundColor: "rgba(79, 125, 243, 0.14)",
    color: "var(--fin-text)",
    boxShadow: "inset 0 0 0 1px var(--fin-border)",
  };
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

function shortEtfLabel(name: string, code: string): string {
  const n = name.trim();
  if (!n || n === code) return code;
  return n.length > 14 ? `${n.slice(0, 14)}…` : n;
}

/** 紧凑一行：维度标签 + chip 多选 */
function CompactPoolRow({
  label,
  items,
  compareCodes,
  toggleCompare,
  selectAllInSection,
}: {
  label: string;
  items: ComparePoolItem[];
  compareCodes: string[];
  toggleCompare: (code: string) => void;
  selectAllInSection: (codes: string[]) => void;
}) {
  if (items.length === 0) return null;
  const comparableCodes = items
    .filter((i) => i.comparable)
    .map((i) => i.product.code);
  const allSelected =
    comparableCodes.length > 0 &&
    comparableCodes.every((c) => compareCodes.includes(c));

  return (
    <div className="compare-pool-row flex flex-wrap items-start gap-x-2 gap-y-1.5 py-2 last:border-b-0">
      <div className="flex w-full min-w-[4.5rem] shrink-0 items-center justify-between gap-2 sm:w-auto sm:flex-col sm:items-start sm:justify-start">
        <span className="fin-label text-[11px]">{label}</span>
        {comparableCodes.length > 0 ? (
          <button
            type="button"
            onClick={() => selectAllInSection(comparableCodes)}
            className="text-[10px] fin-link whitespace-nowrap"
          >
            {allSelected ? "取消" : "全选"}
          </button>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {items.map((item) => {
          const code = item.product.code;
          const checked = compareCodes.includes(code);
          const disabled = !item.comparable;
          return (
            <label
              key={code}
              title={item.product.name}
              className={`inline-flex max-w-full cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] transition ${
                checked
                  ? "border-[rgba(79,125,243,0.35)] bg-[color-mix(in_srgb,var(--fin-blue-soft)_70%,transparent)] text-[var(--fin-text)]"
                  : "border-[rgba(148,163,184,0.14)] bg-[var(--fin-panel)] fin-muted-text"
              } ${disabled ? "cursor-not-allowed opacity-45" : "hover:border-[rgba(79,125,243,0.35)]"}`}
            >
              <input
                type="checkbox"
                disabled={disabled}
                checked={checked}
                onChange={() => toggleCompare(code)}
                className="h-3 w-3 shrink-0 rounded border-fin-border accent-[var(--fin-blue)]"
              />
              <span className="font-mono font-medium text-[var(--fin-text)]">
                {code}
              </span>
              <span className="truncate">{shortEtfLabel(item.product.name, code)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function EtfCompareWorkbench() {
  const { etfProducts, getEtf } = useDataSource();
  const [compareCodes, setCompareCodes] = useState<string[]>([]);
  const compareInitRef = useRef(false);

  const pool = useMemo(
    () => buildComparePool(etfProducts, getEtf),
    [etfProducts, getEtf],
  );

  useEffect(() => {
    if (compareInitRef.current || pool.all.length < 2) return;
    compareInitRef.current = true;
    const pick: string[] = [];
    for (const section of [pool.cn, pool.hk, pool.cf]) {
      for (const item of section) {
        if (!item.comparable) continue;
        if (!pick.includes(item.product.code)) pick.push(item.product.code);
        if (pick.length >= 4) break;
      }
      if (pick.length >= 4) break;
    }
    if (pick.length < 2) {
      for (const item of pool.all) {
        if (!item.comparable) continue;
        if (!pick.includes(item.product.code)) pick.push(item.product.code);
        if (pick.length >= 4) break;
      }
    }
    if (pick.length >= 2) setCompareCodes(pick);
  }, [pool]);

  function toggleCompare(code: string) {
    const item = pool.all.find((i) => i.product.code === code);
    if (!item?.comparable) return;
    setCompareCodes((prev) => {
      if (prev.includes(code)) return prev.filter((c) => c !== code);
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
        next.push(c);
      }
      return next;
    });
  }

  const compareDefsOrdered = useMemo((): EtfDefinition[] => {
    return compareCodes
      .map((c) => pool.all.find((i) => i.product.code === c)?.def)
      .filter((x): x is EtfDefinition => Boolean(x));
  }, [pool, compareCodes]);

  const [windowKey, setWindowKey] = useState<WindowKey>("y5");

  const compareDefsInWindow = useMemo((): EtfDefinition[] => {
    return compareDefsOrdered.map((d) => ({
      ...d,
      bars: barsTailByWindow(d.bars, windowKey),
    }));
  }, [compareDefsOrdered, windowKey]);

  const compareResult = useMemo(() => {
    if (compareDefsInWindow.length < 2) return null;
    return compareDefinitions(compareDefsInWindow);
  }, [compareDefsInWindow]);

  const fullCompareResult = useMemo(() => {
    if (compareDefsOrdered.length < 2) return null;
    return compareDefinitions(compareDefsOrdered);
  }, [compareDefsOrdered]);

  const currentWindowLabel =
    WINDOW_OPTIONS.find((w) => w.key === windowKey)?.label ?? "全样本";
  const [sortState, setSortState] = useState<SortState>({
    key: "annualReturnPct",
    dir: "desc",
  });
  const [corrOrderMode, setCorrOrderMode] = useState<CorrOrderMode>("cluster");

  const overviewRowsSorted = useMemo(() => {
    if (!compareResult)
      return [] as { code: string; name: string; seg: SeriesMetricBlock }[];
    const rows = compareResult.overview.map((r) => ({
      code: r.code,
      name: r.name,
      seg: r.all,
    }));
    const valueOf = (row: (typeof rows)[number]): number | string => {
      if (sortState.key === "code") return row.code;
      if (sortState.key === "name") return row.name;
      if (!row.seg) return Number.NEGATIVE_INFINITY;
      if (sortState.key === "days") return row.seg.days;
      if (sortState.key === "totalReturnPct") return row.seg.totalReturnPct;
      if (sortState.key === "annualReturnPct") return row.seg.annualReturnPct;
      if (sortState.key === "maxDrawdownPct") return row.seg.maxDrawdownPct;
      if (sortState.key === "annualVolPct") return row.seg.annualVolPct;
      if (sortState.key === "sharpeLike")
        return row.seg.sharpeLike ?? Number.NEGATIVE_INFINITY;
      return row.seg.calmarLike ?? Number.NEGATIVE_INFINITY;
    };
    rows.sort((a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      const mul = sortState.dir === "asc" ? 1 : -1;
      if (typeof va === "string" && typeof vb === "string")
        return va.localeCompare(vb) * mul;
      return ((Number(va) || 0) - (Number(vb) || 0)) * mul;
    });
    return rows;
  }, [compareResult, sortState]);

  const toggleSort = (key: SortKey) => {
    setSortState((prev) => {
      if (prev.key === key)
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      const defaultDir =
        key === "maxDrawdownPct" || key === "annualVolPct" ? "asc" : "desc";
      return { key, dir: defaultDir };
    });
  };

  function sortMark(key: SortKey) {
    if (sortState.key !== key) return "";
    return sortState.dir === "asc" ? " ↑" : " ↓";
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
          onClick={() => toggleSort(key)}
        >
          {label}
          {sortMark(key)}
        </button>
      </th>
    );
  }

  const corrOrderedIndices = useMemo(() => {
    if (!compareResult?.correlation) return [] as number[];
    if (corrOrderMode === "code")
      return compareResult.corrLabels.map((_, i) => i);
    return buildCorrelationClusterOrder(compareResult.correlation);
  }, [compareResult, corrOrderMode]);

  const corrOrderedLabels = useMemo(() => {
    if (!compareResult?.correlation) return [] as string[];
    return corrOrderedIndices.map((i) => compareResult.corrLabels[i]);
  }, [compareResult, corrOrderedIndices]);

  const poolComparableCount = pool.all.filter((i) => i.comparable).length;
  const summaryCards = useMemo<SummaryCard[]>(() => {
    const cards: SummaryCard[] = [
      {
        title: "选池进度",
        value: `${compareCodes.length} 只`,
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
        },
      );
      return cards;
    }
    const y5Rows = fullCompareResult.overview
      .filter((r) => r.y5)
      .map((r) => ({ code: r.code, name: r.name, block: r.y5! }));
    if (y5Rows.length > 0) {
      const best = [...y5Rows].sort((a, b) => {
        const ac =
          a.block.calmarLike ??
          a.block.annualReturnPct / Math.max(a.block.maxDrawdownPct, 0.01);
        const bc =
          b.block.calmarLike ??
          b.block.annualReturnPct / Math.max(b.block.maxDrawdownPct, 0.01);
        return bc - ac;
      })[0]!;
      const worstDd = [...y5Rows].sort(
        (a, b) => b.block.maxDrawdownPct - a.block.maxDrawdownPct,
      )[0]!;
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
        },
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
        },
      );
    }
    if (
      !compareResult ||
      !compareResult.overlapOk ||
      !compareResult.correlation
    ) {
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
    <div className="space-y-6">
      <section className="fin-panel p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="fin-section-title">对比摘要</h2>
          <p className="text-xs fin-muted-text">勾选标的后生成</p>
        </div>
        {summaryCards.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map((card) => (
              <a
                key={card.title}
                href={card.href}
                className="fin-summary-card"
              >
                {card.tone === "good" ? (
                  <span className="fin-summary-tone-badge fin-summary-tone-badge--good">
                    分散尚可
                  </span>
                ) : card.tone === "warn" ? (
                  <span className="fin-summary-tone-badge fin-summary-tone-badge--warn">
                    需关注
                  </span>
                ) : null}
                <p className="text-xs font-medium fin-muted-text">
                  {card.title}
                </p>
                <p className="mt-1 text-base font-semibold text-[var(--fin-text)]">
                  {card.value}
                </p>
                <p className="mt-1 text-[11px] fin-muted-text">{card.note}</p>
              </a>
            ))}
          </div>
        )}
        <nav
          aria-label="对比步骤"
          className="mt-4 flex flex-wrap items-center gap-2 text-xs fin-muted-text"
        >
          <span className="fin-step-pill fin-step-pill--active">① 选标的</span>
          <span className="text-[var(--fin-dim)]">→</span>
          <span className="fin-step-pill">② 看收益风险</span>
          <span className="text-[var(--fin-dim)]">→</span>
          <span className="fin-step-pill">③ 看相关性</span>
        </nav>
      </section>
      <section id="etf-pool" className="fin-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--fin-text)]">
            对比标的
          </h2>
          <p className="text-[11px] fin-muted-text">
            主跟踪 · {poolComparableCount} 只可对比
            {compareCodes.length > 0 ?
              <>
                {" "}
                · 已选 {compareCodes.length}
                <button
                  type="button"
                  onClick={() => setCompareCodes([])}
                  className="ml-1 fin-link"
                >
                  清空
                </button>
              </>
            : null}
          </p>
        </div>
        {etfProducts.length === 0 ? (
          <p className="mt-3 text-sm fin-muted-text">暂无观察池产品，请确认数据已加载。</p>
        ) : (
          <div className="compare-pool-shell mt-2 px-2">
            <CompactPoolRow
              label="A股红利"
              items={pool.cn}
              compareCodes={compareCodes}
              toggleCompare={toggleCompare}
              selectAllInSection={selectAllInSection}
            />
            <CompactPoolRow
              label="港股红利"
              items={pool.hk}
              compareCodes={compareCodes}
              toggleCompare={toggleCompare}
              selectAllInSection={selectAllInSection}
            />
            <CompactPoolRow
              label="现金创造"
              items={pool.cf}
              compareCodes={compareCodes}
              toggleCompare={toggleCompare}
              selectAllInSection={selectAllInSection}
            />
          </div>
        )}
      </section>

      <section id="overview-metrics" className="fin-panel p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="fin-section-title">标的概览</h2>
            <p className="mt-1 text-xs fin-muted-text">
              全局时间窗联动收益/风险与相关性矩阵，便于统一口径横向比较。
            </p>
          </div>
          <label className="text-xs fin-muted-text">
            全局时间窗
            <select
              value={windowKey}
              onChange={(e) => setWindowKey(e.target.value as WindowKey)}
              className="fin-input mt-1 block w-full px-3 py-2"
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
          <p className="mt-6 text-sm fin-muted-text">
            请在对比标的池勾选至少 2 只已有日 K 的主跟踪 ETF。
          </p>
        )}
        {compareCodes.length >= 2 && !compareResult && (
          <p className="fin-alert-warn--compact mt-6">
            无法生成概览（数据不足）。
          </p>
        )}
        {compareResult && (
          <div className="mt-8 space-y-8">
            <div>
              <h3 className="fin-section-title">收益与波动</h3>
              <p className="mt-1 text-xs fin-muted-text">
                当前按<strong>{currentWindowLabel}</strong>口径计算；
                <strong>区间收益</strong>=窗口首尾收盘涨跌；
                <strong>年化收益</strong>按 252 交易日由区间复利折算；
                <strong>最大回撤</strong>为区间内峰值到谷底；
                <strong>年化波动</strong>为日收益样本标准差×√252；
                <strong>夏普(简)</strong>=年化÷年化波动；<strong>卡玛</strong>
                ≈年化÷|最大回撤|。
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[880px] text-sm">
                  <thead>
                    <tr className="fin-table-head">
                      {sortableTh("name", "标的", {
                        className: "px-3 py-2 font-normal text-left",
                      })}
                      <th className="px-3 py-2 font-normal">起止</th>
                      {sortableTh("days", "样本日", {
                        className: "px-3 py-2 font-normal text-right",
                      })}
                      {sortableTh("totalReturnPct", "区间收益", {
                        className: "px-3 py-2 font-normal text-right",
                        title: "区间首尾收盘累计涨跌",
                      })}
                      {sortableTh("annualReturnPct", "年化", {
                        className: "px-3 py-2 font-normal text-right",
                      })}
                      {sortableTh("maxDrawdownPct", "回撤", {
                        className: "px-3 py-2 font-normal text-right",
                      })}
                      {sortableTh("annualVolPct", "波动", {
                        className: "px-3 py-2 font-normal text-right",
                      })}
                      {sortableTh("sharpeLike", "风险收益比", {
                        className: "px-3 py-2 font-normal text-right",
                        title: "年化收益 ÷ 年化波动（类夏普，非无风险夏普）",
                      })}
                      {sortableTh("calmarLike", "卡玛", {
                        className: "px-3 py-2 font-normal text-right",
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-fin-border">
                    {overviewRowsSorted.map((r) => {
                      const seg = r.seg;
                      if (!seg) {
                        return (
                          <tr key={r.code} className="fin-row-hover">
                            <td className="px-3 py-2">
                              <Link
                                to={`/etf/${encodeURIComponent(r.code)}`}
                                className="font-medium text-[var(--fin-text)] fin-link"
                              >
                                {r.name}
                              </Link>
                              <p className="font-mono text-xs fin-muted-text">
                                {r.code}
                              </p>
                            </td>
                            <td
                              colSpan={8}
                              className="px-3 py-2 text-xs fin-muted-text"
                            >
                              有效样本不足（需约 ≥20 个交易日）
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <tr
                          key={`${r.code}-${windowKey}`}
                          className="fin-row-hover"
                        >
                          <td className="px-3 py-2">
                            <Link
                              to={`/etf/${encodeURIComponent(r.code)}`}
                              className="font-medium text-[var(--fin-text)] fin-link"
                            >
                              {r.name}
                            </Link>
                            <p className="font-mono text-xs fin-muted-text">
                              {r.code}
                            </p>
                          </td>
                          <td
                            className="px-3 py-2 font-mono text-xs whitespace-nowrap fin-muted-text"
                            title={`${seg.from} 至 ${seg.to}`}
                          >
                            {seg.from}
                            <span className="mx-1 text-[var(--fin-dim)]">
                              ~
                            </span>
                            {seg.to}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                            {seg.days}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                            {fmtPctCell(seg.totalReturnPct)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                            {fmtPctCell(seg.annualReturnPct)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                            {fmtPctCell(seg.maxDrawdownPct)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                            {fmtPctCell(seg.annualVolPct)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                            {fmtRatioCell(seg.sharpeLike)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                            {fmtRatioCell(seg.calmarLike)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div id="overview-correlation" className="mt-8">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h3 className="fin-section-title">日收益相关性（Pearson）</h3>
                <label className="text-xs fin-muted-text">
                  排序
                  <select
                    value={corrOrderMode}
                    onChange={(e) =>
                      setCorrOrderMode(e.target.value as CorrOrderMode)
                    }
                    className="fin-input ml-2 px-2 py-1 text-xs"
                  >
                    <option value="cluster">聚类序（高相关相邻）</option>
                    <option value="code">代码序</option>
                  </select>
                </label>
              </div>
              <p className="mt-1 text-xs fin-muted-text">
                当前按<strong>{currentWindowLabel}</strong>取样；仅使用各标的
                <strong>日期交集</strong>上的日收益序列，重合不足 30
                个交易日时不展示矩阵。
              </p>
              <p className="mt-1 text-[11px] fin-muted-text">
                底色：暖色=正相关更强，蓝色=负相关更强；对角线为同标的；悬浮可看精确值。
              </p>
              {!compareResult.overlapOk || !compareResult.correlation ? (
                <p className="mt-3 text-sm fin-muted-text">
                  {compareResult.overlapDates.length > 0
                    ? `当前重合 ${compareResult.overlapDates.length} 日，需 ≥30 日。`
                    : "所选标的无重合交易日。"}
                </p>
              ) : (
                <p className="mt-2 text-xs font-mono fin-muted-text">
                  重合区间 {compareResult.overlapDates[0]} ~{" "}
                  {
                    compareResult.overlapDates[
                      compareResult.overlapDates.length - 1
                    ]
                  }{" "}
                  · {compareResult.overlapDates.length} 日
                </p>
              )}
              {compareResult.correlation && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[240px] text-sm">
                    <thead>
                      <tr className="fin-table-head">
                        <th className="px-3 py-2 font-normal" />
                        {corrOrderedLabels.map((lb) => (
                          <th
                            key={lb}
                            className="px-3 py-2 text-center font-mono text-xs font-normal"
                          >
                            {lb}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-fin-border">
                      {corrOrderedIndices.map((rowIdx) => (
                        <tr
                          key={compareResult.corrLabels[rowIdx]}
                          className="fin-row-hover"
                        >
                          <th
                            scope="row"
                            className="px-3 py-2 text-left font-mono text-xs font-normal text-[var(--fin-muted)]"
                          >
                            {compareResult.corrLabels[rowIdx]}
                          </th>
                          {corrOrderedIndices.map((colIdx) => {
                            const v =
                              compareResult.correlation![rowIdx][colIdx];
                            const cellStyle =
                              rowIdx === colIdx
                                ? corrDiagonalCellStyle()
                                : corrCellStyle(v);
                            return (
                              <td
                                key={`${rowIdx}-${colIdx}`}
                                className="px-3 py-2 text-center font-mono text-xs tabular-nums"
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
