import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useDataSource } from "../context/DataSourceContext";
import { useStrategyRegistry } from "../context/StrategyRegistryContext";
import { parseBarsCsv } from "../data/csvLoader";
import {
  backtestSummaryForParams,
  DEFAULT_PARAM_SEARCH,
  gridSearchTopParams,
  sameScoredParamRow,
  type GridSearchOutcome,
  type ParamSearchSnapshot,
  type ScoredParamRow,
} from "../lib/paramBacktest";
import { getParamVariants } from "../lib/paramVariants";
import {
  isUserRegisteredVariantKey,
  registeredIdFromVariantKey,
  strategyKindLabel,
} from "../lib/strategyLabels";
import type { ParamStrategyVariant, RegisteredStrategyKind } from "../types";

const TOP_N_OPTIONS = [2, 3, 5, 8, 10] as const;
/** 训练集占比可选值（10% 步进，避免细粒度拖动触发重复全量网格） */
const TRAIN_RATIO_PCT_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90] as const;

function parseNumList(s: string): number[] {
  return s
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}

function coalesce<T>(parsed: T[], fallback: T[]): T[] {
  return parsed.length ? parsed : fallback;
}

/** 全样本无一组合跑赢买入持有时，给出可能原因 */
function noBeatBuyHoldHints(result: GridSearchOutcome): string[] | null {
  const rows = [...result.rsi, ...result.boll, ...result.maCross, ...result.maCustom];
  if (!rows.length) return ["网格无有效成交组合，可放宽参数范围或延长样本"];
  const bestFullExcess =
    result.globalFullBest?.excessReturnPct ?? Math.max(...rows.map((r) => r.excessReturnPct));
  if (bestFullExcess > 0) return null;

  const hints: string[] = ["当前 Top 组合在全样本上均未跑赢买入持有"];
  const { barCount, buyHoldReturnPct, buyHoldAnnualPct, buyHoldMaxDrawdownPct } = result.meta;
  const { valBarCount, trainBarCount } = result.split;

  if (barCount < 252) hints.push(`样本约 ${barCount} 日，窗口偏短，择时优势难稳定体现`);
  else if (barCount < 504) hints.push("样本不足两年，长周期策略相对买入持有的优势不易显现");
  if (buyHoldReturnPct > 30 && buyHoldMaxDrawdownPct > -25) {
    hints.push("区间收益高且回撤可控，偏慢牛/趋势市，持有往往优于频繁交易");
  }
  if (buyHoldAnnualPct > 12 && buyHoldMaxDrawdownPct > -20) {
    hints.push("年化较强、回撤不深，均值回归类信号易被趋势碾压");
  }
  if (valBarCount < 60) hints.push("验证段不足约 60 日，分段排序参考价值有限");
  if (trainBarCount < 60) hints.push("训练段过短，易过拟合短窗噪声");
  if (rows.every((r) => r.roundCount < 3)) hints.push("换手轮次过少，信号稀疏或参数过严");

  return hints;
}

type SearchForm = {
  maCrossFastStr: string;
  maCrossSlowStr: string;
  maCustomBuyStr: string;
  maCustomProfitStr: string;
  maCustomDdStr: string;
  rsiD: boolean;
  rsiW: boolean;
  rsiPeriodStr: string;
  rsiOsStr: string;
  rsiObStr: string;
  bollD: boolean;
  bollW: boolean;
  bollPeriodStr: string;
  bollStdStr: string;
};

function formFromDefaults(): SearchForm {
  const d = DEFAULT_PARAM_SEARCH;
  return {
    maCrossFastStr: d.maCrossFast.join(","),
    maCrossSlowStr: d.maCrossSlow.join(","),
    maCustomBuyStr: d.maCustomBuyMa.join(","),
    maCustomProfitStr: d.maCustomProfitPct.join(","),
    maCustomDdStr: d.maCustomDrawdownPct.join(","),
    rsiD: d.rsiModes.includes("1d"),
    rsiW: d.rsiModes.includes("1w"),
    rsiPeriodStr: d.rsiPeriods.join(","),
    rsiOsStr: d.rsiOversold.join(","),
    rsiObStr: d.rsiOverbought.join(","),
    bollD: d.bollModes.includes("1d"),
    bollW: d.bollModes.includes("1w"),
    bollPeriodStr: d.bollPeriods.join(","),
    bollStdStr: d.bollStd.join(","),
  };
}

