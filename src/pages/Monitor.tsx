import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDataSource } from "../context/DataSourceContext";
import { useStrategyRegistry } from "../context/StrategyRegistryContext";
import { getParamVariants } from "../lib/paramVariants";
import { strategyPercentileContext } from "../lib/indicatorPercentile";
import { mergeIntraday1345 } from "../lib/strategy";

const LS_PREF = "desk.monitorPref.v1";

type MonitorPref = {
  updateHm: string;
  codes: string[];
  snapByCode: Record<string, number>;
  variantKeyByCode: Record<string, string>;
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
          variantKeyByCode: typeof j.variantKeyByCode === "object" && j.variantKeyByCode ? j.variantKeyByCode : {},
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
    variantKeyByCode: {},
  };
}

function savePref(p: MonitorPref) {
  try {
    localStorage.setItem(LS_PREF, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function MonitorPage() {
  const { definitions, getEtf } = useDataSource();
  const { entries } = useStrategyRegistry();

  const defCodes = useMemo(() => definitions.map((d) => d.meta.code), [definitions]);

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

  const toggleCode = (code: string) => {
    const has = pref.codes.includes(code);
    const next = has ? pref.codes.filter((c) => c !== code) : [...pref.codes, code];
    setPrefPatch({ codes: next });
  };

  const rows = useMemo(() => {
    return pref.codes
      .map((code) => {
        const etf = getEtf(code);
        if (!etf) return null;
        const vars = getParamVariants(etf, entries);
        const vk = pref.variantKeyByCode[code] ?? vars[0]?.key ?? "";
        const v = vars.find((x) => x.key === vk) ?? vars[0];
        if (!v) return null;
        const lastClose = etf.bars[etf.bars.length - 1]?.close ?? 1;
        const snap = pref.snapByCode[code] ?? lastClose;
        const merged = mergeIntraday1345(etf.bars, snap);
        const ctx = strategyPercentileContext(etf.bars, v.params, v.strategyId, merged);
        return { code, etf, v, snap, lastClose, ctx };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  }, [pref, getEtf, entries]);

  const runRefresh = () => {
    setLastRun(new Date().toLocaleString("zh-CN", { hour12: false }));
  };

  return (
    <div className="space-y-10">
      <header className="rounded-3xl border border-zinc-100 bg-white p-8 shadow-sm">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">监控汇总</h2>
        <p className="mt-2 text-sm text-zinc-500 max-w-3xl leading-relaxed">
          按设定<strong>参考时点</strong>（默认 13:45）用<strong>模拟现价</strong>与 T-1 全日 K 合成当日 K，复用与单标的页一致的<strong>历史分位</strong>规则，给出买入/卖出区间提示。
          无实时行情网关时，请在下方填写或沿用昨收，并点击「按当前模拟价刷新汇总」。
        </p>
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
            按当前模拟价刷新汇总
          </button>
          {lastRun && <p className="text-xs text-zinc-400">上次点击：{lastRun}</p>}
        </div>
      </header>

      <section className="rounded-3xl border border-zinc-100 bg-white p-8 shadow-sm">
        <h3 className="text-lg font-semibold text-zinc-900">纳入监控的标的</h3>
        <p className="mt-2 text-sm text-zinc-500">与总览标的池联动（同一数据源）；勾选后出现在下表。已选：{pref.codes.length} 只</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {definitions.map((d) => (
            <label
              key={d.meta.code}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                pref.codes.includes(d.meta.code) ? "border-indigo-300 bg-indigo-50" : "border-zinc-200"
              }`}
            >
              <input
                type="checkbox"
                checked={pref.codes.includes(d.meta.code)}
                onChange={() => toggleCode(d.meta.code)}
                className="rounded border-zinc-300 text-indigo-600"
              />
              <span className="font-mono text-xs text-zinc-500">{d.meta.code}</span>
              <span className="text-zinc-800">{d.meta.name}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-zinc-100 bg-white p-8 shadow-sm">
        <h3 className="text-lg font-semibold text-zinc-900">区间提示（分位 ≤20% 买入 / ≥80% 卖出）</h3>
        {rows.length === 0 ? (
          <p className="mt-6 text-sm text-zinc-500">请至少勾选一只标的。</p>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-100">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">标的</th>
                  <th className="px-4 py-3">参数方案</th>
                  <th className="px-4 py-3">模拟现价</th>
                  <th className="px-4 py-3">指标</th>
                  <th className="px-4 py-3">分位</th>
                  <th className="px-4 py-3">提示</th>
                  <th className="px-4 py-3">明细</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map(({ code, etf, snap, lastClose, ctx }) => {
                  const vars = getParamVariants(etf, entries);
                  return (
                    <tr key={code} className="hover:bg-zinc-50/80">
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs text-zinc-500">{code}</p>
                        <p className="font-medium text-zinc-900">{etf.meta.name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={pref.variantKeyByCode[code] ?? vars[0]?.key}
                          onChange={(e) =>
                            setPrefPatch({
                              variantKeyByCode: { ...pref.variantKeyByCode, [code]: e.target.value },
                            })
                          }
                          className="max-w-[14rem] rounded-lg border border-zinc-200 px-2 py-1 text-xs"
                        >
                          {vars.map((x) => (
                            <option key={x.key} value={x.key}>
                              {x.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          step="0.001"
                          value={snap}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (!Number.isFinite(n)) return;
                            setPrefPatch({ snapByCode: { ...pref.snapByCode, [code]: n } });
                          }}
                          className="w-28 rounded-lg border border-zinc-200 px-2 py-1 font-mono text-xs"
                        />
                        <p className="mt-1 text-xs text-zinc-400">昨收 {lastClose}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-zinc-700">
                        {ctx ? `${ctx.metricName} ${ctx.metricValue}` : "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{ctx ? `${ctx.percentile}%` : "—"}</td>
                      <td className="px-4 py-3 text-xs text-zinc-700 max-w-xs">{ctx?.hint ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Link to={`/etf/${code}`} className="text-xs font-medium text-indigo-600 hover:underline">
                          打开看板
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
