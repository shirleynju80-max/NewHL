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
  return (
    import.meta.env.VITE_DATA_API_BASE_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");
}

export async function fetchApiCsvBundle(
  apiBaseUrl = configuredDataApiBaseUrl(),
): Promise<ApiCsvBundleResponse | null> {
  if (!apiBaseUrl) return null;
  const r = await fetch(`${apiBaseUrl}/api/bundle`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
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
