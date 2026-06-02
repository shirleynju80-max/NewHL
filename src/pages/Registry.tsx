import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import {
  defaultCustomBaselineForm,
  kindFromStrategyId,
  MAX_CUSTOM_BASELINES,
  RegistryCustomBaseline,
  type CommittedCustomBaseline,
  type CustomBaselineFormValues,
  type CustomBaselineKind,
} from "../components/RegistryCustomBaseline";
import { customBaselineLabel } from "../components/registryCustomBaselineUtils";
import { useDataSource } from "../context/DataSourceContext";
import { useStrategyRegistry } from "../context/StrategyRegistryContext";
import { parseBarsCsv } from "../data/csvLoader";
import {
  backtestSummaryForParams,
  buildCustomBaselineDraft,
  DEFAULT_PARAM_SEARCH,
  gridSearchTopParams,
  scoreCustomParamBaseline,
  type GridSearchOutcome,
  type ParamSearchSnapshot,
  type ScoredParamRow,
  type StrategyFamily,
  type TopPickedRow,
} from "../lib/paramBacktest";
import {
  buildProductSearchHaystack,
  matchesProductSearch,
  primaryEtfCodesWithBars,
} from "../lib/etfProducts";
import {
  etfBacktestEligible,
  etfBacktestIneligibleReason,
  ETF_REGISTRY_MIN_BACKTEST_YEARS,
} from "../lib/etfListingAge";
import {
  formatAvgFlatDaysDisplay,
  formatAvgHoldDaysDisplay,
  HOLD_FLAT_AVG_TOO_FEW_ROUNDS_NOTE,
} from "../lib/backtestSummary";
import { formatPct, formatSignedPct } from "../lib/formatDisplay";
import { getProductParamVariants } from "../lib/paramVariants";
import {
  isUserRegisteredVariantKey,
  registeredIdFromVariantKey,
  strategyKindLabel,
  variantMonitorCompact,
} from "../lib/strategyLabels";
import type { ParamStrategyVariant, RegisteredStrategyKind } from "../types";

const TOP_N_OPTIONS = [2, 3, 5, 8, 10] as const;
/** 训练集占比可选值（10% 步进，避免细粒度拖动触发重复全量网格） */
const TRAIN_RATIO_PCT_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90] as const;

