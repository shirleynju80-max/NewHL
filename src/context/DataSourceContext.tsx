import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { BondSeriesPoint, EtfDefinition, IndexDefinition, IndexTrackingRow } from "../types";
import {
  buildCsvBundle,
  expandBondsToBarDates,
  mergeBondSeries,
  parseBondsFileDualPurpose,
  readFilesAsBundle,
  withIndexCsvSafe,
  type AppDataBundle,
  type CsvMergeOptions,
} from "../data/csvLoader";
import { bondByDate as mockBondByDate, etfDefinitions as mockEtfDefinitions } from "../data/mock";
import { configuredDataApiBaseUrl, fetchApiCsvBundle, type ApiCsvFiles } from "../api/dataBundle";

type SourceKind = "mock" | "csv" | "csv_public" | "api";

type Ctx = {
  definitions: EtfDefinition[];
  bondByDate: Record<string, BondSeriesPoint>;
  indices: IndexDefinition[];
  indexTracking: IndexTrackingRow[];
  indexCsvError: string | null;
  sourceKind: SourceKind;
  sourceLabel: string;
  loadError: string | null;
  publicCsvAutoLoading: boolean;
  reloadingPublicCsv: boolean;
  loadFromDownloads: (files: FileList | File[]) => Promise<void>;
  resetToMock: () => void;
  reloadPublicCsv: () => Promise<void>;
  getEtf: (code: string) => EtfDefinition | undefined;
  getIndex: (code: string) => IndexDefinition | undefined;
};

const DataSourceContext = createContext<Ctx | null>(null);