function snapshotFromForm(f: SearchForm): ParamSearchSnapshot {
  const d = DEFAULT_PARAM_SEARCH;
  const rsiModes = ([] as ("1d" | "1w")[]).concat(f.rsiD ? (["1d"] as const) : [], f.rsiW ? (["1w"] as const) : []);
  const bollModes = ([] as ("1d" | "1w")[]).concat(f.bollD ? (["1d"] as const) : [], f.bollW ? (["1w"] as const) : []);
  return {
    maCrossFast: coalesce(parseNumList(f.maCrossFastStr), d.maCrossFast),
    maCrossSlow: coalesce(parseNumList(f.maCrossSlowStr), d.maCrossSlow),
    maCustomBuyMa: coalesce(parseNumList(f.maCustomBuyStr), d.maCustomBuyMa),
    maCustomProfitPct: coalesce(parseNumList(f.maCustomProfitStr), d.maCustomProfitPct),
    maCustomDrawdownPct: coalesce(parseNumList(f.maCustomDdStr), d.maCustomDrawdownPct),
    rsiModes: rsiModes.length ? rsiModes : d.rsiModes,
    rsiPeriods: coalesce(parseNumList(f.rsiPeriodStr), d.rsiPeriods),
    rsiOversold: coalesce(parseNumList(f.rsiOsStr), d.rsiOversold),
    rsiOverbought: coalesce(parseNumList(f.rsiObStr), d.rsiOverbought),
    bollModes: bollModes.length ? bollModes : d.bollModes,
    bollPeriods: coalesce(parseNumList(f.bollPeriodStr), d.bollPeriods),
    bollStd: coalesce(parseNumList(f.bollStdStr), d.bollStd),
  };
}

type DataSourceMode = "bundle" | "upload";

