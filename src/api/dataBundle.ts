export type ApiCsvFiles = {
  etfs?: string;
  bars?: string;
  bonds?: string;
  etfParams?: string;
  etfsMore?: string;
  barsMore?: string;
  bondsMore?: string;
  fundBars?: string;
  etfProducts?: string;
  indices?: string;
  indexBars?: string;
  indexTrackingEtfs?: string;
  etfDividends?: string;
  etfAdjustedBarsMeta?: string;
};

export type ApiCsvBundleResponse = {
  generatedAt?: string;
  files: ApiCsvFiles;
};

export function configuredDataApiBaseUrl(): string {
  const sameOrigin =
    import.meta.env.PROD &&
    typeof window !== "undefined" &&
    window.location.protocol !== "file:"
      ? window.location.origin
      : "";
  return (
    sameOrigin ||
    import.meta.env.VITE_DATA_API_BASE_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");
}

/** 境内移动网络访问 workers.dev 可能很慢；超时后回退同域 /data/*.csv */
export const DATA_API_FETCH_TIMEOUT_MS = 12_000;

function abortSignalWithTimeout(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const ac = new AbortController();
  const schedule =
    typeof globalThis.setTimeout === "function"
      ? globalThis.setTimeout.bind(globalThis)
      : setTimeout;
  schedule(() => ac.abort(), ms);
  return ac.signal;
}

export async function fetchApiCsvBundle(
  apiBaseUrl = configuredDataApiBaseUrl(),
  timeoutMs = DATA_API_FETCH_TIMEOUT_MS,
): Promise<ApiCsvBundleResponse | null> {
  if (!apiBaseUrl) return null;
  const r = await fetch(`${apiBaseUrl}/api/bundle`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: abortSignalWithTimeout(timeoutMs),
  });
  if (!r.ok) {
    throw new Error(`数据 API 返回 ${r.status}`);
  }
  const payload = (await r.json()) as ApiCsvBundleResponse;
  if (
    !payload ||
    typeof payload !== "object" ||
    !payload.files ||
    typeof payload.files !== "object"
  ) {
    throw new Error("数据 API 响应格式无效：缺少 files");
  }
  if (!payload.files.bars?.trim()) {
    throw new Error("数据 API 响应缺少 bars.csv 内容");
  }
  return payload;
}