function RegistryResultSummary({
  gridResult,
}: {
  gridResult: GridSearchOutcome;
}) {
  const hints = noBeatBuyHoldHints(gridResult);
  return (
    <div className="fin-panel mt-4 space-y-3 border border-fin-border p-4 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fin-muted)]">
        回测摘要
      </p>
      <p className="text-xs fin-muted-text">
        买入持有 {formatPct(gridResult.meta.buyHoldReturnPct)}（年化{" "}
        {formatPct(gridResult.meta.buyHoldAnnualPct)}）· 样本{" "}
        {gridResult.meta.barCount} 日
      </p>
      {gridResult.globalRobustBest && (
        <p className="text-xs fin-muted-text">
          <span className="fin-best-badge-robust">后段最优</span> —{" "}
          {gridResult.globalRobustBest.label} · 后段超额{" "}
          {gridResult.globalRobustBest.excessValPct != null
            ? formatSignedPct(gridResult.globalRobustBest.excessValPct)
            : "—"}
        </p>
      )}
      {gridResult.globalFullBest && (
        <p className="text-xs text-[var(--fin-amber)]">
          <span className="fin-best-badge-full">全样本最优</span> —{" "}
          {gridResult.globalFullBest.label} · 超额{" "}
          {formatSignedPct(gridResult.globalFullBest.excessReturnPct)}
        </p>
      )}
      {hints && (
        <p className="text-xs text-[var(--fin-down)]">
          {hints[0]}
          {hints.length > 1
            ? `（另有 ${hints.length - 1} 条说明，见详细结果）`
            : null}
        </p>
      )}
    </div>
  );
}

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
  const rows = [
    ...result.rsi,
    ...result.boll,
    ...result.maCross,
    ...result.maCustom,
  ];
  if (!rows.length) return ["未找到有效买卖轮次，可放宽参数范围或延长样本"];
  const bestFullExcess =
    result.globalFullBest?.excessReturnPct ??
    Math.max(...rows.map((r) => r.excessReturnPct));
  if (bestFullExcess > 0) return null;

  const hints: string[] = ["当前优选组合在全样本上均未跑赢买入持有"];
  const {
    barCount,
    buyHoldReturnPct,
    buyHoldAnnualPct,
    buyHoldMaxDrawdownPct,
  } = result.meta;
  const { valBarCount, trainBarCount } = result.split;

  if (barCount < 252)
    hints.push(`样本约 ${barCount} 日，窗口偏短，择时优势难稳定体现`);
  else if (barCount < 504)
    hints.push("样本不足两年，长周期策略相对买入持有的优势不易显现");
  if (buyHoldReturnPct > 30 && buyHoldMaxDrawdownPct > -25) {
    hints.push("区间收益高且回撤可控，偏慢牛/趋势市，持有往往优于频繁交易");
  }
  if (buyHoldAnnualPct > 12 && buyHoldMaxDrawdownPct > -20) {
    hints.push("年化较强、回撤不深，均值回归类信号易被趋势碾压");
  }
  if (valBarCount < 60) hints.push("后段不足约 60 日，分段排序参考价值有限");
  if (trainBarCount < 60) hints.push("前段样本过短，易过拟合短窗噪声");
  if (rows.every((r) => r.roundCount < 3))
    hints.push("换手轮次过少，信号稀疏或参数过严");

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
  const rsiModes = ([] as ("1d" | "1w")[]).concat(
    f.rsiD ? (["1d"] as const) : [],
    f.rsiW ? (["1w"] as const) : [],
  );
  const bollModes = ([] as ("1d" | "1w")[]).concat(
    f.bollD ? (["1d"] as const) : [],
    f.bollW ? (["1w"] as const) : [],
  );
  return {
    maCrossFast: coalesce(parseNumList(f.maCrossFastStr), d.maCrossFast),
    maCrossSlow: coalesce(parseNumList(f.maCrossSlowStr), d.maCrossSlow),
    maCustomBuyMa: coalesce(parseNumList(f.maCustomBuyStr), d.maCustomBuyMa),
    maCustomProfitPct: coalesce(
      parseNumList(f.maCustomProfitStr),
      d.maCustomProfitPct,
    ),
    maCustomDrawdownPct: coalesce(
      parseNumList(f.maCustomDdStr),
      d.maCustomDrawdownPct,
    ),
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
  const {
    definitions: etfDefinitions,
    getEtf,
    etfProducts,
    publicCsvAutoLoading,
    reloadingPublicCsv,
  } = useDataSource();
  const { entries, addEntry, removeEntry } = useStrategyRegistry();
  const [searchParams, setSearchParams] = useSearchParams();
  const prevUrlEtfRef = useRef<string | undefined>(undefined);

  const barsInputRef = useRef<HTMLInputElement>(null);
  const [barsText, setBarsText] = useState<string | null>(null);
  const [barsErr, setBarsErr] = useState<string | null>(null);
  const [dataMode, setDataMode] = useState<DataSourceMode>("bundle");
  const [selectedCode, setSelectedCode] = useState<string>("");
  const [gridBusy, setGridBusy] = useState(false);
  const [gridErr, setGridErr] = useState<string | null>(null);
  const [gridResult, setGridResult] = useState<GridSearchOutcome | null>(null);
  const [searchForm, setSearchForm] = useState<SearchForm>(() =>
    formFromDefaults(),
  );
  const [toast, setToast] = useState<string | null>(null);
  const [topN, setTopN] = useState<number>(2);
  /** 训练集占全样本比例 %（5–95，默认 70 ≈ 7:3） */
  const [trainRatioPct, setTrainRatioPct] = useState(70);
  const [productQuery, setProductQuery] = useState("");
  const [baselineKind, setBaselineKind] = useState<CustomBaselineKind>("ma");
  const [baselineFormByKind, setBaselineFormByKind] = useState<
    Record<CustomBaselineKind, CustomBaselineFormValues>
  >(() => ({
    ma: defaultCustomBaselineForm(),
    rsi: defaultCustomBaselineForm(),
    boll: defaultCustomBaselineForm(),
  }));
  const [baselineSlotsByKind, setBaselineSlotsByKind] = useState<
    Record<
      CustomBaselineKind,
      { id: string; committed: CommittedCustomBaseline }[]
    >
  >(() => ({ ma: [], rsi: [], boll: [] }));
  const [baselineAddError, setBaselineAddError] = useState<string | null>(null);
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

  const bundleCodes = useMemo(
    () => primaryEtfCodesWithBars(etfDefinitions, etfProducts),
    [etfDefinitions, etfProducts],
  );

  const selectableCodes = useMemo(
    () => (dataMode === "bundle" ? bundleCodes : barCodes),
    [dataMode, bundleCodes, barCodes],
  );
  const bundleLoading =
    dataMode === "bundle" && (publicCsvAutoLoading || reloadingPublicCsv);

  const eligibleSelectableCodes = useMemo(() => {
    if (dataMode !== "bundle") return selectableCodes;
    return selectableCodes.filter((code) => {
      const def = getEtf(code);
      if (!def) return false;
      const product = etfProducts.find((p) => p.code === code);
      if (product?.exchange === "OTC" || product?.productGroup === "otc_fund") {
        return false;
      }
      return etfBacktestEligible(def, product, ETF_REGISTRY_MIN_BACKTEST_YEARS);
    });
  }, [dataMode, selectableCodes, getEtf, etfProducts]);

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

  const selectedDef = useMemo(
    () => (selectedCode ? getEtf(selectedCode) : undefined),
    [getEtf, selectedCode],
  );

  const selectedProduct = useMemo(
    () =>
      selectedCode
        ? etfProducts.find((p) => p.code === selectedCode)
        : undefined,
    [etfProducts, selectedCode],
  );

  const selectedIsOtcFund =
    selectedProduct?.exchange === "OTC" ||
    selectedProduct?.productGroup === "otc_fund";

  const selectedBacktestEligible = useMemo(
    () =>
      selectedDef && !selectedIsOtcFund
        ? etfBacktestEligible(
            selectedDef,
            selectedProduct,
            ETF_REGISTRY_MIN_BACKTEST_YEARS,
          )
        : false,
    [selectedDef, selectedProduct, selectedIsOtcFund],
  );

  const boardVerifySummary = useMemo(() => {
    if (
      dataMode !== "bundle" ||
      !selectedDef ||
      !selectedBacktestEligible ||
      !barsForRun ||
      barsForRun.length < 2
    ) {
      return null;
    }
    return backtestSummaryForParams(
      barsForRun,
      selectedDef.params,
      selectedDef.meta.strategy_id,
      selectedDef.meta.param_version,
    );
  }, [dataMode, selectedDef, selectedBacktestEligible, barsForRun]);

  const selectedBacktestIneligibleReason = useMemo(
    () =>
      dataMode === "bundle" && selectedDef && !selectedBacktestEligible
        ? selectedIsOtcFund
          ? "场外基金使用净值序列，不参与此处的批量回测；可在精选跟踪和产品详情中查看。"
          : etfBacktestIneligibleReason(
              selectedDef,
              selectedProduct,
              ETF_REGISTRY_MIN_BACKTEST_YEARS,
            )
        : null,
    [
      dataMode,
      selectedDef,
      selectedBacktestEligible,
      selectedProduct,
      selectedIsOtcFund,
    ],
  );

  const selectedInBundle = useMemo(
    () =>
      Boolean(
        selectedCode &&
        etfDefinitions.some((d) => d.meta.code === selectedCode),
      ),
    [etfDefinitions, selectedCode],
  );

  const uploadOnlyRegistered = useMemo(() => {
    if (dataMode !== "upload" || !selectedCode || selectedInBundle)
      return [] as typeof entries;
    return entries.filter((e) => e.etfCode === selectedCode);
  }, [dataMode, selectedCode, selectedInBundle, entries]);

  const productPickerOptions = useMemo(() => {
    return selectableCodes.map((code) => {
      const def = getEtf(code);
      const product = etfProducts.find((p) => p.code === code);
      const name =
        product?.name?.trim() ||
        (def?.meta.name && !/仅 bars|etfs 为空/.test(def.meta.name)
          ? def.meta.name
          : "") ||
        code;
      const haystack = buildProductSearchHaystack(
        code,
        product,
        def?.meta.name,
      );
      return { code, name, haystack };
    });
  }, [selectableCodes, getEtf, etfProducts]);

  const filteredProductOptions = useMemo(() => {
    const q = productQuery.trim();
    if (!q) return productPickerOptions;
    return productPickerOptions.filter((o) =>
      matchesProductSearch(o.haystack, q),
    );
  }, [productPickerOptions, productQuery]);
  const selectedProductOption = useMemo(
    () => productPickerOptions.find((o) => o.code === selectedCode),
    [productPickerOptions, selectedCode],
  );

  const selectProduct = useCallback(
    (code: string) => {
      setSelectedCode(code);
      setGridResult(null);
      setGridErr(null);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (next.get("etf") === code) return prev;
          next.set("etf", code);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  useEffect(() => {
    setBaselineSlotsByKind({ ma: [], rsi: [], boll: [] });
    setBaselineAddError(null);
    if (selectedDef) {
      setBaselineKind(kindFromStrategyId(selectedDef.meta.strategy_id));
    }
    setBaselineFormByKind({
      ma: defaultCustomBaselineForm(),
      rsi: defaultCustomBaselineForm(),
      boll: defaultCustomBaselineForm(),
    });
  }, [selectedCode, selectedDef?.meta.strategy_id]);

  const baselineSlots = baselineSlotsByKind[baselineKind] ?? [];
  const baselineForm = baselineFormByKind[baselineKind];
  const setBaselineForm = useCallback(
    (next: CustomBaselineFormValues) => {
      setBaselineFormByKind((prev) => ({ ...prev, [baselineKind]: next }));
    },
    [baselineKind],
  );

  const allBaselineCommitted = useMemo(
    () =>
      (["ma", "rsi", "boll"] as const).flatMap(
        (k) => baselineSlotsByKind[k] ?? [],
      ),
    [baselineSlotsByKind],
  );

  const baselineSlotCountTotal = allBaselineCommitted.length;

  const scoreBaselineSlot = useCallback(
    (slot: { id: string; committed: CommittedCustomBaseline }) => {
      if (!barsForRun || barsForRun.length < 40) {
        return { ...slot, row: null as ScoredParamRow | null };
      }
      const label = customBaselineLabel(
        slot.committed.strategyId,
        slot.committed.params,
        slot.committed.mode,
      );
      const row = scoreCustomParamBaseline(
        barsForRun,
        slot.committed.params,
        slot.committed.strategyId,
        label,
        { trainRatio: trainRatioPct / 100 },
        slot.committed.kind,
        slot.committed.mode,
      );
      return { ...slot, row };
    },
    [barsForRun, trainRatioPct],
  );

  const customBaselineSlotsAllKinds = useMemo(
    () => allBaselineCommitted.map(scoreBaselineSlot),
    [allBaselineCommitted, scoreBaselineSlot],
  );

  const customBaselineSlotsForKind = useMemo(
    () =>
      customBaselineSlotsAllKinds.filter(
        (s) => s.committed.kind === baselineKind,
      ),
    [customBaselineSlotsAllKinds, baselineKind],
  );

  const customBaselineRows = useMemo(
    () =>
      customBaselineSlotsAllKinds
        .map((s) => s.row)
        .filter((r): r is ScoredParamRow => r != null),
    [customBaselineSlotsAllKinds],
  );

  const addCustomBaseline = useCallback(() => {
    setBaselineAddError(null);
    if (!barsForRun || barsForRun.length < 40) {
      setBaselineAddError("历史数据过短（不足 40 个交易日），无法计算对照参数。");
      return;
    }
    if (baselineSlots.length >= MAX_CUSTOM_BASELINES) {
      setBaselineAddError(`最多添加 ${MAX_CUSTOM_BASELINES} 组自定义参数。`);
      return;
    }
    if (baselineKind === "ma" && baselineForm.maFast >= baselineForm.maSlow) {
      setBaselineAddError("MA 金叉：慢线须大于快线。");
      return;
    }
    if (
      baselineKind === "rsi" &&
      baselineForm.rsiOversold >= baselineForm.rsiOverbought
    ) {
      setBaselineAddError("RSI：超卖须小于超买。");
      return;
    }
    const draft = buildCustomBaselineDraft(baselineKind, baselineForm);
    const committed: CommittedCustomBaseline = {
      kind: baselineKind,
      ...draft,
      mode:
        baselineKind === "rsi"
          ? baselineForm.rsiMode
          : baselineKind === "boll"
            ? baselineForm.bollMode
            : undefined,
    };
    const row = scoreCustomParamBaseline(
      barsForRun,
      draft.params,
      draft.strategyId,
      customBaselineLabel(draft.strategyId, draft.params, committed.mode),
      { trainRatio: trainRatioPct / 100 },
      baselineKind,
      committed.mode,
    );
    if (!row) {
      setBaselineAddError("参数无法产生有效回测，请检查取值。");
      return;
    }
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `cb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setBaselineSlotsByKind((prev) => ({
      ...prev,
      [baselineKind]: [...(prev[baselineKind] ?? []), { id, committed }],
    }));
  }, [
    barsForRun,
    baselineKind,
    baselineForm,
    trainRatioPct,
    baselineSlots.length,
  ]);

  const removeCustomBaseline = useCallback((id: string) => {
    setBaselineSlotsByKind((prev) => {
      const next = { ...prev };
      for (const k of ["ma", "rsi", "boll"] as const) {
        next[k] = (prev[k] ?? []).filter((s) => s.id !== id);
      }
      return next;
    });
    setBaselineAddError(null);
  }, []);

  const clearCustomBaselines = useCallback(() => {
    setBaselineSlotsByKind((prev) => ({ ...prev, [baselineKind]: [] }));
    setBaselineAddError(null);
  }, [baselineKind]);

  useEffect(() => {
    if (!selectableCodes.length) {
      setSelectedCode("");
      return;
    }
    const urlEtf = searchParams.get("etf")?.trim() ?? "";
    const urlEtfChanged = prevUrlEtfRef.current !== urlEtf;
    prevUrlEtfRef.current = urlEtf;

    if (urlEtf && selectableCodes.includes(urlEtf)) {
      if (urlEtfChanged) {
        setSelectedCode(urlEtf);
        setDataMode("bundle");
      }
      return;
    }
    setSelectedCode((c) => {
      if (
        c &&
        selectableCodes.includes(c) &&
        (dataMode !== "bundle" || eligibleSelectableCodes.includes(c))
      ) {
        return c;
      }
      const next = eligibleSelectableCodes[0] ?? selectableCodes[0] ?? "";
      if (next !== c) {
        setGridResult(null);
        setGridErr(null);
      }
      return next;
    });
  }, [
    dataMode,
    selectableCodes.join("|"),
    eligibleSelectableCodes.join("|"),
    searchParams,
  ]);

  const runBacktest = useCallback(() => {
    setGridErr(null);
    if (
      dataMode === "bundle" &&
      selectedDef &&
      !etfBacktestEligible(
        selectedDef,
        selectedProduct,
        ETF_REGISTRY_MIN_BACKTEST_YEARS,
      )
    ) {
      setGridResult(null);
      setGridErr(
        etfBacktestIneligibleReason(
          selectedDef,
          selectedProduct,
          ETF_REGISTRY_MIN_BACKTEST_YEARS,
        ),
      );
      return;
    }
    if (!barsForRun || barsForRun.length < 40) {
      setGridResult(null);
      setGridErr(
        dataMode === "bundle"
          ? "当前标的历史数据不足 40 个交易日或未加载。请确认数据已加载，并选择有数据的标的。"
          : "请先上传行情 CSV 并选择标的；历史数据需不少于 40 个交易日。",
      );
      return;
    }
    setGridBusy(true);
    try {
      const snap = snapshotFromForm(searchForm);
      const tr = Math.min(95, Math.max(5, trainRatioPct)) / 100;
      setGridResult(
        gridSearchTopParams(barsForRun, topN, snap, { trainRatio: tr }),
      );
      requestAnimationFrame(() => {
        resultsSectionRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    } catch (e) {
      setGridErr(e instanceof Error ? e.message : String(e));
      setGridResult(null);
    } finally {
      setGridBusy(false);
    }
  }, [
    barsForRun,
    searchForm,
    dataMode,
    topN,
    trainRatioPct,
    selectedDef,
    selectedProduct,
  ]);

  const resultsSectionRef = useRef<HTMLDetailsElement | null>(null);
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
        e.etfCode === selectedCode &&
        e.strategyId === row.strategyId &&
        e.paramVersion === row.paramVersion,
    );
    if (dup) {
      setToast("该组合已在监控列表中（含已注册项）。");
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
    setToast(
      "已加入监控列表。在单标的页「策略参数」下拉里会出现「监控策略」项，可随时删除。",
    );
  };

  return (
    <div className="ft-page space-y-6">
      {toast && (
        <div
          className="fin-toast-success fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
          role="status"
        >
          {toast}
        </div>
      )}

      <PageHeader
        kicker="策略层"
        title="策略研究工具"
        breadcrumbs={[
          { label: "配置总览", to: "/" },
          { label: "策略研究工具" },
        ]}
      />

      <section className="fin-panel p-5">
        {bundleLoading ? (
          <p className="text-sm fin-muted-text">正在加载站点产品与行情数据…</p>
        ) : selectableCodes.length > 0 ? (
          <div className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_9rem] lg:items-end">
              <label className="block text-sm">
                <span className="fin-label">选择产品（ETF）</span>
                <input
                  type="search"
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  placeholder="输入代码或名称后筛选切换"
                  className="fin-input mt-1 block w-full px-3 py-2 text-sm"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="text-sm fin-muted-text">
                <span className="text-xs font-medium fin-muted-text">
                  样本切分
                </span>
                <select
                  value={trainRatioPct}
                  onChange={(e) => setTrainRatioPct(Number(e.target.value))}
                  className="fin-input mt-1 block w-full px-2 py-2"
                  title="前段用于拟合，后段用于验证"
                >
                  {TRAIN_RATIO_PCT_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      前 {p}% / 后 {100 - p}%
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <details
              className="rounded-md border border-fin-border"
              open={productQuery.trim() ? true : undefined}
            >
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs [&::-webkit-details-marker]:hidden">
                <span className="font-medium text-[var(--fin-text)]">
                  切换产品
                </span>
                <span className="fin-muted-text">
                  {productQuery.trim()
                    ? `匹配 ${filteredProductOptions.length} / ${productPickerOptions.length} 只`
                    : `${productPickerOptions.length} 只主跟踪产品`}
                </span>
              </summary>
              <div
                className="flex max-h-44 flex-wrap gap-2 overflow-y-auto border-t border-fin-border p-3"
                role="listbox"
                aria-label="可选产品"
              >
                {filteredProductOptions.length > 0 ? (
                  filteredProductOptions.map((o) => {
                    const active = selectedCode === o.code;
                    return (
                      <button
                        key={o.code}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => selectProduct(o.code)}
                        className={`fin-chip-filter rounded-full px-3 py-1.5 text-left text-sm ${
                          active ? "fin-chip-filter-active" : ""
                        }`}
                      >
                        <span className="font-mono font-medium">{o.code}</span>
                        {o.name !== o.code ? (
                          <span
                            className={`ml-1.5 text-[11px] ${active ? "opacity-90" : "fin-muted-text"}`}
                          >
                            {o.name}
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                ) : (
                  <p className="text-xs fin-muted-text">无匹配产品</p>
                )}
              </div>
            </details>

            {selectedCode ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-fin-border px-3 py-2 text-sm">
                <span className="fin-label">当前</span>
                <span className="font-mono font-semibold text-[var(--fin-text)]">
                  {selectedCode}
                </span>
                {selectedProductOption?.name ? (
                  <span className="fin-muted-text">
                    {selectedProductOption.name}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="fin-alert-warn--compact mt-4">
            当前没有可回测标的，请先在配置总览确认数据已加载。
          </p>
        )}

        {barsForRun && (
          <p className="mt-2 text-xs fin-muted-text">
            共 {barsForRun.length} 个交易日 · 默认参数组合（RSI / 布林 / MA）·
            样本切分 前 {trainRatioPct}% / 后 {100 - trainRatioPct}%
            {dataMode === "bundle" && selectedDef ? (
              <span className="text-[var(--fin-dim)]">
                {" "}
                · {strategyKindLabel(selectedDef.meta.strategy_id)}
              </span>
            ) : null}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={
              bundleLoading || !barsForRun || barsForRun.length < 40 || gridBusy
            }
            onClick={() => void runBacktest()}
            className="fin-btn-primary px-6 py-2.5 disabled:opacity-50"
          >
            {gridBusy ? "回测计算中…" : "执行回测（默认组合）"}
          </button>
          <a href="#registry-config" className="text-xs fin-link">
            ① 回测参数范围 ↓
          </a>
          <a href="#registry-custom-baseline" className="text-xs fin-link">
            ② 自定义参数对比 ↓
          </a>
          {gridResult && (
            <a href="#registry-results" className="text-xs fin-link">
              ③ 详细结果 ↓
            </a>
          )}
        </div>

        {selectedBacktestIneligibleReason ? (
          <p className="fin-alert-warn--compact mt-3 text-xs">
            {selectedBacktestIneligibleReason}
          </p>
        ) : null}

        {gridErr && <p className="mt-3 text-sm text-red-700">{gridErr}</p>}

        {gridResult && <RegistryResultSummary gridResult={gridResult} />}

        {!gridResult &&
          boardVerifySummary &&
          selectedDef &&
          selectedBacktestEligible && (
            <p className="mt-4 rounded-lg border border-fin-border px-3 py-2 text-xs fin-muted-text">
              看板默认参数：策略{" "}
              {formatPct(boardVerifySummary.strategyReturnPct)} · 超额{" "}
              {formatPct(boardVerifySummary.excessReturnPct)} ·
              点击上方执行回测查看优选组合。
            </p>
          )}
      </section>

      <details id="registry-config" className="fin-panel p-5">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <span className="mr-2 text-[var(--fin-dim)]">▸</span>
          <span className="fin-section-title">① 回测参数范围</span>
        </summary>
        <p className="mt-2 text-xs fin-muted-text">
          控制「执行回测」时枚举的策略参数范围（RSI / 布林 / MA
          金叉 / MA 自定义）。与下方「② 自定义参数对比」无关：后者只添加
          <strong>一组</strong>对照参数，不参与批量搜索。
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <label className="fin-choice has-[:checked]:bg-[var(--fin-blue-soft)] has-[:checked]:text-[var(--fin-text)]">
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
            站点数据（与看板一致）
          </label>
          <label className="fin-choice has-[:checked]:bg-[var(--fin-blue-soft)] has-[:checked]:text-[var(--fin-text)]">
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
            上传行情文件
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
              className="fin-btn-secondary px-4 py-2 text-sm"
            >
              选择行情 CSV
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
                className="rounded-lg border border-fin-border px-4 py-2 text-sm fin-muted-text hover:border-[var(--fin-text)]/25 hover:text-[var(--fin-text)]"
              >
                清除上传
              </button>
            )}
            {barsErr && (
              <p className="w-full text-sm text-red-700">{barsErr}</p>
            )}
          </div>
        )}

        <div className="mt-6 space-y-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fin-dim)]">
            策略参数范围
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="fin-panel p-5">
              <h4 className="text-sm font-semibold text-[var(--fin-text)]">
                RSI
              </h4>
              <p className="mt-1 text-xs fin-muted-text">
                超卖上穿买、超买下穿卖；可勾选日/周线。
              </p>
              <div className="mt-3 flex flex-wrap gap-4 text-sm fin-muted-text">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={searchForm.rsiD}
                    onChange={(e) =>
                      setSearchForm((s) => ({ ...s, rsiD: e.target.checked }))
                    }
                  />
                  日线
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={searchForm.rsiW}
                    onChange={(e) =>
                      setSearchForm((s) => ({ ...s, rsiW: e.target.checked }))
                    }
                  />
                  周线
                </label>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="text-xs fin-muted-text">
                  周期
                  <input
                    className="fin-input mt-1 w-full px-2.5 py-2"
                    value={searchForm.rsiPeriodStr}
                    onChange={(e) =>
                      setSearchForm((s) => ({
                        ...s,
                        rsiPeriodStr: e.target.value,
                      }))
                    }
                    placeholder="6,12,24"
                  />
                </label>
                <label className="text-xs fin-muted-text">
                  超卖阈值
                  <input
                    className="fin-input mt-1 w-full px-2.5 py-2"
                    value={searchForm.rsiOsStr}
                    onChange={(e) =>
                      setSearchForm((s) => ({ ...s, rsiOsStr: e.target.value }))
                    }
                  />
                </label>
                <label className="text-xs fin-muted-text">
                  超买阈值
                  <input
                    className="fin-input mt-1 w-full px-2.5 py-2"
                    value={searchForm.rsiObStr}
                    onChange={(e) =>
                      setSearchForm((s) => ({ ...s, rsiObStr: e.target.value }))
                    }
                  />
                </label>
              </div>
            </div>

            <div className="fin-panel p-5">
              <h4 className="text-sm font-semibold text-[var(--fin-text)]">
                布林带
              </h4>
              <p className="mt-1 text-xs fin-muted-text">
                下轨外回归买入、上轨外回归卖出；可勾选日/周线。
              </p>
              <div className="mt-3 flex flex-wrap gap-4 text-sm fin-muted-text">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={searchForm.bollD}
                    onChange={(e) =>
                      setSearchForm((s) => ({ ...s, bollD: e.target.checked }))
                    }
                  />
                  日线
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={searchForm.bollW}
                    onChange={(e) =>
                      setSearchForm((s) => ({ ...s, bollW: e.target.checked }))
                    }
                  />
                  周线
                </label>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs fin-muted-text">
                  窗口长度
                  <input
                    className="fin-input mt-1 w-full px-2.5 py-2"
                    value={searchForm.bollPeriodStr}
                    onChange={(e) =>
                      setSearchForm((s) => ({
                        ...s,
                        bollPeriodStr: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="text-xs fin-muted-text">
                  标准差倍数
                  <input
                    className="fin-input mt-1 w-full px-2.5 py-2"
                    value={searchForm.bollStdStr}
                    onChange={(e) =>
                      setSearchForm((s) => ({
                        ...s,
                        bollStdStr: e.target.value,
                      }))
                    }
                  />
                </label>
              </div>
            </div>

            <div className="fin-panel p-5 lg:col-span-2">
              <h4 className="text-sm font-semibold text-[var(--fin-text)]">
                MA
              </h4>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-fin-border p-4">
                  <p className="text-xs font-medium text-[var(--fin-text)]">
                    金叉
                  </p>
                  <p className="mt-0.5 text-[11px] fin-muted-text">
                    短均线上穿长均线买，反之为卖。
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className="text-xs fin-muted-text">
                      快线
                      <input
                        className="fin-input mt-1 w-full px-2 py-1.5"
                        value={searchForm.maCrossFastStr}
                        onChange={(e) =>
                          setSearchForm((s) => ({
                            ...s,
                            maCrossFastStr: e.target.value,
                          }))
                        }
                        placeholder="5,10,20"
                      />
                    </label>
                    <label className="text-xs fin-muted-text">
                      慢线
                      <input
                        className="fin-input mt-1 w-full px-2 py-1.5"
                        value={searchForm.maCrossSlowStr}
                        onChange={(e) =>
                          setSearchForm((s) => ({
                            ...s,
                            maCrossSlowStr: e.target.value,
                          }))
                        }
                        placeholder="60,120"
                      />
                    </label>
                  </div>
                </div>
                <div className="rounded-lg border border-fin-border p-4">
                  <p className="text-xs font-medium text-[var(--fin-text)]">
                    自定义
                  </p>
                  <p className="mt-0.5 text-[11px] fin-muted-text">
                    上穿均线买；卖=止盈或回撤（先到先卖）。
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <label className="text-xs fin-muted-text">
                      买入均线
                      <input
                        className="fin-input mt-1 w-full px-2 py-1.5"
                        value={searchForm.maCustomBuyStr}
                        onChange={(e) =>
                          setSearchForm((s) => ({
                            ...s,
                            maCustomBuyStr: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="text-xs fin-muted-text">
                      止盈 %
                      <input
                        className="fin-input mt-1 w-full px-2 py-1.5"
                        value={searchForm.maCustomProfitStr}
                        onChange={(e) =>
                          setSearchForm((s) => ({
                            ...s,
                            maCustomProfitStr: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="text-xs fin-muted-text">
                      回撤 %
                      <input
                        className="fin-input mt-1 w-full px-2 py-1.5"
                        value={searchForm.maCustomDdStr}
                        onChange={(e) =>
                          setSearchForm((s) => ({
                            ...s,
                            maCustomDdStr: e.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <button
              type="button"
              onClick={() => setSearchForm(formFromDefaults())}
              className="rounded-lg border border-fin-border px-4 py-2 text-sm fin-muted-text hover:border-[var(--fin-text)]/25 hover:text-[var(--fin-text)]"
            >
              恢复默认搜索范围
            </button>
          </div>
        </div>
      </details>

      <details
        id="registry-custom-baseline"
        open={baselineSlotCountTotal > 0}
        className="fin-panel p-5"
      >
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <span className="mr-2 text-[var(--fin-dim)]">▸</span>
          <span className="fin-section-title">② 自定义参数对比</span>
        </summary>
        <p className="mt-2 text-xs fin-muted-text">
          独立于「① 回测配置」：最多添加 <strong>{MAX_CUSTOM_BASELINES}</strong>{" "}
          组策略参数作为对照线；添加后会在「③
          详细回测结果」对应策略表中展示为紫色对照行。
          切换策略类型不会清空已添加的对照参数。
        </p>
        <RegistryCustomBaseline
          productSelected={Boolean(selectedCode)}
          kind={baselineKind}
          onKindChange={(k) => {
            setBaselineKind(k);
            setBaselineAddError(null);
          }}
          form={baselineForm}
          onFormChange={setBaselineForm}
          onAdd={addCustomBaseline}
          slots={customBaselineSlotsForKind}
          savedCountsByKind={{
            ma: baselineSlotsByKind.ma?.length ?? 0,
            rsi: baselineSlotsByKind.rsi?.length ?? 0,
            boll: baselineSlotsByKind.boll?.length ?? 0,
          }}
          onRemoveSlot={removeCustomBaseline}
          onClearAll={clearCustomBaselines}
          barsReady={Boolean(barsForRun && barsForRun.length >= 40)}
          addError={baselineAddError}
          embedded
        />
      </details>

      <details
        id="registry-results"
        ref={resultsSectionRef}
        open={gridResult != null}
        className="fin-panel p-5"
      >
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <span className="mr-2 text-[var(--fin-dim)]">▸</span>
          <span className="fin-section-title">
            ③ 详细回测结果
            {selectedCode ? (
              <>
                {" · "}
                <span className="font-mono text-lg text-[var(--fin-text)]">
                  {selectedCode}
                </span>
              </>
            ) : null}
          </span>
        </summary>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm fin-muted-text">
              与 ETF 详情页回测摘要同源。每类展示 {topN}{" "}
              组：兼顾全样本超额与后段超额；摘要区的「全样本最优 / 后段最优」为跨策略类型的全局对照，勿与下表类内行混读。
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm fin-muted-text">
            <span className="text-xs fin-muted-text">每类展示</span>
            <select
              value={topN}
              onChange={(e) => {
                const n = Number(e.target.value);
                setTopN(n);
              }}
              className="fin-input px-2 py-1.5 text-sm font-medium"
            >
              {TOP_N_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  优选 {n} 组
                </option>
              ))}
            </select>
            <span className="text-xs text-[var(--fin-dim)]">
              变更后自动重算
            </span>
          </label>
        </div>

        {!gridResult && (
          <p className="mt-6 rounded-xl border border-dashed border-fin-border px-4 py-8 text-center text-sm fin-muted-text">
            在首屏选择产品并点击「执行回测」后，此处展开优选组合表与买入持有对照。
          </p>
        )}

        {gridResult && (
          <>
            <div className="mt-6 fin-panel border border-fin-border px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fin-muted)]">
                基础统计 · 买入持有
              </p>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="fin-muted-text">区间</span>
                  <p className="font-mono font-medium text-[var(--fin-text)]">
                    {gridResult.meta.startDate} → {gridResult.meta.endDate}
                  </p>
                </div>
                <div>
                  <span className="fin-muted-text">样本</span>
                  <p className="font-medium text-[var(--fin-text)]">
                    {gridResult.meta.barCount} 个交易日
                  </p>
                </div>
                <div>
                  <span className="fin-muted-text">累计收益</span>
                  <p className="font-semibold text-[var(--fin-text)]">
                    {formatPct(gridResult.meta.buyHoldReturnPct)}
                  </p>
                </div>
                <div>
                  <span className="fin-muted-text">年化收益</span>
                  <p className="font-semibold text-[var(--fin-text)]">
                    {formatPct(gridResult.meta.buyHoldAnnualPct)}
                  </p>
                </div>
                <div>
                  <span className="fin-muted-text">最大回撤</span>
                  <p className="font-semibold text-[var(--fin-text)]">
                    {formatPct(gridResult.meta.buyHoldMaxDrawdownPct)}
                  </p>
                </div>
              </div>
            </div>

            {customBaselineRows.length > 0 ? (
              <p className="fin-alert-info--compact mt-4 text-xs">
                已添加 {customBaselineRows.length} 组自定义对照（
                {customBaselineRows.map((r) => r.label).join("、")}
                ）。增删请前往「② 自定义参数对比」；参数范围请前往「①
                回测参数范围」。
              </p>
            ) : null}

            <p className="mt-3 rounded-lg border border-fin-border px-3 py-2 text-[11px] fin-muted-text">
              <span className="font-sans font-semibold text-[var(--fin-text)]">
                样本切分 ·{" "}
              </span>
              前段 {gridResult.split.trainStartDate}→
              {gridResult.split.trainEndDate}（{gridResult.split.trainBarCount}{" "}
              日，{(gridResult.split.trainRatio * 100).toFixed(0)}%） · 后段{" "}
              {gridResult.split.valStartDate}→{gridResult.split.valEndDate}（
              {gridResult.split.valBarCount} 日）
            </p>

            {(() => {
              const hints = noBeatBuyHoldHints(gridResult);
              return hints ? (
                <div className="fin-alert-error--compact mt-3 text-[11px]">
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
              <div className="fin-alert-warn--compact mt-3 text-[11px]">
                <p className="font-semibold">回测可信度提示</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {gridResult.split.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            )}

            {(gridResult.globalRobustBest || gridResult.globalFullBest) && (
              <div className="mt-3 space-y-2 rounded-lg border border-fin-border px-3 py-2 text-[11px]">
                {gridResult.globalRobustBest && (
                  <p>
                    <span className="fin-best-badge-robust">后段最优</span> —{" "}
                    {gridResult.globalRobustBest.label} · 策略{" "}
                    {formatPct(gridResult.globalRobustBest.cumReturnPct)} · 后段超额{" "}
                    {gridResult.globalRobustBest.excessValPct != null
                      ? formatSignedPct(gridResult.globalRobustBest.excessValPct)
                      : "—"}{" "}
                    · 全样本超额{" "}
                    {formatSignedPct(gridResult.globalRobustBest.excessReturnPct)}{" "}
                    · 回撤{" "}
                    {formatPct(gridResult.globalRobustBest.maxDrawdownPct)} · 胜率{" "}
                    {formatPct(gridResult.globalRobustBest.winRate * 100)} ·{" "}
                    {gridResult.globalRobustBest.roundCount} 轮
                  </p>
                )}
                {gridResult.globalFullBest && (
                  <p>
                    <span className="fin-best-badge-full">全样本最优</span> —{" "}
                    {gridResult.globalFullBest.label} · 策略{" "}
                    {formatPct(gridResult.globalFullBest.cumReturnPct)} · 后段超额{" "}
                    {gridResult.globalFullBest.excessValPct != null
                      ? formatSignedPct(gridResult.globalFullBest.excessValPct)
                      : "—"}{" "}
                    · 全样本超额{" "}
                    {formatSignedPct(gridResult.globalFullBest.excessReturnPct)} ·
                    回撤 {formatPct(gridResult.globalFullBest.maxDrawdownPct)} · 胜率{" "}
                    {formatPct(gridResult.globalFullBest.winRate * 100)} ·{" "}
                    {gridResult.globalFullBest.roundCount} 轮
                  </p>
                )}
              </div>
            )}
            {gridResult &&
              !gridResult.globalRobustBest &&
              !gridResult.globalFullBest &&
              boardVerifySummary &&
              selectedDef && (
                <p className="mt-3 rounded-lg border border-fin-border px-3 py-2 text-[11px] text-[var(--fin-text)]">
                  看板默认参数：策略{" "}
                  {formatPct(boardVerifySummary.strategyReturnPct)} · 超额{" "}
                  {formatPct(boardVerifySummary.excessReturnPct)} · 回撤{" "}
                  {formatPct(boardVerifySummary.maxDrawdownPct)} · 胜率{" "}
                  {formatPct(boardVerifySummary.winRate * 100)} · 轮次{" "}
                  {boardVerifySummary.roundCount}。                  产生有效候选后，此处展示<strong>后段最优</strong>与
                  <strong>全样本最优</strong>摘要。
                </p>
              )}

            <div className="mt-4 space-y-8">
              <ResultTable
                title={`RSI · 优选 ${topN}`}
                tableFamily="rsi"
                topN={topN}
                rows={gridResult.rsi}
                onRegister={registerRow}
                customBaselineRows={customBaselineRows}
              />
              <ResultTable
                title={`布林带 · 优选 ${topN}`}
                tableFamily="boll"
                topN={topN}
                rows={gridResult.boll}
                onRegister={registerRow}
                customBaselineRows={customBaselineRows}
              />
              <ResultTable
                title={`MA 金叉 · 优选 ${topN}`}
                tableFamily="ma"
                topN={topN}
                rows={gridResult.maCross}
                onRegister={registerRow}
                customBaselineRows={customBaselineRows}
              />
              <ResultTable
                title={`MA 自定义 · 优选 ${topN}`}
                tableFamily="ma_custom"
                topN={topN}
                rows={gridResult.maCustom}
                onRegister={registerRow}
                customBaselineRows={customBaselineRows}
              />
              <p className="text-[11px] fin-muted-text">
                {HOLD_FLAT_AVG_TOO_FEW_ROUNDS_NOTE}
              </p>
            </div>
          </>
        )}
      </details>

      <details id="registry-observations" className="fin-panel p-5">
        <summary className="cursor-pointer list-none flex flex-wrap items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
          <span className="fin-section-title">
            <span className="mr-1.5 text-[var(--fin-dim)]">▸</span>④ 监控策略{" "}
            <span className="font-normal fin-muted-text">（默认折叠）</span>
          </span>
        </summary>
        <p className="mt-2 text-xs fin-muted-text">
          灰标为默认参数；高亮为自选监控策略、可删除。加入后可在产品详情页的策略参数中选择。
        </p>

        {etfDefinitions.length === 0 ? (
          <p className="mt-3 text-sm fin-muted-text">暂无标的定义。</p>
        ) : (
          <div className="mt-4 space-y-4">
            {etfDefinitions.map((etf) => {
              const product = etfProducts.find((p) => p.code === etf.meta.code);
              const vars = getProductParamVariants(etf, product, entries);
              return (
                <div
                  key={etf.meta.code}
                  className="fin-panel p-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-fin-border pb-2">
                    <div>
                      <p className="font-mono text-[10px] text-[var(--fin-dim)]">
                        {etf.meta.code}
                      </p>
                      <p className="text-sm font-semibold text-[var(--fin-text)]">
                        {etf.meta.name}
                      </p>
                    </div>
                    <Link
                      to={`/etf/${etf.meta.code}`}
                      className="shrink-0 text-xs fin-link"
                    >
                      看板
                    </Link>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {vars.map((v) => (
                      <ObservationRow
                        key={v.key}
                        etfCode={etf.meta.code}
                        variant={v}
                        onRemoveRegistered={onRemoveVariant}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}

        {uploadOnlyRegistered.length > 0 && (
          <div className="fin-alert-warn--compact mt-4">
            <h4 className="text-xs font-semibold text-[var(--fin-amber)]">
              仅在上传文件中的标的（未在站点产品列表中）
            </h4>
            <ul className="mt-2 space-y-1.5">
              {uploadOnlyRegistered.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-fin-border px-2 py-1.5 text-xs"
                >
                  <div>
                    <span className="font-mono text-[var(--fin-dim)]">
                      {r.etfCode}
                    </span>
                    <span className="mx-1.5 fin-muted-text">|</span>
                    <span className="font-medium text-[var(--fin-text)]">
                      {r.label}
                    </span>
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
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-fin-border px-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              registered
                ? "border border-[rgba(251,191,36,0.35)] text-[var(--fin-amber)]"
                : "border border-fin-border fin-muted-text"
            }`}
          >
            {registered ? "监控策略" : "默认参数"}
          </span>
          <span className="font-medium text-[var(--fin-text)]">
            {variantMonitorCompact(variant)}
          </span>
        </div>
        <p className="mt-0.5 text-xs fin-muted-text">策略类型：{kind}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link to={`/etf/${etfCode}`} className="text-xs fin-link">
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
          <span className="text-[10px] text-[var(--fin-dim)]">内置</span>
        )}
      </div>
    </li>
  );
}