export function RegistryPage() {
  const { definitions: etfDefinitions, getEtf, sourceLabel } = useDataSource();
  const { entries, addEntry, removeEntry } = useStrategyRegistry();
  const [searchParams] = useSearchParams();

  const barsInputRef = useRef<HTMLInputElement>(null);
  const [barsText, setBarsText] = useState<string | null>(null);
  const [barsErr, setBarsErr] = useState<string | null>(null);
  const [dataMode, setDataMode] = useState<DataSourceMode>("bundle");
  const [selectedCode, setSelectedCode] = useState<string>("");
  const [gridBusy, setGridBusy] = useState(false);
  const [gridErr, setGridErr] = useState<string | null>(null);
  const [gridResult, setGridResult] = useState<GridSearchOutcome | null>(null);
  const [searchForm, setSearchForm] = useState<SearchForm>(() => formFromDefaults());
  const [toast, setToast] = useState<string | null>(null);
  const [topN, setTopN] = useState<number>(2);
  /** 训练集占全样本比例 %（5–95，默认 70 ≈ 7:3） */
  const [trainRatioPct, setTrainRatioPct] = useState(70);
  const skipTopNEffectRef = useRef(true);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const barCodes = useMemo(() => {
    if (!barsText) return [] as string[];
    try {
      return Array.from(parseBarsCsv(barsText).keys()).sort();
    } catch {
      return [];
    }
  }, [barsText]);

  const bundleCodes = useMemo(() => etfDefinitions.map((d) => d.meta.code).sort(), [etfDefinitions]);

  const selectableCodes = useMemo(
    () => (dataMode === "bundle" ? bundleCodes : barCodes),
    [dataMode, bundleCodes, barCodes]
  );

  const barsForCode = useMemo(() => {
    if (!barsText || !selectedCode) return null;
    try {
      const m = parseBarsCsv(barsText);
      return m.get(selectedCode) ?? null;
    } catch {
      return null;
    }
  }, [barsText, selectedCode]);

  const barsForRun = useMemo(() => {
    if (dataMode === "bundle") {
      const etf = getEtf(selectedCode);
      return etf?.bars?.length ? etf.bars : null;
    }
    return barsForCode;
  }, [dataMode, getEtf, selectedCode, barsForCode]);

  const selectedDef = useMemo(() => (selectedCode ? getEtf(selectedCode) : undefined), [getEtf, selectedCode]);

  const boardVerifySummary = useMemo(() => {
    if (dataMode !== "bundle" || !selectedDef || !barsForRun || barsForRun.length < 2) return null;
    return backtestSummaryForParams(
      barsForRun,
      selectedDef.params,
      selectedDef.meta.strategy_id,
      selectedDef.meta.param_version
    );
  }, [dataMode, selectedDef, barsForRun]);

  const selectedInBundle = useMemo(
    () => Boolean(selectedCode && etfDefinitions.some((d) => d.meta.code === selectedCode)),
    [etfDefinitions, selectedCode]
  );

  const uploadOnlyRegistered = useMemo(() => {
    if (dataMode !== "upload" || !selectedCode || selectedInBundle) return [] as typeof entries;
    return entries.filter((e) => e.etfCode === selectedCode);
  }, [dataMode, selectedCode, selectedInBundle, entries]);

  useEffect(() => {
    if (!selectableCodes.length) {
      setSelectedCode("");
      return;
    }
    const fromUrl = searchParams.get("etf")?.trim();
    if (fromUrl && selectableCodes.includes(fromUrl)) {
      setSelectedCode(fromUrl);
      setDataMode("bundle");
      return;
    }
    setSelectedCode((c) => (c && selectableCodes.includes(c) ? c : selectableCodes[0]!));
  }, [selectableCodes.join("|"), searchParams]);

  const runBacktest = useCallback(() => {
    setGridErr(null);
    if (!barsForRun || barsForRun.length < 40) {
      setGridResult(null);
      setGridErr(
        dataMode === "bundle"
          ? "当前标的 K 线不足 40 根或未加载。请在首页确认数据源已包含 bars，并选择有数据的标的。"
          : "请先上传 bars.csv 并选择标的；K 线需不少于 40 根。"
      );
      return;
    }
    setGridBusy(true);
    try {
      const snap = snapshotFromForm(searchForm);
      const tr = Math.min(95, Math.max(5, trainRatioPct)) / 100;
      setGridResult(gridSearchTopParams(barsForRun, topN, snap, { trainRatio: tr }));
    } catch (e) {
      setGridErr(e instanceof Error ? e.message : String(e));
      setGridResult(null);
    } finally {
      setGridBusy(false);
    }
  }, [barsForRun, searchForm, dataMode, topN, trainRatioPct]);

  const runBacktestRef = useRef(runBacktest);
  runBacktestRef.current = runBacktest;

  useEffect(() => {
    if (skipTopNEffectRef.current) {
      skipTopNEffectRef.current = false;
      return;
    }
    void runBacktestRef.current();
  }, [topN]);

  const onBarsFile = useCallback(async (files: FileList | null) => {
    setBarsErr(null);
    setGridResult(null);
    setGridErr(null);
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

  const onRemoveVariant = (v: ParamStrategyVariant) => {
    const id = registeredIdFromVariantKey(v.key);
    if (id) removeEntry(id);
  };

  const registerRow = (row: ScoredParamRow) => {
    if (!selectedCode) return;
    const dup = entries.some(
      (e) =>
        e.etfCode === selectedCode && e.strategyId === row.strategyId && e.paramVersion === row.paramVersion
    );
    if (dup) {
      setToast("该组合已在观测列表中（含本页已注册项）。");
      return;
    }
    const kind: RegisteredStrategyKind = row.family;
    addEntry({
      etfCode: selectedCode,
      label: row.label,
      strategyType: kind,
      strategyId: row.strategyId,
      paramVersion: row.paramVersion,
      params: row.params,
    });
    setToast("已加入观测列表。在单标的页「策略参数」下拉里会出现「观测注册」项，可随时删除。");
  };

  return (
    <div className="space-y-8">
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-emerald-200 bg-emerald-50 px-5 py-2.5 text-sm text-emerald-900 shadow-lg"
          role="status"
        >
          {toast}
        </div>
      )}

      <header>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">策略回测与注册</h2>
        <p className="mt-2 text-sm text-zinc-500 max-w-3xl leading-relaxed">
          默认使用<strong>当前数据源</strong>中的日 K，与单标的页回测、交易明细使用同一套行情与参数解析。可将网格优选方案加入<strong>观测列表</strong>；加入后在看板「策略参数」中与表格里的各套方案并列，仅自己加入的条目可删除，数据源自带的默认方案不可删除。
        </p>
      </header>

      <details className="rounded-lg border border-indigo-100 bg-gradient-to-b from-indigo-50/30 to-white p-4 shadow-sm open:ring-1 open:ring-indigo-100">
        <summary className="cursor-pointer list-none font-semibold text-zinc-900 [&::-webkit-details-marker]:hidden flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            <span className="mr-1.5 text-zinc-400">▸</span>
            当前观测 <span className="font-normal text-zinc-500">（与看板下拉一致，默认折叠）</span>
          </span>
          <span className="text-xs font-normal text-zinc-400">{sourceLabel}</span>
        </summary>
        <p className="mt-2 text-xs text-zinc-500">灰标=数据源默认；蓝标=观测注册可删。</p>

        {etfDefinitions.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">暂无标的定义。</p>
        ) : (
          <div className="mt-4 space-y-4">
            {etfDefinitions.map((etf) => {
              const vars = getParamVariants(etf, entries);
              return (
                <div key={etf.meta.code} className="rounded-lg border border-zinc-100 bg-white/90 p-3 shadow-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-100 pb-2">
                    <div>
                      <p className="font-mono text-[10px] text-indigo-600">{etf.meta.code}</p>
                      <p className="text-sm font-semibold text-zinc-900">{etf.meta.name}</p>
                    </div>
                    <Link to={`/etf/${etf.meta.code}`} className="shrink-0 text-xs font-medium text-indigo-600 hover:underline">
                      看板
                    </Link>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {vars.map((v) => (
                      <ObservationRow key={v.key} etfCode={etf.meta.code} variant={v} onRemoveRegistered={onRemoveVariant} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}

        {uploadOnlyRegistered.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
            <h4 className="text-xs font-semibold text-amber-950">仅上传 CSV 出现的标的（未在数据源定义中）</h4>
            <ul className="mt-2 space-y-1.5">
              {uploadOnlyRegistered.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-100 bg-white px-2 py-1.5 text-xs"
                >
                  <div>
                    <span className="font-mono text-indigo-600">{r.etfCode}</span>
                    <span className="mx-1.5 text-zinc-300">|</span>
                    <span className="font-medium text-zinc-900">{r.label}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeEntry(r.id)}
                    className="rounded-full border border-red-200 px-2 py-0.5 text-[10px] text-red-700 hover:bg-red-50"
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>

      <details className="group rounded-lg border border-zinc-100 bg-zinc-50/40 p-5 text-sm text-zinc-600">
        <summary className="cursor-pointer list-none font-medium text-zinc-800 [&::-webkit-details-marker]:hidden">
          <span className="mr-2 text-zinc-400 group-open:rotate-90 inline-block transition">▸</span>
          查看数据源中的标的与参数版本摘要
        </summary>
        <ul className="mt-4 max-h-40 space-y-2 overflow-y-auto text-xs">
          {etfDefinitions.map((e) => (
            <li key={e.meta.code} className="rounded-lg border border-zinc-100 bg-white px-3 py-2">
              <span className="font-mono text-indigo-600">{e.meta.code}</span>
              <span className="text-zinc-400"> · </span>
              <span>{e.meta.name}</span>
              <span className="text-zinc-500"> · 默认版本 {e.meta.param_version}</span>
            </li>
          ))}
        </ul>
      </details>

      <section className="rounded-lg border border-zinc-200/80 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 pb-5">
          <div>
            <h3 className="text-base font-semibold text-zinc-900">回测数据与参数搜索</h3>
            <p className="mt-1 max-w-2xl text-xs text-zinc-500">
              先选行情来源与标的；参数范围为网格枚举用，默认折叠在下方卡片中。执行回测后请在下一大块「回测结果」中查看结论。
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm has-[:checked]:border-indigo-400 has-[:checked]:bg-indigo-50 has-[:checked]:text-indigo-900">
            <input
              type="radio"
              name="reg-ds"
              checked={dataMode === "bundle"}
              onChange={() => {
                setDataMode("bundle");
                setGridResult(null);
                setGridErr(null);
              }}
            />
            当前数据源 K 线（与看板一致）
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm has-[:checked]:border-indigo-400 has-[:checked]:bg-indigo-50 has-[:checked]:text-indigo-900">
            <input
              type="radio"
              name="reg-ds"
              checked={dataMode === "upload"}
              onChange={() => {
                setDataMode("upload");
                setGridResult(null);
                setGridErr(null);
              }}
            />
            本页上传 bars.csv
          </label>
        </div>

        {dataMode === "upload" && (
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
              className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-800 hover:bg-zinc-50"
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
                  setGridErr(null);
                }}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                清除上传
              </button>
            )}
            {barsErr && <p className="w-full text-sm text-red-700">{barsErr}</p>}
          </div>
        )}

        {selectableCodes.length > 0 ? (
          <div className="mt-5">
            <label className="text-xs font-medium text-zinc-600">回测标的</label>
            <select
              value={selectedCode}
              onChange={(e) => {
                setSelectedCode(e.target.value);
                setGridResult(null);
                setGridErr(null);
              }}
              className="mt-1 block max-w-md rounded-xl border border-zinc-200 px-3 py-2.5 font-mono text-sm"
            >
              {selectableCodes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {barsForRun && (
              <p className="mt-2 text-xs text-zinc-500">
                共 {barsForRun.length} 根日 K（回测至少需 40 根）
                {dataMode === "bundle" && selectedDef && (
                  <span className="text-zinc-400"> · 看板默认类型：{strategyKindLabel(selectedDef.meta.strategy_id)}</span>
                )}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-5 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {dataMode === "bundle"
              ? "当前数据源没有可回测标的，请先确认 public/data 已加载。"
              : "请先上传包含 etf_code/date/open/high/low/close 的 bars.csv。"}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-zinc-200 bg-zinc-50/70 px-4 py-3 text-sm">
          <span className="font-semibold text-zinc-900">训练 / 验证切分（时间序）</span>
          <label className="inline-flex items-center gap-2 text-xs text-zinc-700">
            训练集占比
            <select
              value={trainRatioPct}
              onChange={(e) => setTrainRatioPct(Number(e.target.value))}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 font-mono text-sm"
            >
              {TRAIN_RATIO_PCT_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}%
                </option>
              ))}
            </select>
          </label>
          <span className="text-[11px] text-zinc-500">按 10% 步进；变更后请点击「执行回测」</span>
        </div>

        <div className="mt-8 space-y-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">参数搜索范围（网格枚举）</p>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-5">
              <h4 className="text-sm font-semibold text-zinc-900">RSI</h4>
              <p className="mt-1 text-xs text-zinc-500">超卖上穿买、超买下穿卖；可勾选日/周线。</p>
              <div className="mt-3 flex flex-wrap gap-4 text-sm text-zinc-700">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={searchForm.rsiD} onChange={(e) => setSearchForm((s) => ({ ...s, rsiD: e.target.checked }))} />
                  日线
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={searchForm.rsiW} onChange={(e) => setSearchForm((s) => ({ ...s, rsiW: e.target.checked }))} />
                  周线
                </label>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="text-xs text-zinc-600">
                  周期
                  <input
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 font-mono text-sm"
                    value={searchForm.rsiPeriodStr}
                    onChange={(e) => setSearchForm((s) => ({ ...s, rsiPeriodStr: e.target.value }))}
                    placeholder="6,12,24"
                  />
                </label>
                <label className="text-xs text-zinc-600">
                  超卖阈值
                  <input
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 font-mono text-sm"
                    value={searchForm.rsiOsStr}
                    onChange={(e) => setSearchForm((s) => ({ ...s, rsiOsStr: e.target.value }))}
                  />
                </label>
                <label className="text-xs text-zinc-600">
                  超买阈值
                  <input
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 font-mono text-sm"
                    value={searchForm.rsiObStr}
                    onChange={(e) => setSearchForm((s) => ({ ...s, rsiObStr: e.target.value }))}
                  />
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-5">
              <h4 className="text-sm font-semibold text-zinc-900">布林带</h4>
              <p className="mt-1 text-xs text-zinc-500">下轨外回归买入、上轨外回归卖出；可勾选日/周线。</p>
              <div className="mt-3 flex flex-wrap gap-4 text-sm text-zinc-700">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={searchForm.bollD} onChange={(e) => setSearchForm((s) => ({ ...s, bollD: e.target.checked }))} />
                  日线
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={searchForm.bollW} onChange={(e) => setSearchForm((s) => ({ ...s, bollW: e.target.checked }))} />
                  周线
                </label>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-zinc-600">
                  窗口长度
                  <input
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 font-mono text-sm"
                    value={searchForm.bollPeriodStr}
                    onChange={(e) => setSearchForm((s) => ({ ...s, bollPeriodStr: e.target.value }))}
                  />
                </label>
                <label className="text-xs text-zinc-600">
                  标准差倍数
                  <input
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 font-mono text-sm"
                    value={searchForm.bollStdStr}
                    onChange={(e) => setSearchForm((s) => ({ ...s, bollStdStr: e.target.value }))}
                  />
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-5 lg:col-span-2">
              <h4 className="text-sm font-semibold text-zinc-900">MA</h4>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-zinc-100 bg-white/80 p-4">
                  <p className="text-xs font-medium text-zinc-800">金叉</p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">短均线上穿长均线买，反之为卖。</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className="text-xs text-zinc-600">
                      快线
                      <input
                        className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 font-mono text-sm"
                        value={searchForm.maCrossFastStr}
                        onChange={(e) => setSearchForm((s) => ({ ...s, maCrossFastStr: e.target.value }))}
                        placeholder="5,10,20"
                      />
                    </label>
                    <label className="text-xs text-zinc-600">
                      慢线
                      <input
                        className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 font-mono text-sm"
                        value={searchForm.maCrossSlowStr}
                        onChange={(e) => setSearchForm((s) => ({ ...s, maCrossSlowStr: e.target.value }))}
                        placeholder="60,120"
                      />
                    </label>
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-100 bg-white/80 p-4">
                  <p className="text-xs font-medium text-zinc-800">自定义</p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">上穿均线买；卖=止盈或回撤（先到先卖）。</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <label className="text-xs text-zinc-600">
                      买入均线
                      <input
                        className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 font-mono text-sm"
                        value={searchForm.maCustomBuyStr}
                        onChange={(e) => setSearchForm((s) => ({ ...s, maCustomBuyStr: e.target.value }))}
                      />
                    </label>
                    <label className="text-xs text-zinc-600">
                      止盈 %
                      <input
                        className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 font-mono text-sm"
                        value={searchForm.maCustomProfitStr}
                        onChange={(e) => setSearchForm((s) => ({ ...s, maCustomProfitStr: e.target.value }))}
                      />
                    </label>
                    <label className="text-xs text-zinc-600">
                      回撤 %
                      <input
                        className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 font-mono text-sm"
                        value={searchForm.maCustomDdStr}
                        onChange={(e) => setSearchForm((s) => ({ ...s, maCustomDdStr: e.target.value }))}
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setSearchForm(formFromDefaults())}
            className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            恢复默认搜索范围
          </button>
          <button
            type="button"
            disabled={!barsForRun || barsForRun.length < 40 || gridBusy}
            onClick={() => void runBacktest()}
            className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {gridBusy ? "回测计算中…" : "执行回测"}
          </button>
        </div>
        </div>

        {gridErr && <p className="mt-4 text-sm text-red-700">{gridErr}</p>}
      </section>

      <section className="rounded-lg border-2 border-indigo-200 bg-white p-6 shadow-md ring-1 ring-indigo-100">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold tracking-tight text-zinc-900">
              回测结果
              {selectedCode ? (
                <>
                  {" · "}
                  <span className="font-mono text-lg font-semibold text-indigo-700">{selectedCode}</span>
                  {selectedDef?.meta.name ? (
                    <span className="text-lg font-normal text-zinc-700"> · {selectedDef.meta.name}</span>
                  ) : null}
                </>
              ) : null}
            </h3>
            <p className="mt-1 text-sm text-zinc-500">与单标的页摘要同源：按成交重建权益曲线后统计收益、回撤、买卖笔数与持仓节奏。</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <span className="text-xs text-zinc-500">每类展示</span>
            <select
              value={topN}
              onChange={(e) => {
                const n = Number(e.target.value);
                setTopN(n);
              }}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm font-medium"
            >
              {TOP_N_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  Top {n}
                </option>
              ))}
            </select>
            <span className="text-xs text-zinc-400">变更后自动按当前范围重算（需已加载足够 K 线）</span>
          </label>
        </div>

        {!gridResult && boardVerifySummary && selectedDef && (
          <p className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2 text-[11px] text-zinc-800">
            看板默认参数（CSV）：策略 {boardVerifySummary.strategyReturnPct}% · 超额 {boardVerifySummary.excessReturnPct}% · 回撤{" "}
            {boardVerifySummary.maxDrawdownPct}% · 胜率 {(boardVerifySummary.winRate * 100).toFixed(1)}% · 轮次{" "}
            {boardVerifySummary.roundCount}。执行网格回测后，将展示<strong>☆ 验证集最优</strong>与<strong>★ 全样本最优</strong>摘要。
          </p>
        )}

        {gridResult && (
          <>
            <div className="mt-6 rounded-lg border border-indigo-100 bg-indigo-50/80 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800">基础统计 · 买入持有</p>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="text-zinc-500">区间</span>
                  <p className="font-mono font-medium text-zinc-900">
                    {gridResult.meta.startDate} → {gridResult.meta.endDate}
                  </p>
                </div>
                <div>
                  <span className="text-zinc-500">样本</span>
                  <p className="font-medium text-zinc-900">{gridResult.meta.barCount} 根日 K</p>
                </div>
                <div>
                  <span className="text-zinc-500">累计收益</span>
                  <p className="font-semibold text-indigo-700">{gridResult.meta.buyHoldReturnPct}%</p>
                </div>
                <div>
                  <span className="text-zinc-500">年化收益</span>
                  <p className="font-semibold text-indigo-700">{gridResult.meta.buyHoldAnnualPct}%</p>
                </div>
                <div>
                  <span className="text-zinc-500">最大回撤</span>
                  <p className="font-semibold text-zinc-900">{gridResult.meta.buyHoldMaxDrawdownPct}%</p>
                </div>
              </div>
            </div>

            <p className="mt-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[11px] font-mono text-zinc-800">
              <span className="font-sans font-semibold text-zinc-900">训练 / 验证窗口 · </span>
              训练 {gridResult.split.trainStartDate}→{gridResult.split.trainEndDate}（{gridResult.split.trainBarCount} 日，{(gridResult.split.trainRatio * 100).toFixed(0)}%）
              · 验证 {gridResult.split.valStartDate}→{gridResult.split.valEndDate}（{gridResult.split.valBarCount} 日）
            </p>

            {(() => {
              const hints = noBeatBuyHoldHints(gridResult);
              return hints ? (
                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50/90 px-3 py-2 text-[11px] text-rose-950">
                  <p className="font-semibold">未跑赢买入持有</p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    {hints.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </div>
              ) : null;
            })()}

            {gridResult.split.credibility !== "ok" && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-[11px] text-amber-950">
                <p className="font-semibold">回测可信度提示</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {gridResult.split.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            )}

            {(gridResult.globalRobustBest || gridResult.globalFullBest) && (
              <div className="mt-3 space-y-2">
                {gridResult.globalRobustBest && (
                  <p className="rounded-lg border border-sky-200 bg-sky-50/85 px-3 py-2 text-[11px] text-sky-950">
                    <span className="font-semibold">☆ 验证集最优</span> — {gridResult.globalRobustBest.label} · 验证超额{" "}
                    {gridResult.globalRobustBest.excessValPct != null
                      ? `${gridResult.globalRobustBest.excessValPct > 0 ? "+" : ""}${gridResult.globalRobustBest.excessValPct}%`
                      : "—"}{" "}
                    · 全样本超额 {gridResult.globalRobustBest.excessReturnPct > 0 ? "+" : ""}
                    {gridResult.globalRobustBest.excessReturnPct}%
                  </p>
                )}
                {gridResult.globalFullBest && (
                  <p className="rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-950">
                    <span className="font-semibold">★ 全样本最优</span> — {gridResult.globalFullBest.label} · 策略 {gridResult.globalFullBest.cumReturnPct}% · 超额{" "}
                    {gridResult.globalFullBest.excessReturnPct > 0 ? "+" : ""}
                    {gridResult.globalFullBest.excessReturnPct}% · 回撤 {gridResult.globalFullBest.maxDrawdownPct}% · 胜率{" "}
                    {(gridResult.globalFullBest.winRate * 100).toFixed(1)}% · {gridResult.globalFullBest.roundCount} 轮
                  </p>
                )}
              </div>
            )}
            {gridResult && !gridResult.globalRobustBest && !gridResult.globalFullBest && boardVerifySummary && selectedDef && (
              <p className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2 text-[11px] text-zinc-800">
                看板默认参数（CSV）：策略 {boardVerifySummary.strategyReturnPct}% · 超额 {boardVerifySummary.excessReturnPct}% · 回撤{" "}
                {boardVerifySummary.maxDrawdownPct}% · 胜率 {(boardVerifySummary.winRate * 100).toFixed(1)}% · 轮次{" "}
                {boardVerifySummary.roundCount}。产生有效候选后，此处展示<strong>☆ 验证集最优</strong>与<strong>★ 全样本最优</strong>摘要。
              </p>
            )}

            <div className="mt-4 space-y-8">
              <ResultTable
                title={`RSI Top ${topN}`}
                rows={gridResult.rsi}
                onRegister={registerRow}
                globalRobustBest={gridResult.globalRobustBest}
                globalFullBest={gridResult.globalFullBest}
              />
              <ResultTable
                title={`布林带 Top ${topN}`}
                rows={gridResult.boll}
                onRegister={registerRow}
                globalRobustBest={gridResult.globalRobustBest}
                globalFullBest={gridResult.globalFullBest}
              />
              <ResultTable
                title={`MA 金叉 Top ${topN}`}
                rows={gridResult.maCross}
                onRegister={registerRow}
                globalRobustBest={gridResult.globalRobustBest}
                globalFullBest={gridResult.globalFullBest}
              />
              <ResultTable
                title={`MA 自定义 Top ${topN}`}
                rows={gridResult.maCustom}
                onRegister={registerRow}
                globalRobustBest={gridResult.globalRobustBest}
                globalFullBest={gridResult.globalFullBest}
              />
            </div>
          </>
        )}

        {!gridResult && !gridBusy && (
          <p className="mt-8 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50 px-4 py-8 text-center text-sm text-zinc-500">
            选择行情与参数范围后，在上节点击「执行回测」。修改 Top N 后会自动按新条数重算；修改训练占比或参数范围后需再次点击「执行回测」。
          </p>
        )}
      </section>
    </div>
  );
}

function ObservationRow({
  etfCode,
  variant,
  onRemoveRegistered,
}: {
  etfCode: string;
  variant: ParamStrategyVariant;
  onRemoveRegistered: (v: ParamStrategyVariant) => void;
}) {
  const registered = isUserRegisteredVariantKey(variant.key);
  const kind = strategyKindLabel(variant.strategyId);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-100 bg-zinc-50/40 px-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              registered ? "bg-indigo-100 text-indigo-800" : "bg-zinc-200 text-zinc-600"
            }`}
          >
            {registered ? "观测注册" : "数据源默认"}
          </span>
          <span className="font-medium text-zinc-900">{variant.label}</span>
        </div>
        <p className="mt-0.5 text-xs text-zinc-500">策略类型：{kind}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link to={`/etf/${etfCode}`} className="text-xs font-medium text-indigo-600 hover:underline">
          看板
        </Link>
        {registered ? (
          <button
            type="button"
            onClick={() => onRemoveRegistered(variant)}
            className="rounded-full border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50"
          >
            删除
          </button>
        ) : (
          <span className="text-[10px] text-zinc-400">内置</span>
        )}
      </div>
    </li>
  );
}

function ResultTable({
  title,
  rows,
  onRegister,
  globalRobustBest,
  globalFullBest,
}: {
  title: string;
  rows: ScoredParamRow[];
  onRegister: (r: ScoredParamRow) => void;
  globalRobustBest: ScoredParamRow | null;
  globalFullBest: ScoredParamRow | null;
}) {
  if (!rows.length) return null;
  const fmtEx = (x: number | null) =>
    x == null ? "—" : `${x > 0 ? "+" : ""}${x}%`;
  return (
    <div>
      <h4 className="text-sm font-semibold text-zinc-900">{title}</h4>
      <p className="mt-1 text-[10px] text-zinc-500">
        主表为全样本口径；☆ 验证集最优 · ★ 全样本最优（可与同一行）。
      </p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-100">
        <table className="min-w-[1120px] w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2">组合说明</th>
              <th className="px-3 py-2">策略收益 %</th>
              <th className="px-3 py-2">最大回撤 %</th>
              <th className="px-3 py-2">全样本超额 %</th>
              <th className="px-3 py-2">训练超额 %</th>
              <th className="px-3 py-2">验证超额 %</th>
              <th className="px-3 py-2">胜率</th>
              <th className="px-3 py-2">买卖次数</th>
              <th className="px-3 py-2">均持仓天</th>
              <th className="px-3 py-2">均空仓天</th>
              <th className="px-3 py-2">收益/回撤</th>
              <th className="px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((r, i) => {
              const isRobust = globalRobustBest != null && sameScoredParamRow(r, globalRobustBest);
              const isFull = globalFullBest != null && sameScoredParamRow(r, globalFullBest);
              return (
              <tr
                key={`${r.paramVersion}-${i}-${r.label}`}
                className={
                  isFull && isRobust
                    ? "bg-amber-50/90 ring-2 ring-inset ring-amber-400/90"
                    : isFull
                      ? "bg-amber-50/90 ring-2 ring-inset ring-amber-400/90"
                      : isRobust
                        ? "bg-sky-50/85 ring-2 ring-inset ring-sky-300/85"
                        : undefined
                }
              >
                <td className="px-3 py-2 text-zinc-800">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {isRobust ? (
                      <span className="text-sky-600" title="验证集最优">
                        ☆
                      </span>
                    ) : null}
                    {isFull ? (
                      <span className="text-amber-500" title="全样本最优">
                        ★
                      </span>
                    ) : null}
                    <span className="font-medium">{r.label}</span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-zinc-400">{strategyKindLabel(r.strategyId)}</p>
                </td>
                <td className="px-3 py-2 font-mono">{r.cumReturnPct}%</td>
                <td className="px-3 py-2 font-mono">{r.maxDrawdownPct}%</td>
                <td className="px-3 py-2 font-mono text-indigo-700">
                  {r.excessReturnPct > 0 ? "+" : ""}
                  {r.excessReturnPct}%
                </td>
                <td className="px-3 py-2 font-mono text-zinc-700">{fmtEx(r.excessTrainPct)}</td>
                <td className="px-3 py-2 font-mono text-sky-900">{fmtEx(r.excessValPct)}</td>
                <td className="px-3 py-2 font-mono">{(r.winRate * 100).toFixed(1)}%</td>
                <td className="px-3 py-2 text-xs text-zinc-700">
                  {r.rawBuyCount} 买 / {r.rawSellCount} 卖
                  <span className="block text-zinc-400">完成 {r.roundCount} 轮</span>
                </td>
                <td className="px-3 py-2 font-mono">{r.avgHoldDays}</td>
                <td className="px-3 py-2 font-mono">{r.avgFlatDays}</td>
                <td className="px-3 py-2 font-mono text-zinc-600">{r.score}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onRegister(r)}
                    className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800"
                  >
                    加入观测
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
