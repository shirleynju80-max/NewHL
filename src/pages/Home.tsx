import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useDataSource } from "../context/DataSourceContext";
import type { EtfDefinition } from "../types";
import { compareDefinitions } from "../lib/compareEtfs";

const WARN_SHORT_BARS = 504;
const NOTE_SHORT_BARS = 378;

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

function tenureNote(barCount: number): { text: string; tone: "ok" | "warn" | "bad" } | null {
  if (barCount >= WARN_SHORT_BARS) return null;
  if (barCount < NOTE_SHORT_BARS) {
    return {
      text: `上市可交易样本仅约 ${barCount} 日（< 约 1.5 年），策略回测可信度偏低。`,
      tone: "bad",
    };
  }
  return {
    text: `可交易样本 ${barCount} 日（< 约 2 年），回测结论仅供参考。`,
    tone: "warn",
  };
}

function PoolColumn({
  title,
  subtitle,
  items,
  compareCodes,
  toggleCompare,
}: {
  title: string;
  subtitle: string;
  items: EtfDefinition[];
  compareCodes: string[];
  toggleCompare: (code: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-zinc-100 bg-zinc-50/40 p-5">
      <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{subtitle}</p>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-400">暂无</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((e) => {
            const note = tenureNote(e.bars.length);
            return (
              <li
                key={e.meta.code}
                className={`flex gap-3 rounded-xl border p-3 transition ${
                  compareCodes.includes(e.meta.code) ? "border-indigo-300 bg-indigo-50/50" : "border-zinc-100 bg-white"
                }`}
              >
                <label className="flex cursor-pointer items-start pt-1">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-indigo-600 accent-indigo-600"
                    checked={compareCodes.includes(e.meta.code)}
                    onChange={() => toggleCompare(e.meta.code)}
                  />
                </label>
                <Link
                  to={`/etf/${e.meta.code}`}
                  className="group min-w-0 flex-1 rounded-lg p-1 transition hover:bg-zinc-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-zinc-400">{e.meta.code}</p>
                      <p className="mt-0.5 font-semibold text-zinc-900 group-hover:text-indigo-700">{e.meta.name}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">策略 {e.meta.strategy_id}</p>
                  {note && (
                    <p
                      className={`mt-2 rounded-lg px-2 py-1.5 text-xs leading-snug ${
                        note.tone === "bad"
                          ? "bg-red-50 text-red-800 border border-red-100"
                          : "bg-amber-50 text-amber-900 border border-amber-100"
                      }`}
                    >
                      {note.text}
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function HomePage() {
  const { definitions, loadFromDownloads, resetToMock, loadError, sourceKind } = useDataSource();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
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
      if (pick.length >= 3) break;
    }
    if (pick.length >= 2) setCompareCodes(pick.slice(0, 3));
  }, [definitions]);

  function toggleCompare(code: string) {
    setCompareCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }

  const compareDefsOrdered = useMemo((): EtfDefinition[] => {
    return compareCodes
      .map((c) => definitions.find((d) => d.meta.code === c))
      .filter((x): x is EtfDefinition => Boolean(x));
  }, [definitions, compareCodes]);

  const compareResult = useMemo(() => {
    if (compareDefsOrdered.length < 2) return null;
    return compareDefinitions(compareDefsOrdered);
  }, [compareDefsOrdered]);

  const groups = useMemo(() => groupDefinitions(definitions), [definitions]);

  async function onPickFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      await loadFromDownloads(files);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const err = loadError;

  return (
    <div className="space-y-10">
      <section className="rounded-3xl border border-zinc-100 bg-white p-8 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900">CSV 数据</h2>
        <p className="text-sm text-zinc-500 mt-2 max-w-2xl leading-relaxed">
          浏览器<strong>不能</strong>直接读取本机「下载」文件夹路径。请把四个 CSV 放在<strong>下载</strong>（或任意目录），点击下方按钮，在系统文件框里<strong>同时选中</strong>
          <code className="mx-1 rounded bg-zinc-100 px-1 font-mono text-xs">etfs.csv</code>
          <code className="mx-1 rounded bg-zinc-100 px-1 font-mono text-xs">bars.csv</code>
          <code className="mx-1 rounded bg-zinc-100 px-1 font-mono text-xs">bonds.csv</code>
          <code className="mx-1 rounded bg-zinc-100 px-1 font-mono text-xs">etf_params.csv</code>
          。文件名需完全一致（大小写不敏感）。
        </p>
        <p className="text-sm text-zinc-500 mt-3 max-w-2xl">
          可选：将四份文件复制到项目的{" "}
          <code className="rounded bg-zinc-100 px-1 font-mono text-xs">public/data/</code>，启动后会<strong>自动尝试</strong>
          加载（若你在本页已手动选过 CSV，则不会覆盖）。
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            multiple
            className="hidden"
            onChange={(e) => void onPickFiles(e.target.files)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "读取中…" : "从本机选择四个 CSV"}
          </button>
          {(sourceKind === "csv" || sourceKind === "csv_public") && (
            <button
              type="button"
              onClick={() => resetToMock()}
              className="rounded-full border border-zinc-200 px-5 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              恢复内置示例
            </button>
          )}
        </div>
        {err && (
          <p className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</p>
        )}
      </section>

      <section className="rounded-3xl border border-zinc-100 bg-white p-8 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900">标的池</h2>
        <p className="text-sm text-zinc-500 mt-2 max-w-3xl leading-relaxed">
          按品类浏览；勾选 2 只及以上参与下方<strong>标的对比</strong>。点击名称进入<strong>单标的看板</strong>（回测、盘中分位、台账、利差等）。默认已为你在「A股红利」中预勾选至多 3 只用于对比，可改选。
        </p>
        {definitions.length === 0 ? (
          <p className="mt-8 text-sm text-zinc-500">暂无标的，请检查 CSV。</p>
        ) : (
          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            <PoolColumn
              title="A股红利"
              subtitle="dividend_market_scope = A股红利"
              items={groups.cn}
              compareCodes={compareCodes}
              toggleCompare={toggleCompare}
            />
            <PoolColumn
              title="港股红利"
              subtitle="dividend_market_scope = 港股红利"
              items={groups.hk}
              compareCodes={compareCodes}
              toggleCompare={toggleCompare}
            />
            <PoolColumn
              title="现金流类"
              subtitle="product_kind = 现金流类"
              items={groups.cf}
              compareCodes={compareCodes}
              toggleCompare={toggleCompare}
            />
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-zinc-100 bg-white p-8 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900">标的对比（重合交易日）</h2>
        <p className="mt-2 text-sm text-zinc-500 max-w-3xl leading-relaxed">
          在勾选标的的<strong>日期交集</strong>上，按各标的<strong>收盘价买入持有</strong>计算：年化收益（按{" "}
          <span className="font-mono text-xs">252</span> 交易日缩放）、最大回撤、日收益年化波动、收益/回撤比（类 Calmar）；表二为日收益{" "}
          <strong>Pearson 相关性</strong>。指数与 ETF 只要在同一 <code className="rounded bg-zinc-100 px-1 font-mono text-xs">bars.csv</code>{" "}
          中有列即可一起对比。
        </p>
        <p className="mt-3 text-xs text-zinc-500 max-w-3xl">
          可扩展指标建议：<strong>Beta / 跟踪误差</strong>（相对基准指数）、<strong>夏普/索提诺</strong>（需无风险利率与下行收益）、
          <strong>最大连续上涨/下跌日数</strong>、<strong>分月收益热力</strong>等——有基准序列与利率口径后即可接入。
        </p>
        {compareCodes.length < 2 && (
          <p className="mt-6 text-sm text-zinc-500">请在标的池中勾选至少 2 个标的。</p>
        )}
        {compareCodes.length >= 2 && !compareResult && (
          <p className="mt-6 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            所选标的可交易的<strong>重合日历日</strong>不足 30 天，无法稳定对比。请换一组或拉长公共行情区间。
          </p>
        )}
        {compareResult && (
          <div className="mt-8 space-y-8">
            <p className="text-xs font-mono text-zinc-500">
              重合区间 {compareResult.dates[0]} ~ {compareResult.dates[compareResult.dates.length - 1]} ·{" "}
              {compareResult.dates.length} 日
            </p>
            <div className="overflow-x-auto rounded-xl border border-zinc-100">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">代码</th>
                    <th className="px-4 py-3">名称</th>
                    <th className="px-4 py-3">年化收益 %</th>
                    <th className="px-4 py-3">最大回撤 %</th>
                    <th className="px-4 py-3">年化波动 %</th>
                    <th className="px-4 py-3">收益/回撤</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {compareResult.rows.map((r) => (
                    <tr key={r.code} className="hover:bg-zinc-50/80">
                      <td className="px-4 py-2.5 font-mono text-zinc-700">{r.code}</td>
                      <td className="px-4 py-2.5 text-zinc-800">{r.name}</td>
                      <td className="px-4 py-2.5 font-mono">{r.annualReturnPct}%</td>
                      <td className="px-4 py-2.5 font-mono">{r.maxDrawdownPct}%</td>
                      <td className="px-4 py-2.5 font-mono">{r.annualVolPct}%</td>
                      <td className="px-4 py-2.5 font-mono text-zinc-600">
                        {r.calmarLike != null ? r.calmarLike : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">日收益相关性（Pearson）</h3>
              <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-100">
                <table className="min-w-full text-center text-xs">
                  <thead>
                    <tr className="border-b border-zinc-100 bg-zinc-50">
                      <th className="px-2 py-2" />
                      {compareResult.labels.map((lb) => (
                        <th key={lb} className="px-2 py-2 font-mono font-semibold text-zinc-600">
                          {lb}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {compareResult.labels.map((rowLabel, i) => (
                      <tr key={rowLabel} className="border-b border-zinc-50">
                        <td className="bg-zinc-50 px-2 py-2 font-mono font-semibold text-zinc-600">{rowLabel}</td>
                        {compareResult.labels.map((_, j) => (
                          <td key={`${i}-${j}`} className="px-2 py-2 font-mono text-zinc-800">
                            {compareResult.correlation[i][j].toFixed(2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
