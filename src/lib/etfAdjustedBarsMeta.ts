/** 与 scripts/realtime_crawler/sync_etf_adjusted_bars.py 写入的 meta 一致 */
export type EtfAdjustedBarsMetaRow = {
  dividend_signature?: string;
  dividend_events?: number;
  latest_ex_dividend_date?: string;
  last_checked_at?: string;
  last_refreshed_at?: string;
  bars_rows?: number;
  overlap_mismatches?: number;
};

/** 历史误读 schema：部分页面曾用 funds[]；脚本实际写 etfs{code} */
export type EtfAdjustedBarsMeta = {
  updated_at?: string;
  etfs?: Record<string, EtfAdjustedBarsMetaRow>;
  funds?: { code?: string; latest_ex_dividend_date?: string }[];
};

export function parseEtfAdjustedBarsMeta(
  text: string,
): EtfAdjustedBarsMeta | null {
  const t = text.trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t) as EtfAdjustedBarsMeta;
    if (!j || typeof j !== "object") return null;
    return j;
  } catch {
    return null;
  }
}

export function latestExDividendDateForCode(
  meta: EtfAdjustedBarsMeta | null | undefined,
  code: string,
): string | null {
  if (!meta || !code) return null;
  const fromEtfs = meta.etfs?.[code]?.latest_ex_dividend_date?.trim();
  if (fromEtfs) return fromEtfs;
  const fromFunds = meta.funds
    ?.find((row) => row.code === code)
    ?.latest_ex_dividend_date?.trim();
  return fromFunds || null;
}
