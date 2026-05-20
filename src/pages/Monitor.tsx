import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDataSource } from "../context/DataSourceContext";
import { useStrategyRegistry } from "../context/StrategyRegistryContext";
import { getParamVariants } from "../lib/paramVariants";
import { variantMonitorCompact } from "../lib/strategyLabels";
import { tryWebThenApiBars } from "../lib/marketDataSync";
import { strategyPercentileContext } from "../lib/indicatorPercentile";
import { mergeIntraday1345 } from "../lib/strategy";
import type { EtfDefinition } from "../types";

const LS_PREF = "desk.monitorPref.v2";

type MonitorPref = {
  updateHm: string;
  codes: string[];
  snapByCode: Record<string, number>;
};

function loadPref(defCodes: string[]): MonitorPref {
  try {
    const raw = localStorage.getItem(LS_PREF);
    if (raw) {
      const j = JSON.parse(raw) as MonitorPref;
      if (j && typeof j === "object") {
        return {
          updateHm: typeof j.updateHm === "string" ? j.updateHm : "13:45",
          codes: Array.isArray(j.codes) && j.codes.length ? j.codes : defCodes.slice(0, 4),
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
          codes: Array.isArray(j.codes) && j.codes.length ? j.codes : defCodes.slice(0, 4),
          snapByCode: typeof j.snapByCode === "object" && j.snapByCode ? j.snapByCode : {},
        };
      }
    }
  } catch {
    /* ignore */
  }
  return {
    updateHm: "13:45",
    codes: defCodes.slice(0, Math.min(4, defCodes.length)),
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
    <div className="rounded-lg border border-zinc-100 bg-zinc-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h4 className="text-sm font-semibold text-zinc-900">{title}</h4>
          <span className="text-xs text-zinc-400">
            {selectedInSection}/{items.length} 已选
          </span>
        </div>
        {items.length > 0 ? (
          <button
            type="button"
            onClick={() => onSelectAll(codes)}
            className="text-xs font-medium text-indigo-600 hover:underline"
          >
            {allSelected ? "取消本类" : "全选本类"}
          </button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-400">暂无</p>
      ) : (
        <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((e) => {
            const checked = selectedCodes.includes(e.meta.code);
            return (
              <li
                key={e.meta.code}
                className={`rounded-md border py-1.5 px-2 transition ${
                  checked ? "border-indigo-300 bg-indigo-50/60" : "border-zinc-100 bg-white"
                }`}
              >
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(e.meta.code)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-zinc-300 text-indigo-600 accent-indigo-600"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-[10px] text-zinc-400">{e.meta.code}</span>
                    <span className="mt-0.5 block text-xs font-medium leading-snug text-zinc-900 line-clamp-2">
                      {e.meta.name}
                    </span>
                  </span>
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
  const { definitions, getEtf } = useDataSource();
  const { entries } = useStrategyRegistry();

  const defCodes = useMemo(() => definitions.map((d) => d.meta.code), [definitions]);
  const groups = useMemo(() => groupDefinitions(definitions), [definitions]);

  const [pref, setPref] = useState<MonitorPref>(() => loadPref([]));
  useEffect(() => {
    if (defCodes.length) setPref((p) => (p.codes.length ? p : loadPref(defCodes)));
  }, [defCodes.join("|")]);

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
      const snap = pref.snapByCode[code] ?? lastClose;
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
  }, [pref, getEtf, entries]);

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

  return (
    <div className="space-y-8">
      <header className="rounded-lg border border-zinc-100 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">今日盘中信号</h2>
        <p className="mt-2 text-sm text-zinc-600 max-w-3xl leading-relaxed">
          对纳入监控的标的，列出<strong>全部可切换策略</strong>在「昨收全日 K + 下方模拟收盘」合成下的<strong>标尺与提醒</strong>（本表<strong>不展示</strong>单日 BUY/SELL：空仓时易被误读为「今日应卖」）。
          <strong>标尺 %</strong>表示<strong>当前指标值在策略买、卖阈值之间</strong>的线性位置（0 贴近买侧参数，100 贴近卖侧），例如 RSI 在超卖–超买之间插值；布林在上下轨之间；MA 类在策略约定的价差或偏离带内——
          <strong>不是</strong>历史样本经验分位。看具体买卖时点请打开单标的<strong>回测</strong>页。
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          参考时点默认 13:45，与单标的页合成规则一致。标尺 ≤20% / ≥80% 为贴近买、卖侧；中间区为「临近/靠近」提醒。
        </p>
        <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50/80 px-4 py-3 text-xs text-zinc-700">
          <p className="font-medium text-zinc-900">盘中数据来源与校验</p>
          <p className="mt-1 leading-relaxed text-zinc-600">
            默认读取 <code className="rounded bg-white px-1">bars.csv + barsmore.csv</code>。GitHub Actions 的实时爬虫会在 11:00 / 14:00 写入当日快照；本页只负责基于当前 CSV 重算标尺。下方按钮用于接入自有行情网关后的重叠日期一致性校验。
          </p>
          <button
            type="button"
            disabled={syncBusy || pref.codes.length === 0}
            onClick={() => void runRemoteSyncAll()}
            className="mt-2 rounded-full bg-zinc-800 px-4 py-1.5 text-xs font-medium text-white hover:bg-zinc-900 disabled:opacity-50"
          >
            {syncBusy ? "校验中…" : "对已选标的拉取并比对"}
          </button>
          {Object.keys(remoteSyncMsg).length > 0 && (
            <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto font-mono text-[10px] text-zinc-600">
              {pref.codes.map((c) =>
                remoteSyncMsg[c] ? (
                  <li key={c}>
                    <span className="text-indigo-700">{c}</span> {remoteSyncMsg[c]}
                  </li>
                ) : null
              )}
            </ul>
          )}
        </div>
        <div className="mt-6 flex flex-wrap items-end gap-4">
          <label className="text-sm text-zinc-600">
            参考更新时点
            <input
              type="time"
              value={pref.updateHm}
              onChange={(e) => setPrefPatch({ updateHm: e.target.value })}
              className="mt-1 block rounded-xl border border-zinc-200 px-3 py-2 font-mono text-sm"
            />
          </label>
          <button
            type="button"
            onClick={runRefresh}
            className="rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
          >
            刷新汇总时刻
          </button>
          {lastRun && <p className="text-xs text-zinc-400">上次点击：{lastRun}</p>}
        </div>
      </header>

      <section className="rounded-lg border border-zinc-100 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg font-semibold text-zinc-900">监控标的</h3>
          <p className="text-sm text-zinc-500">已选 {pref.codes.length} / {definitions.length} 只</p>
        </div>
        <div className="mt-4 space-y-3">
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
      </section>

      <section className="rounded-lg border border-zinc-100 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-zinc-900">全策略信号与标尺</h3>
        {rowGroups.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">请至少勾选一只标的。</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-100">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2.5">标的</th>
                  <th className="px-3 py-2.5">模拟收盘</th>
                  <th className="px-3 py-2.5">策略</th>
                  <th className="px-3 py-2.5">标尺%</th>
                  <th className="px-3 py-2.5">指标</th>
                  <th className="px-3 py-2.5">区间</th>
                  <th className="px-3 py-2.5">提醒</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rowGroups.flatMap((g) =>
                  g.rows.map((r, i) => (
                    <tr key={`${r.code}-${r.variantKey}`} className="hover:bg-zinc-50/80">
                      {i === 0 ? (
                        <td rowSpan={g.rows.length} className="px-3 py-2 align-top border-r border-zinc-50">
                          <p className="font-mono text-[10px] text-zinc-400">{r.code}</p>
                          <p className="font-medium text-zinc-900 leading-snug">{r.etfName}</p>
                          <Link
                            to={`/etf/${r.code}`}
                            className="mt-2 inline-block text-xs font-medium text-indigo-600 hover:underline"
                          >
                            打开看板
                          </Link>
                        </td>
                      ) : null}
                      {i === 0 ? (
                        <td rowSpan={g.rows.length} className="px-3 py-2 align-top border-r border-zinc-50">
                          <input
                            type="number"
                            step="0.001"
                            value={r.snap}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              if (!Number.isFinite(n)) return;
                              setPrefPatch({ snapByCode: { ...pref.snapByCode, [r.code]: n } });
                            }}
                            className="w-24 rounded border border-zinc-200 px-1.5 py-0.5 font-mono text-xs"
                          />
                          <p className="mt-1 text-[10px] text-zinc-400">昨收 {r.lastClose}</p>
                        </td>
                      ) : null}
                      <td className="px-3 py-2 text-xs text-zinc-800 max-w-[16rem]">{r.strategyLabel}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.pct != null ? `${r.pct}%` : "—"}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-zinc-700">{r.metricLine}</td>
                      <td className="px-3 py-2 text-xs text-zinc-600 max-w-[10rem]">{r.hint}</td>
                      <td className="px-3 py-2 text-xs">
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
      </section>
    </div>
  );
}
