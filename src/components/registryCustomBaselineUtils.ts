import type { EtfParams } from "../types";
import type { ParamStrategyVariant } from "../types";
import { variantOptionLabel } from "../lib/strategyLabels";

export function customBaselineLabel(
  strategyId: string,
  params: EtfParams,
  mode?: "1d" | "1w",
): string {
  const v: ParamStrategyVariant = {
    key: "user-baseline",
    label: "自定义 Baseline",
    strategyId,
    paramVersion: "user-baseline",
    params,
  };
  const tf = mode === "1w" ? "周线" : mode === "1d" ? "日线" : "";
  return `自定义${tf ? `（${tf}）` : ""} · ${variantOptionLabel(v)}`;
}