async function fetchTextIfOk(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

type PublicCsvLoadResult =
  | { status: "ok"; bundle: AppDataBundle; indexCsvError: string | null }
  | { status: "missing" }
  | { status: "error"; message: string };

type ApiDataLoadResult =
  | { status: "ok"; bundle: AppDataBundle; indexCsvError: string | null; label: string }
  | { status: "missing" }
  | { status: "error"; message: string };

function allBundleDates(bundle: AppDataBundle): string[] {
  const dates = new Set<string>();
  for (const d of bundle.definitions) {
    for (const b of d.bars) dates.add(b.date);
  }
  for (const ix of bundle.indices) {
    for (const b of ix.bars) dates.add(b.date);
  }
  return [...dates].sort();
}

function bondMapForBundle(
  bundle: AppDataBundle,
  bondsText: string,
  bondsMoreText?: string
): Record<string, BondSeriesPoint> {
  const main = parseBondsFileDualPurpose(bondsText).yieldCurve;
  const more = bondsMoreText?.trim() ? parseBondsFileDualPurpose(bondsMoreText).yieldCurve : [];
  const series = main.length && more.length ? mergeBondSeries(main, more) : more.length ? more : main;
  return expandBondsToBarDates(series, allBundleDates(bundle));
}

function withBondMap(bundle: AppDataBundle, bondByDate: Record<string, BondSeriesPoint>): AppDataBundle {
  return { ...bundle, bondByDate };
}

function apiMergeOptions(files: ApiCsvFiles): CsvMergeOptions | undefined {
  const merge: CsvMergeOptions = {};
  if (files.etfsMore?.trim()) merge.etfsMore = files.etfsMore;
  if (files.barsMore?.trim()) merge.barsMore = files.barsMore;
  if (files.bondsMore?.trim()) merge.bondsMore = files.bondsMore;
  if (files.fundBars?.trim()) merge.fundBars = files.fundBars;
  return merge.etfsMore || merge.barsMore || merge.bondsMore || merge.fundBars ? merge : undefined;
}

function parseApiFiles(files: ApiCsvFiles): { bundle: AppDataBundle; indexCsvError: string | null } {
  const base = buildCsvBundle(files.etfs ?? "", files.bars ?? "", files.bonds ?? "", files.etfParams ?? "", apiMergeOptions(files));
  return withIndexCsvSafe(base, files.indices ?? "", files.indexBars ?? "", files.indexTrackingEtfs ?? "");
}

async function tryFetchApiData(): Promise<ApiDataLoadResult> {
  const apiBaseUrl = configuredDataApiBaseUrl();
  if (!apiBaseUrl) return { status: "missing" };
  try {
    const payload = await fetchApiCsvBundle(apiBaseUrl);
    if (!payload) return { status: "missing" };
    const { bundle, indexCsvError } = parseApiFiles(payload.files);
    const full = withBondMap(bundle, bondMapForBundle(bundle, payload.files.bonds ?? "", payload.files.bondsMore));
    return {
      status: "ok",
      bundle: full,
      indexCsvError,
      label: payload.generatedAt ? `数据 API · ${payload.generatedAt.slice(0, 10)}` : "数据 API",
    };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

async function tryFetchPublicCsv(): Promise<PublicCsvLoadResult> {
  const bust = `_t=${Date.now()}`;
  const base = import.meta.env.BASE_URL || "/";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  const u = (f: string) => `${prefix}data/${f}?${bust}`;
  try {
    const [re, rb, rp, rbd] = await Promise.all([
      fetch(u("etfs.csv"), { cache: "no-store" }),
      fetch(u("bars.csv"), { cache: "no-store" }),
      fetch(u("etf_params.csv"), { cache: "no-store" }),
      fetch(u("bonds.csv"), { cache: "no-store" }),
    ]);
    const etfs = re.ok ? await re.text() : "";
    const bars = rb.ok ? await rb.text() : "";
    const params = rp.ok ? await rp.text() : "";
    const bonds = rbd.ok ? await rbd.text() : "";
    if (!rb.ok || !bars.trim()) return { status: "missing" };
    const merge: CsvMergeOptions = {};
    const em = await fetchTextIfOk(`${prefix}data/etfsmore.csv?${bust}`);
    const bm = await fetchTextIfOk(`${prefix}data/barsmore.csv?${bust}`);
    const bom = await fetchTextIfOk(`${prefix}data/bondsmore.csv?${bust}`);
    const fb = await fetchTextIfOk(`${prefix}data/fund_bars.csv?${bust}`);
    if (em?.trim()) merge.etfsMore = em;
    if (bm?.trim()) merge.barsMore = bm;
    if (bom?.trim()) merge.bondsMore = bom;
    if (fb?.trim()) merge.fundBars = fb;
    const hasMerge = Boolean(merge.etfsMore || merge.barsMore || merge.bondsMore || merge.fundBars);
    const bundle = buildCsvBundle(etfs, bars, bonds, params, hasMerge ? merge : undefined);
    const ix = await fetchTextIfOk(`${prefix}data/indices.csv?${bust}`);
    const ib = await fetchTextIfOk(`${prefix}data/index_bars.csv?${bust}`);
    const it = await fetchTextIfOk(`${prefix}data/index_tracking_etfs.csv?${bust}`);
    const { bundle: parsed, indexCsvError } = withIndexCsvSafe(bundle, ix ?? "", ib ?? "", it ?? "");
    const full = withBondMap(parsed, bondMapForBundle(parsed, bonds, bom ?? undefined));
    return { status: "ok" as const, bundle: full, indexCsvError };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { status: "error", message };
  }
}

export function DataSourceProvider({ children }: { children: ReactNode }) {
  const [definitions, setDefinitions] = useState<EtfDefinition[]>(mockEtfDefinitions);
  const [bondMap, setBondMap] = useState<Record<string, BondSeriesPoint>>(mockBondByDate);
  const [indices, setIndices] = useState<IndexDefinition[]>([]);
  const [indexTracking, setIndexTracking] = useState<IndexTrackingRow[]>([]);
  const [indexCsvError, setIndexCsvError] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<SourceKind>("mock");
  const [sourceLabel, setSourceLabel] = useState<string>("内置示例数据");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [publicCsvAutoLoading, setPublicCsvAutoLoading] = useState(true);
  const [reloadingPublicCsv, setReloadingPublicCsv] = useState(false);
  const userTouchedRef = useRef(false);

  const getEtf = useCallback(
    (code: string) => definitions.find((d) => d.meta.code === code),
    [definitions]
  );

  const getIndex = useCallback(
    (code: string) => indices.find((d) => d.meta.index_code === code),
    [indices]
  );

  const loadFromDownloads = useCallback(async (files: FileList | File[]) => {
    setLoadError(null);
    setIndexCsvError(null);
    try {
      const { bundle, indexCsvError: idxErr } = await readFilesAsBundle(files);
      setDefinitions(bundle.definitions);
      setBondMap(bundle.bondByDate);
      setIndices(bundle.indices);
      setIndexTracking(bundle.indexTracking);
      setIndexCsvError(idxErr);
      setSourceKind("csv");
      setSourceLabel("本机 CSV（下载等目录）");
      userTouchedRef.current = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
    }
  }, []);

  const resetToMock = useCallback(() => {
    userTouchedRef.current = false;
    setDefinitions(mockEtfDefinitions);
    setBondMap(mockBondByDate);
    setIndices([]);
    setIndexTracking([]);
    setIndexCsvError(null);
    setSourceKind("mock");
    setSourceLabel("内置示例数据");
    setLoadError(null);
  }, []);

  const reloadPublicCsv = useCallback(async () => {
    setReloadingPublicCsv(true);
    setLoadError(null);
    setIndexCsvError(null);
    try {
      const api = await tryFetchApiData();
      if (api.status === "ok") {
        userTouchedRef.current = false;
        setDefinitions(api.bundle.definitions);
        setBondMap(api.bundle.bondByDate);
        setIndices(api.bundle.indices);
        setIndexTracking(api.bundle.indexTracking);
        setIndexCsvError(api.indexCsvError);
        setSourceKind("api");
        setSourceLabel(api.label);
        return;
      }
      if (api.status === "error") {
        setLoadError(`重新加载数据 API 失败：${api.message}`);
        return;
      }
      const pub = await tryFetchPublicCsv();
      if (pub.status === "missing") {
        setLoadError("public/data/bars.csv 不存在或为空，无法从 public/data 重新加载。");
        return;
      }
      if (pub.status === "error") {
        setLoadError(`重新加载 public/data 失败：${pub.message}`);
        return;
      }
      userTouchedRef.current = false;
      setDefinitions(pub.bundle.definitions);
      setBondMap(pub.bundle.bondByDate);
      setIndices(pub.bundle.indices);
      setIndexTracking(pub.bundle.indexTracking);
      setIndexCsvError(pub.indexCsvError);
      setSourceKind("csv_public");
      setSourceLabel("public/data/*.csv");
    } finally {
      setReloadingPublicCsv(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPublicCsvAutoLoading(true);
      const api = await tryFetchApiData();
      if (cancelled) return;
      if (userTouchedRef.current) {
        setPublicCsvAutoLoading(false);
        return;
      }
      if (api.status === "ok") {
        setLoadError(null);
        setIndexCsvError(api.indexCsvError);
        setDefinitions(api.bundle.definitions);
        setBondMap(api.bundle.bondByDate);
        setIndices(api.bundle.indices);
        setIndexTracking(api.bundle.indexTracking);
        setSourceKind("api");
        setSourceLabel(api.label);
        setPublicCsvAutoLoading(false);
        return;
      }
      if (api.status === "error") {
        setLoadError(`自动加载数据 API 失败：${api.message}。当前使用内置示例数据。`);
        setPublicCsvAutoLoading(false);
        return;
      }
      const pub = await tryFetchPublicCsv();
      if (cancelled) return;
      if (userTouchedRef.current) {
        setPublicCsvAutoLoading(false);
        return;
      }
      if (pub.status === "missing") {
        setPublicCsvAutoLoading(false);
        return;
      }
      if (pub.status === "error") {
        setLoadError(
          `自动加载 public/data 失败：${pub.message}。当前使用内置示例数据；请确认 public/data/bars.csv 存在且非空（etfs / etf_params / bonds 可缺省），或在本页用文件选择器载入。`
        );
        setPublicCsvAutoLoading(false);
        return;
      }
      setLoadError(null);
      setIndexCsvError(pub.indexCsvError);
      setDefinitions(pub.bundle.definitions);
      setBondMap(pub.bundle.bondByDate);
      setIndices(pub.bundle.indices);
      setIndexTracking(pub.bundle.indexTracking);
      setSourceKind("csv_public");
      setSourceLabel("public/data/*.csv");
      setPublicCsvAutoLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      definitions,
      bondByDate: bondMap,
      indices,
      indexTracking,
      indexCsvError,
      sourceKind,
      sourceLabel,
      loadError,
      publicCsvAutoLoading,
      reloadingPublicCsv,
      loadFromDownloads,
      resetToMock,
      reloadPublicCsv,
      getEtf,
      getIndex,
    }),
    [
      definitions,
      bondMap,
      indices,
      indexTracking,
      indexCsvError,
      sourceKind,
      sourceLabel,
      loadError,
      publicCsvAutoLoading,
      reloadingPublicCsv,
      loadFromDownloads,
      resetToMock,
      reloadPublicCsv,
      getEtf,
      getIndex,
    ]
  );

  return <DataSourceContext.Provider value={value}>{children}</DataSourceContext.Provider>;
}

export function useDataSource(): Ctx {
  const v = useContext(DataSourceContext);
  if (!v) throw new Error("useDataSource must be used within DataSourceProvider");
  return v;
}
