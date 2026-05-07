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
import type { BondSeriesPoint, EtfDefinition } from "../types";
import { buildCsvBundle, readFilesAsBundle } from "../data/csvLoader";
import { bondByDate as mockBondByDate, etfDefinitions as mockEtfDefinitions } from "../data/mock";

type SourceKind = "mock" | "csv" | "csv_public";

type Ctx = {
  definitions: EtfDefinition[];
  bondByDate: Record<string, BondSeriesPoint>;
  sourceKind: SourceKind;
  sourceLabel: string;
  loadError: string | null;
  loadFromDownloads: (files: FileList | File[]) => Promise<void>;
  resetToMock: () => void;
  getEtf: (code: string) => EtfDefinition | undefined;
};

const DataSourceContext = createContext<Ctx | null>(null);

async function tryFetchPublicCsv(): Promise<{ definitions: EtfDefinition[]; bondByDate: Record<string, BondSeriesPoint> } | null> {
  const base = import.meta.env.BASE_URL || "/";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  const urls = ["etfs.csv", "bars.csv", "bonds.csv", "etf_params.csv"].map(
    (f) => `${prefix}data/${f}`
  );
  try {
    const res = await Promise.all(urls.map((u) => fetch(u, { cache: "no-store" })));
    if (!res.every((r) => r.ok)) return null;
    const [etfs, bars, bonds, params] = await Promise.all(res.map((r) => r.text()));
    const bundle = buildCsvBundle(etfs, bars, bonds, params);
    return bundle;
  } catch {
    return null;
  }
}

export function DataSourceProvider({ children }: { children: ReactNode }) {
  const [definitions, setDefinitions] = useState<EtfDefinition[]>(mockEtfDefinitions);
  const [bondMap, setBondMap] = useState<Record<string, BondSeriesPoint>>(mockBondByDate);
  const [sourceKind, setSourceKind] = useState<SourceKind>("mock");
  const [sourceLabel, setSourceLabel] = useState<string>("内置示例数据");
  const [loadError, setLoadError] = useState<string | null>(null);
  const userTouchedRef = useRef(false);

  const getEtf = useCallback(
    (code: string) => definitions.find((d) => d.meta.code === code),
    [definitions]
  );

  const loadFromDownloads = useCallback(async (files: FileList | File[]) => {
    userTouchedRef.current = true;
    setLoadError(null);
    try {
      const bundle = await readFilesAsBundle(files);
      setDefinitions(bundle.definitions);
      setBondMap(bundle.bondByDate);
      setSourceKind("csv");
      setSourceLabel("本机 CSV（下载等目录）");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
    }
  }, []);

  const resetToMock = useCallback(() => {
    userTouchedRef.current = false;
    setDefinitions(mockEtfDefinitions);
    setBondMap(mockBondByDate);
    setSourceKind("mock");
    setSourceLabel("内置示例数据");
    setLoadError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pub = await tryFetchPublicCsv();
      if (cancelled || !pub || userTouchedRef.current) return;
      setDefinitions(pub.definitions);
      setBondMap(pub.bondByDate);
      setSourceKind("csv_public");
      setSourceLabel("public/data/*.csv");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      definitions,
      bondByDate: bondMap,
      sourceKind,
      sourceLabel,
      loadError,
      loadFromDownloads,
      resetToMock,
      getEtf,
    }),
    [definitions, bondMap, sourceKind, sourceLabel, loadError, loadFromDownloads, resetToMock, getEtf]
  );

  return <DataSourceContext.Provider value={value}>{children}</DataSourceContext.Provider>;
}

export function useDataSource(): Ctx {
  const v = useContext(DataSourceContext);
  if (!v) throw new Error("useDataSource must be used within DataSourceProvider");
  return v;
}
