import type {
  EtfDefinition,
  ParamStrategyVariant,
  UserRegisteredStrategy,
} from "../types";
import {
  etfProductStrategyEligible,
  type EtfStrategyProductMeta,
} from "./etfListingAge";
import {
  strategyKindLabel,
  stripQuotedAnnotations,
  variantMonitorCompact,
} from "./strategyLabels";

export type ParamVariantProductMeta = EtfStrategyProductMeta;

/** 统一取可切换参数列表：用户注册项在前，其次 CSV paramVariants，否则合成单条 */
export function getParamVariants(
  etf: EtfDefinition,
  userRegistered?: UserRegisteredStrategy[],
): ParamStrategyVariant[] {
  const mine = (userRegistered ?? [])
    .filter((r) => r.etfCode === etf.meta.code)
    .map(
      (r): ParamStrategyVariant => ({
        key: `reg:${r.id}`,
        label: `[观测注册] ${stripQuotedAnnotations(r.label)}`,
        strategyId: r.strategyId,
        paramVersion: r.paramVersion,
        params: r.params,
      }),
    );
  const base = etf.paramVariants?.length
    ? etf.paramVariants.map((v) => ({
        ...v,
        label: enrichVariantLabel(
          stripQuotedAnnotations(v.label),
          v.strategyId,
        ),
      }))
    : [
        {
          key: `${etf.meta.code}|${etf.meta.param_version}`,
          label: stripQuotedAnnotations(
            `数据源默认 · ${strategyKindLabel(etf.meta.strategy_id)} · ${etf.meta.param_version}`,
          ),
          strategyId: etf.meta.strategy_id,
          paramVersion: etf.meta.param_version,
          params: etf.params,
        },
      ];
  return [...mine, ...base];
}

/** 产品页 / 详情 / 监控：现金流类或成立未满年限时不返回策略参数 */
export function getProductParamVariants(
  etf: EtfDefinition,
  product?: ParamVariantProductMeta | null,
  userRegistered?: UserRegisteredStrategy[],
): ParamStrategyVariant[] {
  if (!etfProductStrategyEligible(etf, product ?? undefined)) return [];
  return getParamVariants(etf, userRegistered);
}

/** etf_params.csv 中登记的多套参数（不含观测注册） */
export function csvParamVariants(etf: EtfDefinition): ParamStrategyVariant[] {
  return etf.paramVariants ?? [];
}

function isAutoFilledParamVariant(v: ParamStrategyVariant): boolean {
  return /合并补全/.test(stripQuotedAnnotations(v.label));
}

/**
 * 盘中监控：仅 `etf_params.csv` 登记（及未登记时的 etfs 默认一行）。
 * 不含策略研究页「观测注册」的本地项。
 */
export function getDeskMonitorParamVariants(
  etf: EtfDefinition,
  product?: ParamVariantProductMeta | null,
): ParamStrategyVariant[] {
  if (!etfProductStrategyEligible(etf, product ?? undefined)) return [];
  const variants = getParamVariants(etf, []);
  const withoutAuto = variants.filter((v) => !isAutoFilledParamVariant(v));
  return withoutAuto.length ? withoutAuto : variants;
}

/** 列表/卡片一行摘要：RSI日… · 布林日… */
export function paramVariantsSummaryLine(
  variants: ParamStrategyVariant[],
  max = 4,
): string {
  if (!variants.length) return "";
  const labels = variants.map((v) => variantMonitorCompact(v));
  if (labels.length <= max) return labels.join(" · ");
  return `${labels.slice(0, max).join(" · ")} 等 ${labels.length} 套`;
}

function enrichVariantLabel(baseLabel: string, strategyId: string): string {
  const kind = strategyKindLabel(strategyId);
  if (baseLabel.includes(kind) || baseLabel.includes("观测注册"))
    return baseLabel;
  return `${baseLabel} · ${kind}`;
}
