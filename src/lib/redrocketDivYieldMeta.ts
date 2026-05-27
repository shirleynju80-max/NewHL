export type RedrocketDivYieldMeta = {
  source: string;
  metric?: string;
  update_frequency?: string;
  /** 红色火箭 API 各指数 DID 序列中的最近 tradeDate（全局取 max） */
  source_latest_date: string;
  per_index_latest_date?: Record<string, string>;
  fetched_at?: string;
};

/** 指数研究表：股息率列页脚（用户可读） */
export function indexDivYieldFootnote(meta: RedrocketDivYieldMeta | null): string {
  const source = meta?.source?.trim() || "红色火箭";
  const date = meta?.source_latest_date?.trim();
  if (!date) {
    return `股息率（仅红利类指数）：来源${source}，更新日期待同步。`;
  }
  return `股息率（仅红利类指数）：来源${source}，数据更新至 ${date}。`;
}

export async function fetchRedrocketDivYieldMeta(
  cacheBust?: string | number,
): Promise<RedrocketDivYieldMeta | null> {
  const base = import.meta.env.BASE_URL || "/";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  const q = cacheBust != null ? `?_t=${cacheBust}` : "";
  try {
    const res = await fetch(`${prefix}data/redrocket_div_yield_meta.json${q}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as RedrocketDivYieldMeta;
    if (!data?.source_latest_date && !data?.source) return null;
    return data;
  } catch {
    return null;
  }
}
