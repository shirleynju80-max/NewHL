import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { useDataSource } from "../context/DataSourceContext";
import {
  fetchLiveQuote,
  formatQuoteFetchedAt,
  formatQuoteSourceLabel,
  type LiveQuote,
} from "../lib/liveQuote";
import {
  getDeskMonitorParamVariants,
  paramVariantsSummaryLine,
} from "../lib/paramVariants";
import { strategyKindLabel, variantMonitorCompact } from "../lib/strategyLabels";
import { tryWebThenApiBars } from "../lib/marketDataSync";
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
  const gen = pool.generatedAt.slice(0, 10);
  return (
    <details className="fin-panel fin-panel-muted group/registered overflow-hidden">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <span className="font-semibold text-[var(--fin-text)]">
          <span className="mr-1.5 inline-block text-[var(--fin-dim)] transition group-open/registered:rotate-90">
            ▸
          </span>
          已登记策略评估
          <span className="ml-2 font-mono text-xs font-normal fin-muted-text">
            强超额 {pool.strongDualExcess.length} · 波段 {pool.swingCandidates.length}
          </span>
        </span>
        <span className="text-xs fin-muted-text">
          基于 {gen} 全样本回测，入选仍要求训练 + 验证均超额
        </span>
      </summary>
      <div className="grid gap-4 border-t border-fin-border px-4 py-4 lg:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-[var(--fin-text)]">
            训练 + 验证均显著超额
          </p>
          <p className="mt-1 text-[11px] fin-muted-text">
            下方仅展示全样本超额，即策略收益相对买入持有基准的差值。
          </p>
          <ul className="mt-3 grid gap-1.5 text-xs sm:grid-cols-2">
            {pool.strongDualExcess.map((row) => (
              <li key={`${row.etf}-${row.strategy}-${row.version}`}>
                <Link
                  to={`/registry?etf=${encodeURIComponent(row.etf)}`}
                  className="fin-link font-mono"
                >
                  {row.etf}
                </Link>{" "}
                · {strategyKindLabel(row.strategy)} · 全样本超额{" "}
                <span className="font-mono text-emerald-300">
                  {formatSignedPct(row.excessReturn)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-medium text-[var(--fin-text)]">
            波段观察
          </p>
          <p className="mt-1 text-[11px] fin-muted-text">
            条件：平均每年买卖 2 轮以上、胜率大于 60%、全样本超额为正。
          </p>
          <ul className="mt-3 grid gap-1.5 text-xs sm:grid-cols-2">
            {pool.swingCandidates.map((row) => (
              <li key={`swing-${row.etf}-${row.strategy}`}>
                <Link
                  to={`/registry?etf=${encodeURIComponent(row.etf)}`}
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

function msUntilNextShanghaiTime(hm: string): number {
  const [hh, mm] = hm.split(":").map((x) => Number(x));
  const now = new Date();
  const shParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) =>
    Number(shParts.find((p) => p.type === type)?.value ?? 0);
  const current =
    ((part("hour") * 60 + part("minute")) * 60 + part("second")) * 1000;
  const target = ((hh * 60 + mm) * 60) * 1000;
  const day = 24 * 60 * 60 * 1000;
  const delta = target - current;
  return delta > 0 ? delta : delta + day;
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
  productByCode: Map<string, { productGroup?: string; firstTradeDate?: string; listedDate?: string }>;
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
                    paramHint
                      ? `${e.meta.name} · ${paramHint}`
                      : e.meta.name
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
  const primaryCodeSet = useMemo(
    () => new Set(primaryCodes),
    [primaryCodes],
  );
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

  const [lastRun, setLastRun] = useState<string | null>(null);
  const [remoteSyncMsg, setRemoteSyncMsg] = useState<Record<string, string>>(
    {},
  );
  const [syncBusy, setSyncBusy] = useState(false);
  const [quotesByCode, setQuotesByCode] = useState<Record<string, LiveQuote>>(
    {},
  );
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
        }),
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
          ...Object.fromEntries(
            Object.entries(next).map(([code, q]) => [code, q.price]),
          ),
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
    let interval: number | null = null;
    const timeout = window.setTimeout(() => {
      void refreshLiveQuotes();
      interval = window.setInterval(
        () => void refreshLiveQuotes(),
        24 * 60 * 60 * 1000,
      );
    }, msUntilNextShanghaiTime("14:00"));
    return () => {
      window.clearTimeout(timeout);
      if (interval != null) window.clearInterval(interval);
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
      const vars = getDeskMonitorParamVariants(
        etf,
        productByCode.get(code),
      );
      const lastClose = etf.bars[etf.bars.length - 1]?.close ?? 1;
      const snap =
        quotesByCode[code]?.price ?? pref.snapByCode[code] ?? lastClose;
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
          pct,
          metricLine,
          hint: ctx?.hint ?? "—",
          zoneLabel: zoneLabelFromPercentile(pct),
        };
      });
      if (block.length) groups.push({ code, rows: block });
    }
    return groups;
  }, [pref, getEtf, productByCode, quotesByCode, strongExcessSet, swingCandidateSet]);

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
          if (r.consistency.mismatchSamples.length)
            bits.push(...r.consistency.mismatchSamples.slice(0, 4));
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
      ? pref.codes.slice(0, 6).join("、") +
        (pref.codes.length > 6 ? ` 等 ${pref.codes.length} 只` : "")
      : "未选择";

  return (
    <div className="ft-page space-y-4">
      <PageHeader
        kicker="策略层"
        title="盘中监控"
        breadcrumbs={[{ label: "配置总览", to: "/" }, { label: "盘中监控" }]}
        description={
          <>
            用 <strong>ETF 实时价格</strong>
            重算已登记策略的标尺区间，只展示各指数主跟踪 ETF 的盘中执行状态。详细口径见下方「标尺说明」。
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--fin-text)]">
            全策略信号与标尺
          </h3>
          <button
            type="button"
            onClick={() => void refreshLiveQuotes()}
            disabled={quotesLoading || pref.codes.length === 0}
            className="fin-btn-secondary rounded-full px-3 py-1 text-xs disabled:opacity-50"
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
                </tr>
              </thead>
              <tbody className="divide-y divide-fin-border">
                {rowGroups.flatMap((g) =>
                  g.rows.map((r, i) => (
                    <tr
                      key={`${r.code}-${r.variantKey}`}
                      className={`hover:bg-fin-panel-muted/80 ${
                        r.isStrongExcess
                          ? "bg-emerald-500/[0.06]"
                          : r.isSwingCandidate
                            ? "bg-blue-500/[0.05]"
                            : ""
                      }`}
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
                              {g.rows.length} 套登记参数
                            </p>
                          ) : null}
                        </td>
                      ) : null}
                      {i === 0 ? (
                        <td
                          rowSpan={g.rows.length}
                          className="px-2 py-1.5 align-top border-r border-fin-border"
                        >
                          <p className="font-mono text-xs font-semibold text-[var(--fin-blue)]">
                            {r.snap.toFixed(4)}
                          </p>
                          <p className="text-[9px] text-[var(--fin-dim)]">
                            昨收 {r.lastClose.toFixed(4)}
                            {quotesByCode[r.code]
                              ? ` · ${formatQuoteSourceLabel(quotesByCode[r.code]!.source)}`
                              : null}
                          </p>
                        </td>
                      ) : null}
                      <td
                        className="px-2 py-1.5 text-[10px] text-[var(--fin-text)] max-w-[12rem] truncate"
                        title={r.strategyLabel}
                      >
                        <span
                          className={
                            r.isStrongExcess
                              ? "text-emerald-200"
                              : r.isSwingCandidate
                                ? "text-blue-200"
                                : ""
                          }
                        >
                          {r.strategyLabel}
                        </span>
                        {r.isStrongExcess ? (
                          <span className="ml-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1 py-0.5 text-[9px] text-emerald-200">
                            超额
                          </span>
                        ) : r.isSwingCandidate ? (
                          <span className="ml-1 rounded border border-blue-500/30 bg-blue-500/10 px-1 py-0.5 text-[9px] text-blue-200">
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
          </div>
        )}
        {quotesFetchedAt && pref.codes.length > 0 ? (
          <p className="mt-3 border-t border-fin-border pt-3 text-center text-[10px] text-fin-muted">
            行情数据更新：{formatQuoteFetchedAt(quotesFetchedAt)} · 每日
            14:00 自动刷新一次 ·
            实时源优先级：东方财富、新浪、腾讯；均不可用时使用最新日 K 收盘价
          </p>
        ) : null}
      </section>

      <details className="rounded-lg border border-fin-border bg-fin-panel-muted/50 p-4 text-sm fin-muted-text">
        <summary className="cursor-pointer list-none font-medium text-[var(--fin-text)] [&::-webkit-details-marker]:hidden">
          <span className="mr-2 text-[var(--fin-dim)]">▸</span>
          标尺说明（默认折叠）
        </summary>
        <p className="mt-3 leading-relaxed">
          对纳入监控的 ETF，列出 <strong>etf_params.csv 登记的全部策略参数</strong>
          （含 RSI / 布林带等多套）在「昨收全日 K + ETF
          实时最新价」合成下的标尺与提醒。标尺 %
          表示当前指标值在策略买、卖阈值之间的线性位置（0 贴近买侧，100
          贴近卖侧），不是历史经验分位，也<strong>不是</strong>
          指数实时点位。RSI 按超卖到超买区间线性映射；布林按当前价在下轨到上轨之间的位置线性映射。标尺
          ≤20% 为临近买，20%–80% 为中性，≥80% 为临近卖。
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
          {lastRun && (
            <p className="text-xs text-[var(--fin-dim)]">上次点击：{lastRun}</p>
          )}
        </div>
      </details>

      <details className="fin-panel p-4 text-sm">
        <summary className="cursor-pointer list-none font-medium text-[var(--fin-text)] [&::-webkit-details-marker]:hidden">
          <span className="mr-2 text-[var(--fin-dim)]">▸</span>
          高级：外部行情校验（可选）
        </summary>
        <p className="mt-3 text-xs leading-relaxed fin-muted-text">
          默认使用站点已发布的日 K
          与盘中快照重算标尺。若已接入自有行情网关，可对已选标的拉取并比对重叠日期一致性。
        </p>
        <button
          type="button"
          disabled={syncBusy || pref.codes.length === 0}
          onClick={() => void runRemoteSyncAll()}
          className="fin-btn-secondary mt-3 rounded-full px-4 py-1.5 text-xs disabled:opacity-50"
        >
          {syncBusy ? "校验中…" : "对已选标的拉取并比对"}
        </button>
        {Object.keys(remoteSyncMsg).length > 0 && (
          <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto font-mono text-[10px] fin-muted-text">
            {pref.codes.map((c) =>
              remoteSyncMsg[c] ? (
                <li key={c}>
                  <span className="text-[var(--fin-blue)]">{c}</span>{" "}
                  {remoteSyncMsg[c]}
                </li>
              ) : null,
            )}
          </ul>
        )}
      </details>
    </div>
  );
}