function ResultTable({
  title,
  tableFamily,
  topN,
  rows,
  onRegister,
  customBaselineRows,
}: {
  title: string;
  tableFamily: StrategyFamily;
  topN: number;
  rows: TopPickedRow[];
  onRegister: (r: ScoredParamRow) => void;
  customBaselineRows: ScoredParamRow[];
}) {
  if (!rows.length) return null;
  const fullBadgeCap = topN - Math.floor(topN / 2);
  const valBadgeCap = Math.floor(topN / 2);
  const fmtEx = (x: number | null) => formatSignedPct(x);
  const familyBaselines = customBaselineRows.filter(
    (b) => b.family === tableFamily,
  );
  const fullRankByKey = new Map<string, number>();
  const valRankByKey = new Map<string, number>();
  const rowKey = (r: ScoredParamRow) => `${r.strategyId}|${r.paramVersion}`;
  [...rows]
    .sort((a, b) => b.excessReturnPct - a.excessReturnPct)
    .forEach((r, index) => fullRankByKey.set(rowKey(r), index + 1));
  [...rows]
    .sort((a, b) => {
      const av = a.excessValPct;
      const bv = b.excessValPct;
      if (av != null && bv != null && Math.abs(av - bv) > 1e-9) return bv - av;
      if (av != null && bv == null) return -1;
      if (av == null && bv != null) return 1;
      return b.excessReturnPct - a.excessReturnPct;
    })
    .forEach((r, index) => valRankByKey.set(rowKey(r), index + 1));

  const badgesForRow = (r: TopPickedRow) => {
    const key = rowKey(r);
    const fullRank = fullRankByKey.get(key);
    const valRank = valRankByKey.get(key);
    return (
      <>
        {r.pickSlots.includes("full") &&
        fullRank != null &&
        fullRank <= fullBadgeCap ? (
          <span className="fin-rank-badge-full">全样本 Top{fullRank}</span>
        ) : null}
        {r.pickSlots.includes("val") &&
        valRank != null &&
        valRank <= valBadgeCap ? (
          <span className="fin-rank-badge-robust">后段 Top{valRank}</span>
        ) : null}
      </>
    );
  };
  return (
    <div>
      <h4 className="fin-section-title">{title}</h4>
      <p className="mt-1 text-[11px] fin-muted-text">
        全样本口径；类内标注全样本 / 后段优选位次。自定义对照参数以单独行展示。
        {familyBaselines.length > 0 ? " 紫色行为自定义对照。" : null}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-[1120px] w-full text-left text-sm">
          <thead>
            <tr className="fin-table-head">
              <th className="px-3 py-2">组合说明</th>
              <th className="px-3 py-2">策略收益 %</th>
              <th className="px-3 py-2">最大回撤 %</th>
              <th className="px-3 py-2">全样本超额 %</th>
              <th className="px-3 py-2">前段超额 %</th>
              <th className="px-3 py-2">后段超额 %</th>
              <th className="px-3 py-2">胜率</th>
              <th className="px-3 py-2">买卖次数</th>
              <th className="px-3 py-2">均持仓天</th>
              <th className="px-3 py-2">均空仓天</th>
              <th className="px-3 py-2">收益/回撤</th>
              <th className="px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-fin-border">
            {familyBaselines.map((baseline, bi) => (
              <tr
                key={`baseline-${baseline.paramVersion}-${bi}`}
                className="fin-baseline-row"
              >
                <td className="px-3 py-2 text-[var(--fin-text)]">
                  <span className="font-medium text-[var(--fin-muted)]">
                    自定义 {bi + 1}
                  </span>
                  <p className="mt-0.5 text-[10px] fin-muted-text">
                    {baseline.label}
                  </p>
                </td>
                <td className="px-3 py-2 font-mono">
                  {formatPct(baseline.cumReturnPct)}
                </td>
                <td className="px-3 py-2 font-mono">
                  {formatPct(baseline.maxDrawdownPct)}
                </td>
                <td className="px-3 py-2 font-mono fin-muted-text">
                  {formatSignedPct(baseline.excessReturnPct)}
                </td>
                <td className="px-3 py-2 font-mono fin-muted-text">
                  {fmtEx(baseline.excessTrainPct)}
                </td>
                <td className="px-3 py-2 font-mono fin-muted-text">
                  {fmtEx(baseline.excessValPct)}
                </td>
                <td className="px-3 py-2 font-mono">
                  {formatPct(baseline.winRate * 100)}
                </td>
                <td className="px-3 py-2 text-xs fin-muted-text">
                  {baseline.rawBuyCount} 买 / {baseline.rawSellCount} 卖
                  <span className="block text-[var(--fin-dim)]">
                    完成 {baseline.roundCount} 轮
                  </span>
                </td>
                <td className="px-3 py-2 font-mono">
                  {formatAvgHoldDaysDisplay(
                    baseline.roundCount,
                    baseline.avgHoldDays,
                  )}
                </td>
                <td className="px-3 py-2 font-mono">
                  {formatAvgFlatDaysDisplay(
                    baseline.roundCount,
                    baseline.avgFlatDays,
                  )}
                </td>
                <td className="px-3 py-2 font-mono fin-muted-text">
                  {baseline.score}
                </td>
                <td className="px-3 py-2 fin-muted-text text-xs">对照行</td>
              </tr>
            ))}
            {rows.map((r, i) => {
              return (
                <tr
                  key={`${r.paramVersion}-${i}-${r.label}`}
                  className="fin-row-hover"
                >
                  <td className="px-3 py-2 text-[var(--fin-text)]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {badgesForRow(r)}
                      <span className="font-medium">{r.label}</span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-[var(--fin-dim)]">
                      {strategyKindLabel(r.strategyId)}
                    </p>
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {formatPct(r.cumReturnPct)}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {formatPct(r.maxDrawdownPct)}
                  </td>
                  <td className="px-3 py-2 font-mono fin-muted-text">
                    {r.excessReturnPct > 0 ? "+" : ""}
                    {formatPct(r.excessReturnPct)}
                  </td>
                  <td className="px-3 py-2 font-mono fin-muted-text">
                    {fmtEx(r.excessTrainPct)}
                  </td>
                  <td className="px-3 py-2 font-mono fin-muted-text">
                    {fmtEx(r.excessValPct)}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {formatPct(r.winRate * 100)}
                  </td>
                  <td className="px-3 py-2 text-xs fin-muted-text">
                    {r.rawBuyCount} 买 / {r.rawSellCount} 卖
                    <span className="block text-[var(--fin-dim)]">
                      完成 {r.roundCount} 轮
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {formatAvgHoldDaysDisplay(r.roundCount, r.avgHoldDays)}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {formatAvgFlatDaysDisplay(r.roundCount, r.avgFlatDays)}
                  </td>
                  <td className="px-3 py-2 font-mono fin-muted-text">
                    {r.score}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onRegister(r)}
                      className="fin-btn-primary px-3 py-1 text-xs"
                    >
                      加入监控
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
