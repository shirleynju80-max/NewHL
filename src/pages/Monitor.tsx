import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { useDataSource } from "../context/DataSourceContext";
import {
  fetchLiveQuote,
  formatQuoteDataUpdateFootnote,
  formatQuotePriceLabel,
  msUntilNextShanghaiBatchUpdate,
  resolvePreviousClose,
  type LiveQuote,
} from "../lib/liveQuote";
import {
  getDeskMonitorParamVariants,
  paramVariantsSummaryLine,
} from "../lib/paramVariants";
import {
  strategyKindLabel,
  variantMonitorCompact,
} from "../lib/strategyLabels";
import { formatPct, formatSignedPct } from "../lib/formatDisplay";
import { strategyPercentileContext } from "../lib/indicatorPercentile";
import { mergeIntraday1345 } from "../lib/strategy";
import type { EtfDefinition } from "../types";
import type { DividendRepresentativePool } from "../lib/dividendRepresentativePool";

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
          codes:
            Array.isArray(j.codes) && j.codes.length
              ? j.codes
              : primaryCodes.slice(0, 6).length
                ? primaryCodes.slice(0, 6)
                : defCodes.slice(0, 4),
          snapByCode:
            typeof j.snapByCode === "object" && j.snapByCode
              ? j.snapByCode
              : {},
        };
      }
    }
    const legacy = localStorage.getItem("desk.monitorPref.v1");
    if (legacy) {
      const j = JSON.parse(legacy) as {
        codes?: string[];
        updateHm?: string;
        snapByCode?: Record<string, number>;
      };
      if (j && typeof j === "object") {
        return {
          updateHm: typeof j.updateHm === "string" ? j.updateHm : "13:45",
          codes:
            Array.isArray(j.codes) && j.codes.length
              ? j.codes
              : primaryCodes.slice(0, 6).length
                ? primaryCodes.slice(0, 6)
                : defCodes.slice(0, 4),
          snapByCode:
            typeof j.snapByCode === "object" && j.snapByCode
              ? j.snapByCode
              : {},
        };
      }
    }
  } catch {
    /* ignore */
  }
  return {
    updateHm: "13:45",
    codes: primaryCodes.slice(0, 6).length
      ? primaryCodes.slice(0, 6)
      : defCodes.slice(0, Math.min(4, defCodes.length)),
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

function zoneLabelFromPercentile(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return "—";
  if (p <= 20) return "临近买";
  if (p >= 80) return "临近卖";
  return "中性";
}

function zoneClass(label: string): string {
  if (label === "临近买") return "fin-zone-chip fin-zone-chip--buy";
  if (label === "临近卖") return "fin-zone-chip fin-zone-chip--sell";
  return "fin-zone-chip fin-zone-chip--neutral";
}

function strongKey(etf: string, strategy: string, version: string): string {
  return `${etf}|${strategy}|${version}`;
}

function DividendRegisteredParamsPanel({
  pool,
}: {
  pool: DividendRepresentativePool | null;
}) {
  if (!pool) return null;
  return (
    <details className="fin-panel group/registered overflow-hidden">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <span className="font-semibold text-[var(--fin-text)]">
          <span className="mr-1.5 inline-block text-[var(--fin-dim)] transition group-open/registered:rotate-90">
            ▸
          </span>
          监控策略优选
          <span className="ml-2 font-mono text-xs font-normal fin-muted-text">
            强超额 {pool.strongDualExcess.length} · 波段{" "}
            {pool.swingCandidates.length}
          </span>
        </span>
      </summary>
      <div className="grid gap-4 border-t border-fin-border px-4 py-4 lg:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-[var(--fin-text)]">
            前段 + 后段均显著超额
          </p>
          <p className="mt-1 text-[11px] fin-muted-text">
            对已注册参数逐条回测（RSI / 布林带各自独立）；训练集、验证集相对买入持有超额均 ≥8%。下方仅展示全样本超额。
          </p>
          <ul className="mt-3 grid gap-1.5 text-xs sm:grid-cols-2">
            {pool.strongDualExcess.map((row) => (
              <li key={`${row.etf}-${row.strategy}-${row.version}`}>
                <Link
                  to={`/etf/${encodeURIComponent(row.etf)}`}
                  className="fin-link font-mono"
                >
                  {row.etf}
                </Link>{" "}
                · {strategyKindLabel(row.strategy)} · 全样本超额{" "}
                <span className="font-mono font-semibold text-[var(--fin-text)]">
                  {formatSignedPct(row.excessReturn)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-medium text-[var(--fin-text)]">波段观察</p>
          <p className="mt-1 text-[11px] fin-muted-text">
            条件：平均每年买卖 2 轮以上、胜率大于 60%、全样本超额为正。
          </p>
          <ul className="mt-3 grid gap-1.5 text-xs sm:grid-cols-2">
            {pool.swingCandidates.map((row) => (
              <li key={`swing-${row.etf}-${row.strategy}`}>
                <Link
                  to={`/etf/${encodeURIComponent(row.etf)}`}
                  className="fin-link font-mono"
                >
                  {row.etf}
                </Link>{" "}
                · {strategyKindLabel(row.strategy)} · 年均{" "}
                <span className="font-mono">
                  {(row.roundsPerYear ?? 0).toFixed(1)}
                </span>{" "}
                轮 · 胜率{" "}
                <span className="font-mono">
                  {formatPct((row.winRate ?? 0) * 100, 0)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
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
  productByCode,
  selectedCodes,
  onToggle,
  onSelectAll,
}: {
  title: string;
  items: EtfDefinition[];
  productByCode: Map<
    string,
    { productGroup?: string; firstTradeDate?: string; listedDate?: string }
  >;
  selectedCodes: string[];
  onToggle: (code: string) => void;
  onSelectAll: (codes: string[]) => void;
}) {
  const codes = items.map((e) => e.meta.code);
  const selectedInSection = codes.filter((c) =>
    selectedCodes.includes(c),
  ).length;
  const allSelected =
    codes.length > 0 && codes.every((c) => selectedCodes.includes(c));

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
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((e) => {
            const checked = selectedCodes.includes(e.meta.code);
            const paramHint = paramVariantsSummaryLine(
              getDeskMonitorParamVariants(e, productByCode.get(e.meta.code)),
            );
            return (
              <li key={e.meta.code}>
                <label
                  title={
                    paramHint ? `${e.meta.name} · ${paramHint}` : e.meta.name
                  }
                  className={`fin-monitor-pick ${checked ? "fin-monitor-pick--active" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(e.meta.code)}
                    className="sr-only"
                  />
                  <span className="font-mono font-semibold">{e.meta.code}</span>
                  <span className="truncate text-[10px]">{e.meta.name}</span>
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
  const { definitions, getEtf, etfProducts, dividendRepresentativePool } =
    useDataSource();

  const defCodes = useMemo(
    () => definitions.map((d) => d.meta.code),
    [definitions],
  );
  const primaryCodes = useMemo(
    () =>
      etfProducts
        .filter((p) => p.isPrimary)
        .map((p) => p.code)
        .filter((c) => defCodes.includes(c)),
    [etfProducts, defCodes],
  );
  const primaryCodeSet = useMemo(() => new Set(primaryCodes), [primaryCodes]);
  /** 监控池勾选列表：仅主跟踪 ETF，不含同指数候选 */
  const monitorPoolDefs = useMemo(
    () => definitions.filter((d) => primaryCodeSet.has(d.meta.code)),
    [definitions, primaryCodeSet],
  );
  const groups = useMemo(
    () => groupDefinitions(monitorPoolDefs),
    [monitorPoolDefs],
  );
  const productByCode = useMemo(
    () =>
      new Map(
        etfProducts.map((p) => [
          p.code,
          {
            productGroup: p.productGroup,
            firstTradeDate: p.firstTradeDate,
            listedDate: p.listedDate,
          },
        ]),
      ),
    [etfProducts],
  );

  const [pref, setPref] = useState<MonitorPref>(() => loadPref([], []));
  useEffect(() => {
    if (!defCodes.length) return;
    setPref((p) => {
      const keepPrimary = (codes: string[]) =>
        codes.filter((c) => primaryCodeSet.has(c));
      if (p.codes.length) {
        const filtered = keepPrimary(p.codes);
        if (
          filtered.length === p.codes.length &&
          filtered.every((c, i) => c === p.codes[i])
        ) {
          return p;
        }
        const next = { ...p, codes: filtered };
        savePref(next);
        return next;
      }
      const loaded = loadPref(defCodes, primaryCodes);
      savePref(loaded);
      return loaded;
    });
  }, [defCodes.join("|"), primaryCodes.join("|"), primaryCodeSet]);

  const setPrefPatch = useCallback((patch: Partial<MonitorPref>) => {
    setPref((prev) => {
      const next = { ...prev, ...patch };
      savePref(next);
      return next;
    });
  }, []);

  const [quotesByCode, setQuotesByCode] = useState<Record<string, LiveQuote>>(
    {},
  );

  const refreshLiveQuotes = useCallback(async () => {
    if (pref.codes.length === 0) {
      setQuotesByCode({});
      return;
    }
    try {
      const entries = await Promise.all(
        pref.codes.map(async (code) => {
          const etf = getEtf(code);
          if (!etf?.bars.length) return [code, null] as const;
          const q = await fetchLiveQuote(code, etf.bars);
          return [code, q] as const;
        }),
      );
      const next: Record<string, LiveQuote> = {};
      for (const [code, q] of entries) {
        if (q) next[code] = q;
      }
      setQuotesByCode(next);
      setPref((prev) => {
        const snapByCode = {
          ...prev.snapByCode,
          ...Object.fromEntries(
            Object.entries(next).map(([code, q]) => [code, q.price]),
          ),
        };
        const updated = { ...prev, snapByCode };
        savePref(updated);
        return updated;
      });
    } catch {
      // 行情拉取失败时保留已有快照
    }
  }, [pref.codes, getEtf]);

  useEffect(() => {
    void refreshLiveQuotes();
    let handle: number | null = null;
    const schedule = () => {
      handle = window.setTimeout(() => {
        void refreshLiveQuotes().finally(schedule);
      }, msUntilNextShanghaiBatchUpdate());
    };
    schedule();
    return () => {
      if (handle != null) window.clearTimeout(handle);
    };
  }, [refreshLiveQuotes]);

  const toggleCode = (code: string) => {
    const has = pref.codes.includes(code);
    const next = has
      ? pref.codes.filter((c) => c !== code)
      : [...pref.codes, code];
    setPrefPatch({ codes: next });
  };

  const selectAllInSection = (codes: string[]) => {
    setPref((prev) => {
      const allIn =
        codes.length > 0 && codes.every((c) => prev.codes.includes(c));
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
    strategyId: string;
    paramVersion: string;
    isStrongExcess: boolean;
    isSwingCandidate: boolean;
    strategyLabel: string;
    snap: number;
    lastClose: number;
    quoteSource: LiveQuote["source"] | null;
    pct: number | null;
    metricLine: string;
    hint: string;
    zoneLabel: string;
  };

  const strongExcessSet = useMemo(() => {
    const s = new Set<string>();
    for (const row of dividendRepresentativePool?.strongDualExcess ?? []) {
      s.add(strongKey(row.etf, row.strategy, row.version));
    }
    return s;
  }, [dividendRepresentativePool]);

  const swingCandidateSet = useMemo(() => {
    const s = new Set<string>();
    for (const row of dividendRepresentativePool?.swingCandidates ?? []) {
      s.add(`${row.etf}|${row.strategy}`);
    }
    return s;
  }, [dividendRepresentativePool]);

  const rowGroups = useMemo((): { code: string; rows: Row[] }[] => {
    const groups: { code: string; rows: Row[] }[] = [];
    for (const code of pref.codes) {
      const etf = getEtf(code);
      if (!etf) continue;
      const vars = getDeskMonitorParamVariants(etf, productByCode.get(code));
      const quote = quotesByCode[code] ?? null;
      const lastClose = resolvePreviousClose(etf.bars, quote);
      const snap = quote?.price ?? pref.snapByCode[code] ?? lastClose;
      const quoteSource = quote?.source ?? null;
      const merged = mergeIntraday1345(etf.bars, snap);
      const block: Row[] = vars.map((v) => {
        const ctx = strategyPercentileContext(
          etf.bars,
          v.params,
          v.strategyId,
          merged,
        );
        const pct = ctx?.percentile ?? null;
        const metricLine =
          ctx != null ? `${ctx.metricName}=${ctx.metricValue}` : "—";
        return {
          variantKey: v.key,
          code,
          etfName: etf.meta.name,
          strategyId: v.strategyId,
          paramVersion: v.paramVersion,
          isStrongExcess: strongExcessSet.has(
            strongKey(code, v.strategyId, v.paramVersion),
          ),
          isSwingCandidate: swingCandidateSet.has(`${code}|${v.strategyId}`),
          strategyLabel: variantMonitorCompact(v),
          snap,
          lastClose,
          quoteSource,
          pct,
          metricLine,
          hint: ctx?.hint ?? "—",
          zoneLabel: zoneLabelFromPercentile(pct),
        };
      });
      if (block.length) groups.push({ code, rows: block });
    }
    return groups;
  }, [
    pref,
    getEtf,
    productByCode,
    quotesByCode,
    strongExcessSet,
    swingCandidateSet,
  ]);

  const poolSummary =
    pref.codes.length > 0
      ? pref.codes.slice(0, 6).join("、") +
        (pref.codes.length > 6 ? ` 等 ${pref.codes.length} 只` : "")
      : "未选择";
  const hasOtc007751 = rowGroups.some((group) => group.code === "007751");

  return (
    <div className="ft-page space-y-4">
      <PageHeader
        kicker="策略层"
        title="盘中监控"
        breadcrumbs={[{ label: "配置总览", to: "/" }, { label: "盘中监控" }]}
        description={
          <>
            用 ETF <strong>最新价格</strong>
            更新各监控策略的买卖分位；盘中优先实时价，工作日 11:00、14:00
            定点同步兜底。
          </>
        }
      />

      <DividendRegisteredParamsPanel pool={dividendRepresentativePool} />

      <details
        className="fin-panel group/pool overflow-hidden"
        open={pref.codes.length === 0}
      >
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
          <span className="font-medium text-[var(--fin-text)]">
            <span className="mr-1.5 text-[var(--fin-dim)] group-open/pool:rotate-90 inline-block transition">
              ▸
            </span>
            监控标的
            <span className="ml-2 font-mono text-xs font-normal fin-muted-text">
              {pref.codes.length}/{monitorPoolDefs.length}
            </span>
          </span>
          <span className="truncate font-mono text-[10px] fin-muted-text max-w-[min(100%,28rem)]">
            {poolSummary}
          </span>
        </summary>
        <div className="max-h-36 overflow-y-auto border-t border-fin-border px-3 py-2 space-y-2">
          <MonitorPoolSection
            title="A股红利"
            items={groups.cn}
            productByCode={productByCode}
            selectedCodes={pref.codes}
            onToggle={toggleCode}
            onSelectAll={selectAllInSection}
          />
          <MonitorPoolSection
            title="港股红利"
            items={groups.hk}
            productByCode={productByCode}
            selectedCodes={pref.codes}
            onToggle={toggleCode}
            onSelectAll={selectAllInSection}
          />
          <MonitorPoolSection
            title="现金流类"
            items={groups.cf}
            productByCode={productByCode}
            selectedCodes={pref.codes}
            onToggle={toggleCode}
            onSelectAll={selectAllInSection}
          />
        </div>
      </details>

      <section className="fin-panel p-4">
        <h3 className="text-sm font-semibold text-[var(--fin-text)]">
          全策略信号与分位
        </h3>
        {rowGroups.length === 0 ? (
          <p className="mt-4 text-sm fin-muted-text">请至少勾选一只标的。</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-fin-border">
            <table className="min-w-full text-left text-xs">
              <thead className="fin-table-head">
                <tr>
                  <th className="px-2 py-1.5 font-normal">标的</th>
                  <th className="px-2 py-1.5 font-normal">行情价</th>
                  <th className="px-2 py-1.5 font-normal">策略</th>
                  <th className="px-2 py-1.5 font-normal">分位</th>
                  <th className="px-2 py-1.5 font-normal">指标</th>
                  <th className="px-2 py-1.5 font-normal">区间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-fin-border">
                {rowGroups.flatMap((g) =>
                  g.rows.map((r, i) => (
                    <tr
                      key={`${r.code}-${r.variantKey}`}
                      className="fin-row-hover"
                    >
                      {i === 0 ? (
                        <td
                          rowSpan={g.rows.length}
                          className="px-2 py-1.5 align-top border-r border-fin-border whitespace-nowrap"
                        >
                          <p className="font-mono font-semibold text-[var(--fin-text)]">
                            {r.code}
                          </p>
                          <p
                            className="max-w-[7rem] truncate text-[10px] fin-muted-text"
                            title={r.etfName}
                          >
                            {r.etfName}
                          </p>
                          <Link
                            to={`/etf/${r.code}?tab=intraday`}
                            className="mt-0.5 inline-block text-[10px] fin-link"
                          >
                            产品详情
                          </Link>
                          {g.rows.length > 1 ? (
                            <p className="mt-0.5 text-[9px] text-[var(--fin-dim)]">
                              {g.rows.length} 套策略
                            </p>
                          ) : null}
                        </td>
                      ) : null}
                      {i === 0 ? (
                        <td
                          rowSpan={g.rows.length}
                          className="px-2 py-1.5 align-top border-r border-fin-border"
                        >
                          <p className="font-mono text-xs font-semibold text-[var(--fin-text)]">
                            {r.snap.toFixed(4)}
                          </p>
                          <p className="text-[9px] text-[var(--fin-dim)]">
                            {formatQuotePriceLabel(r.quoteSource)} · 昨收{" "}
                            {r.lastClose.toFixed(4)}
                          </p>
                        </td>
                      ) : null}
                      <td
                        className="px-2 py-1.5 text-[10px] text-[var(--fin-text)] max-w-[12rem] truncate"
                        title={r.strategyLabel}
                      >
                        <span className="text-[var(--fin-text)]">
                          {r.strategyLabel}
                        </span>
                        {r.isStrongExcess ? (
                          <span className="fin-summary-tone-badge fin-summary-tone-badge--good ml-1 !mb-0 px-1 py-0 text-[9px]">
                            超额
                          </span>
                        ) : r.isSwingCandidate ? (
                          <span className="ml-1 rounded border border-fin-border px-1 py-0.5 text-[9px] fin-muted-text">
                            波段
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[10px]">
                        {formatPct(r.pct)}
                      </td>
                      <td
                        className="px-2 py-1.5 font-mono text-[10px] fin-muted-text max-w-[8rem] truncate"
                        title={r.metricLine}
                      >
                        {r.metricLine}
                      </td>
                      <td className="px-2 py-1.5 text-[10px]" title={r.hint}>
                        <span className={zoneClass(r.zoneLabel)}>
                          {r.zoneLabel}
                        </span>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
            <div className="border-t border-fin-border px-3 py-2 space-y-1 text-[10px] text-fin-muted">
              <p>
                分位数按照策略买卖点拉到 0–100%，计算当前价格所处的分位数。
              </p>
              <p>{formatQuoteDataUpdateFootnote()}</p>
              {hasOtc007751 ? <p>场外etf用累计净值数据</p> : null}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
