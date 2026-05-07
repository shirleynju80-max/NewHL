import type { EtfDefinition, ParamStrategyVariant } from "../types";

/** 统一取可切换参数列表：有 paramVariants 用之，否则合成单条 */
export function getParamVariants(etf: EtfDefinition): ParamStrategyVariant[] {
  if (etf.paramVariants?.length) return etf.paramVariants;
  return [
    {
      key: `${etf.meta.code}|${etf.meta.param_version}`,
      label: `${etf.meta.param_version}（默认）`,
      strategyId: etf.meta.strategy_id,
      paramVersion: etf.meta.param_version,
      params: etf.params,
    },
  ];
}
