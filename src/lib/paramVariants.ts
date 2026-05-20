import type { EtfDefinition, ParamStrategyVariant, UserRegisteredStrategy } from "../types";
import { strategyKindLabel, stripQuotedAnnotations } from "./strategyLabels";

/** 统一取可切换参数列表：用户注册项在前，其次 CSV paramVariants，否则合成单条 */
export function getParamVariants(
  etf: EtfDefinition,
  userRegistered?: UserRegisteredStrategy[]
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
      })
    );
  const base = etf.paramVariants?.length
    ? etf.paramVariants.map((v) => ({
        ...v,
        label: enrichVariantLabel(stripQuotedAnnotations(v.label), v.strategyId),
      }))
    : [
        {
          key: `${etf.meta.code}|${etf.meta.param_version}`,
          label: stripQuotedAnnotations(
            `数据源默认 · ${strategyKindLabel(etf.meta.strategy_id)} · ${etf.meta.param_version}`
          ),
          strategyId: etf.meta.strategy_id,
          paramVersion: etf.meta.param_version,
          params: etf.params,
        },
      ];
  return [...mine, ...base];
}

function enrichVariantLabel(baseLabel: string, strategyId: string): string {
  const kind = strategyKindLabel(strategyId);
  if (baseLabel.includes(kind) || baseLabel.includes("观测注册")) return baseLabel;
  return `${baseLabel} · ${kind}`;
}
