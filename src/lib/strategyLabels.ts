import type { ParamStrategyVariant } from "../types";
import {
  getBollingerVariant,
  getMaPair,
  getRsiVariant,
  usesBollStrategy,
  usesMaCustomStrategy,
  usesRsiStrategy,
} from "./strategy";

/** 去掉成对引号及其中内容（ASCII "…"、弯引号 “…” ，常见于 etf_params.note） */
export function stripQuotedAnnotations(s: string): string {
  let t = s;
  for (let i = 0; i < 8; i++) {
    const n = t
      .replace(/\s*\u201c[^\u201d]*\u201d/g, "")
      .replace(/\s*"[^"]*"/g, "");
    if (n === t) break;
    t = n;
  }
  return t.replace(/\s+/g, " ").trim();
}

export function isUserRegisteredVariantKey(key: string): boolean {
  return key.startsWith("reg:");
}

/** 网格/注册写入的 `YYYYMMDD_strategy_…` 式版本号：下拉展示为「最优策略方案」 */
export function isSyntheticGridParamVersion(ver: string): boolean {
  return /^\d{8}_[a-z0-9_]+$/i.test(ver);
}

export function variantVersionDisplay(ver: string): string {
  return isSyntheticGridParamVersion(ver) ? "最优策略方案" : ver;
}

/** 策略类型中文名（用于下拉、列表，避免直接展示内部 strategy_id） */
export function strategyKindLabel(strategyId: string): string {
  const s = strategyId.toLowerCase();
  if (s.includes("ma_custom")) return "MA 自定义";
  if (s.includes("boll")) return "布林带";
  if (s.includes("rsi")) return "RSI";
  if (s.includes("ma")) return "MA 金叉";
  return "策略";
}

const USER_REGISTERED_LABEL_PREFIX = /^\[(观测注册|监控策略)\]\s*/;

/** 下拉与表格：策略名 + 关键参数摘要 + 版本号 */
export function variantOptionLabel(v: ParamStrategyVariant): string {
  if (isUserRegisteredVariantKey(v.key)) {
    return stripQuotedAnnotations(
      v.label.replace(USER_REGISTERED_LABEL_PREFIX, "监控 · "),
    );
  }
  const sid = v.strategyId;
  const ver = variantVersionDisplay(v.paramVersion);
  let out: string;
  if (usesRsiStrategy(sid)) {
    const rv = getRsiVariant(v.params);
    if (!rv) out = `RSI · ${ver}`;
    else out = `RSI(${rv.period}) ${rv.oversold}/${rv.overbought} · ${ver}`;
  } else if (usesBollStrategy(sid)) {
    const bv = getBollingerVariant(v.params);
    if (!bv) out = `布林 · ${ver}`;
    else out = `布林(${bv.period}, ${bv.stdDev}σ) · ${ver}`;
  } else if (usesMaCustomStrategy(sid) && v.params.ma_custom_rule) {
    const r = v.params.ma_custom_rule;
    out = `MA${r.buyMaPeriod} 上穿 | 卖：止盈${r.profitTakePct}% 或 回撤≥${r.trailDrawdownPct}% · ${ver}`;
  } else {
    const pair = getMaPair(v.params);
    if (pair) out = `MA ${pair.fastP}/${pair.slowP} 金叉 · ${ver}`;
    else out = `${strategyKindLabel(sid)} · ${ver}`;
  }
  return stripQuotedAnnotations(out);
}

/** 监控表等：去掉末尾「 · 版本号」，提高可读性 */
export function variantMonitorCompact(v: ParamStrategyVariant): string {
  if (isUserRegisteredVariantKey(v.key)) {
    return stripQuotedAnnotations(
      v.label.replace(USER_REGISTERED_LABEL_PREFIX, "监控 · "),
    );
  }
  const noteLabel = stripQuotedAnnotations(v.label);
  if (noteLabel && /日/.test(noteLabel)) {
    const kind = strategyKindLabel(v.strategyId);
    if (noteLabel.endsWith(` · ${kind}`)) {
      return noteLabel.slice(0, -(kind.length + 3)).trim();
    }
    return noteLabel;
  }
  const full = variantOptionLabel(v);
  const sufRaw = ` · ${v.paramVersion}`;
  const sufDisp = ` · ${variantVersionDisplay(v.paramVersion)}`;
  if (full.endsWith(sufDisp)) return full.slice(0, -sufDisp.length);
  if (full.endsWith(sufRaw)) return full.slice(0, -sufRaw.length);
  return full;
}

export function registeredIdFromVariantKey(key: string): string | null {
  if (!isUserRegisteredVariantKey(key)) return null;
  return key.slice(4);
}
