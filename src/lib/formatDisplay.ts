/** 页面展示：百分数默认保留 1 位小数 */
export function formatPct(v: number | null | undefined, digits = 1): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

/** 百分数数值部分（不带 % 号），用于拼接或已有单位场景 */
export function formatPctValue(v: number | null | undefined, digits = 1): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

/** 带正负号的百分数展示 */
export function formatSignedPct(v: number | null | undefined, digits = 1): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

/** 基金规模（元）→ 亿元展示 */
export function formatAumCny(aumCny: number | null | undefined, digits = 1): string {
  if (typeof aumCny !== "number" || !Number.isFinite(aumCny) || aumCny <= 0) return "—";
  return `${(aumCny / 1e8).toFixed(digits)}亿`;
}
