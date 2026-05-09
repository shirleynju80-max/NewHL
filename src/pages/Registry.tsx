import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useDataSource } from "../context/DataSourceContext";
import { useStrategyRegistry } from "../context/StrategyRegistryContext";
import { parseBarsCsv } from "../data/csvLoader";
import { gridSearchTopParams, type ScoredParamRow } from "../lib/paramBacktest";
import type { RegisteredStrategyKind } from "../types";

export function RegistryPage() {
  const { definitions: etfDefinitions } = useDataSource();
  const { entries, addEntry, removeEntry } = useStrategyRegistry();

  const barsInputRef = useRef<HTMLInputElement>(null);
  const [barsText, setBarsText] = useState<string | null>(null);
  const [barsErr, setBarsErr] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string>("");
  const [gridBusy, setGridBusy] = useState(false);
  const [gridResult, setGridResult] = useState<ReturnType<typeof gridSearchTopParams> | null>(null);

  const barCodes = useMemo(() => {
    if (!barsText) return [] as string[];
    try {
      return Array.from(parseBarsCsv(barsText).keys()).sort();
    } catch {
      return [];
    }
  }, [barsText]);

  const barsForCode = useMemo(() => {
    if (!barsText || !selectedCode) return null;
    try {
      const m = parseBarsCsv(barsText);
      return m.get(selectedCode) ?? null;
    } catch {
      return null;
    }
  }, [barsText, selectedCode]);

  useEffect(() => {
    if (!barCodes.length) {
      setSelectedCode("");
      return;
    }
    if (!selectedCode || !barCodes.includes(selectedCode)) setSelectedCode(barCodes[0]!);
  }, [barCodes, selectedCode]);

  useEffect(() => {
    if (!barsForCode || barsForCode.length < 40) {
      setGridResult(null);
      return;
    }
    setGridBusy(true);
    const t = window.setTimeout(() => {
      setGridResult(gridSearchTopParams(barsForCode, 2));
      setGridBusy(false);
    }, 0);
    return () => window.clearTimeout(t);
  }, [barsForCode]);

  const onBarsFile = useCallback(async (files: FileList | null) => {
    setBarsErr(null);
    setGridResult(null);
    if (!files?.[0]) return;
    const f = files[0];
    if (!f.name.toLowerCase().endsWith(".csv")) {
      setBarsErr("请上传 .csv 文件");
      return;
    }
    try {
      const text = await f.text();
      parseBarsCsv(text);
      setBarsText(text);
    } catch (e) {
      setBarsErr(e instanceof Error ? e.message : String(e));
      setBarsText(null);
    }
    if (barsInputRef.current) barsInputRef.current.value = "";
  }, []);

  const registerRow = (row: ScoredParamRow) => {
    if (!selectedCode) return;
    const kind: RegisteredStrategyKind = row.family;
    addEntry({
      etfCode: selectedCode,
      label: row.label,
      strategyType: kind,
      strategyId: row.strategyId,
      paramVersion: row.paramVersion,
      params: row.params,
    });
  };

  return (
    <div className="space-y-10">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">参数回测与注册</h2>
        <p className="mt-2 text-sm text-zinc-500 max-w-3xl leading-relaxed">
          上传仅含行情列的 <code className="rounded bg-zinc-100 px-1 font-mono text-xs">bars.csv</code>（与全量格式相同，可含多只{" "}
          <code className="font-mono text-xs">etf_code</code>
          ），系统对选定标的跑 MA / RSI / 布林带<strong>粗网格</strong>回测，列出每类策略的 <strong>Top 2</strong>（按累计收益/最大回撤比排序）。选定后可加入
          <strong>注册表</strong>：注册项会出现在单标的看板与<strong>监控汇总</strong>的参数下拉中（与 CSV 默认参数并列）。
        </p>
      </header>

      <section className="rounded-3xl border border-zinc-100 bg-white p-8 shadow-sm">
        <h3 className="text-lg font-semibold text-zinc-900">用户注册的策略</h3>
        {entries.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">暂无。请从下方回测结果中点击「加入注册」。</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {entries.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-100 bg-zinc-50/50 px-4 py-3 text-sm"
              >
                <div>
                  <span className="font-mono text-xs text-indigo-600">{r.etfCode}</span>
                  <span className="mx-2 text-zinc-300">|</span>
                  <span className="font-medium text-zinc-900">{r.label}</span>
                  <span className="ml-2 rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700">{r.strategyType}</span>
                  <p className="mt-1 text-xs text-zinc-500 font-mono">{r.strategyId} · {r.paramVersion}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Link to={`/etf/${r.etfCode}`} className="text-xs font-medium text-indigo-600 hover:underline">
                    打开看板
                  </Link>
                  <button
                    type="button"
                    onClick={() => removeEntry(r.id)}
                    className="rounded-full border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50"
                  >
                    移除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-3xl border border-zinc-100 bg-white p-8 shadow-sm">
        <h3 className="text-lg font-semibold text-zinc-900">CSV 内置参数（当前数据源）</h3>
        <p className="mt-2 text-sm text-zinc-500">来自 etfs.csv + etf_params.csv，与单标的页默认下拉一致。</p>
        <div className="mt-6 space-y-6">
          {etfDefinitions.map((e) => (
            <article key={e.meta.code} className="rounded-2xl border border-zinc-100 bg-zinc-50/40 p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-zinc-100 pb-4">
                <div>
                  <p className="font-mono text-sm text-indigo-600">{e.meta.code}</p>
                  <h4 className="text-base font-semibold text-zinc-900">{e.meta.name}</h4>
                </div>
                <dl className="flex flex-wrap gap-6 text-sm">
                  <div>
                    <dt className="text-zinc-400">品类</dt>
                    <dd className="font-medium text-zinc-800">{e.meta.product_kind}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">param_version</dt>
                    <dd className="font-mono text-zinc-800">{e.meta.param_version}</dd>
                  </div>
                  {e.meta.dividend_market_scope && (
                    <div>
                      <dt className="text-zinc-400">dividend_market_scope</dt>
                      <dd className="font-medium text-zinc-800">{e.meta.dividend_market_scope}</dd>
                    </div>
                  )}
                </dl>
              </div>
              <div className="mt-4 grid gap-6 lg:grid-cols-3">
                <VariantBlock title="MA" items={e.params.ma_variants} />
                <VariantBlock title="RSI" items={e.params.rsi_variants} />
                <VariantBlock title="布林带" items={e.params.bollinger_variants} />
              </div>
              <p className="mt-4 text-xs text-zinc-400">
                策略引用 MA：<span className="font-mono">{e.params.strategy_ma_ids.join(", ")}</span>
                {e.params.strategy_rsi_id && (
                  <>
                    {" "}
                    · RSI：<span className="font-mono">{e.params.strategy_rsi_id}</span>
                  </>
                )}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-zinc-100 bg-white p-8 shadow-sm">
        <h3 className="text-lg font-semibold text-zinc-900">上传 bars 做参数回测</h3>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={barsInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => void onBarsFile(e.target.files)}
          />
          <button
            type="button"
            onClick={() => barsInputRef.current?.click()}
            className="rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
          >
            选择 bars.csv
          </button>
          {barsText && (
            <button
              type="button"
              onClick={() => {
                setBarsText(null);
                setGridResult(null);
                setBarsErr(null);
              }}
              className="rounded-full border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              清除上传
            </button>
          )}
        </div>
        {barsErr && <p className="mt-4 text-sm text-red-700">{barsErr}</p>}
        {barsText && barCodes.length > 0 && (
          <div className="mt-6">
            <label className="text-sm font-medium text-zinc-700">选择标的代码</label>
            <select
              value={selectedCode}
              onChange={(e) => setSelectedCode(e.target.value)}
              className="mt-2 block max-w-xs rounded-xl border border-zinc-200 px-3 py-2 font-mono text-sm"
            >
              {barCodes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {barsForCode && (
              <p className="mt-2 text-xs text-zinc-500">共 {barsForCode.length} 根日 K（需 ≥40 根才参与网格）</p>
            )}
          </div>
        )}

        {gridBusy && <p className="mt-6 text-sm text-zinc-500">计算中…</p>}
        {gridResult && (
          <div className="mt-8 space-y-8">
            <ResultTable title="MA 类 Top 2" rows={gridResult.ma} onRegister={registerRow} />
            <ResultTable title="RSI 类 Top 2" rows={gridResult.rsi} onRegister={registerRow} />
            <ResultTable title="布林带类 Top 2" rows={gridResult.boll} onRegister={registerRow} />
          </div>
        )}
      </section>
    </div>
  );
}

function ResultTable({
  title,
  rows,
  onRegister,
}: {
  title: string;
  rows: ScoredParamRow[];
  onRegister: (r: ScoredParamRow) => void;
}) {
  if (!rows.length) return null;
  return (
    <div>
      <h4 className="text-sm font-semibold text-zinc-900">{title}</h4>
      <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-100">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2">组合</th>
              <th className="px-3 py-2">累计收益 %</th>
              <th className="px-3 py-2">最大回撤 %</th>
              <th className="px-3 py-2">收益/回撤</th>
              <th className="px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="px-3 py-2 text-zinc-800">{r.label}</td>
                <td className="px-3 py-2 font-mono">{r.cumReturnPct}%</td>
                <td className="px-3 py-2 font-mono">{r.maxDrawdownPct}%</td>
                <td className="px-3 py-2 font-mono text-zinc-600">{r.score}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onRegister(r)}
                    className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800"
                  >
                    加入注册
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VariantBlock<T extends { variant_id: string }>({
  title,
  items,
}: {
  title: string;
  items: T[];
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</h4>
      <ul className="mt-3 space-y-2">
        {items.map((v) => (
          <li
            key={v.variant_id}
            className="rounded-xl bg-white px-3 py-2 font-mono text-xs text-zinc-700 border border-zinc-100"
          >
            <span className="text-indigo-600">{v.variant_id}</span>
            <span className="text-zinc-400"> · </span>
            <span>{JSON.stringify(v)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
