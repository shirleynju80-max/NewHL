import type { EtfDefinition, ParamStrategyVariant, UserRegisteredStrategy } from "../types";

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
        label: `[注册] ${r.label}`,
        strategyId: r.strategyId,
        paramVersion: r.paramVersion,
        params: r.params,
      })
    );
  const base = etf.paramVariants?.length
    ? etf.paramVariants
    : [
        {
          key: `${etf.meta.code}|${etf.meta.param_version}`,
          label: `${etf.meta.param_version}（CSV 默认）`,
          strategyId: etf.meta.strategy_id,
          paramVersion: etf.meta.param_version,
          params: etf.params,
        },
      ];
  return [...mine, ...base];
}
